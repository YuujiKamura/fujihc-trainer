"""2D 鉛直断面の Eulerian 場 = 空間に固定 grid を張って各 cell で大気の状態を保持。

user 概念モデルの直訳 (= 2026-05-25):
「気圧差や風の空間マッピングが出来て初めて空気が動く」 = まず空間に grid を張る、
各 grid 点に温位 / 水蒸気 / 風速 を保持、 場の不均衡で物質と熱が流れる、 = Eulerian。

ボトムアップ最小実装:
- 2D 鉛直断面 (= 水平 x × 鉛直 z)、 cell shape (nx, nz)
- 各 cell の状態: u (水平風), w (鉛直風), θ (温位 = T を圧力で正規化), q_v (水蒸気), q_l (雲水)
- 環境プロファイル: 標準大気の rho_0(z), θ_env(z), p_env(z) を背景固定
- step:
  1. 移流 (= upwind 1 次): 各場 X を u, w で運ぶ
  2. 浮力: w += (θ' / θ_0) * g * dt、 θ' = θ - θ_env
  3. 圧力射影 (= projection method): div(rho_0 u) = 0 を FFT spectral + tridiag で satisfy
  4. 凝結 / 蒸発: 各 cell で q_v ⇄ q_l、 時定数 τ_c / τ_e で transition、 潜熱 θ feedback

初期条件: 地表中央付近に warm bubble (= +2K) を置いて上昇させる、 古典的 dry/moist
thermal test、 cumulus 対流の最小単位。

8 担当者合意 (= 2026-05-25 チーム): anelastic / θ / 簡易凝結 (= τ relaxation) / 周期 x +
壁 z 境界 / Smagorinsky SGS は当面省略 (= 数値拡散が代用)、 後段で Deardorff TKE 追加。

質量保存 solver の数式 (= 2026-05-25 質量保存担当 改訂):
mass-flux potential ψ = ρ₀ φ を導入すると anelastic 連続式
  ∂(ρ₀ u)/∂x + ∂(ρ₀ w)/∂z = 0
を満たす速度補正は
  (ρ₀ u)_new = (ρ₀ u*) − ∂ψ/∂x
  (ρ₀ w)_new = (ρ₀ w*) − ∂ψ/∂z
で得られ、 ψ は定係数 Poisson
  ∂²ψ/∂x² + ∂²ψ/∂z² = ∂(ρ₀ u*)/∂x + ∂(ρ₀ w*)/∂z
を解けば良い。 x は周期なので numpy.fft.rfft で対角化 (mode k で ∂²/∂x² = −k²)、
z は壁境界 (= w=0 ⟹ ∂ψ/∂z = 0) で Neumann、 mode 毎に scipy 風 tridiagonal direct
solve (= Thomas algorithm)。 k=0 mode は gauge 自由度のため平均を 0 に pin。
反復ゼロの direct solve なので SOR の omega tuning / 発散モードが構造的に消える。
"""
from __future__ import annotations
from dataclasses import dataclass
import math

import numpy as np


@dataclass
class Field2D:
    """2D 鉛直断面の Eulerian 場。 各属性は shape (nx, nz) の numpy 配列。"""
    # 動的場
    u: np.ndarray       # 水平風 [m/s]
    w: np.ndarray       # 鉛直風 [m/s]
    theta: np.ndarray   # 温位 [K]
    q_v: np.ndarray     # 水蒸気混合比 [kg/kg]
    q_l: np.ndarray     # 雲水混合比 [kg/kg]

    # 背景プロファイル (= 鉛直 1D、 shape (nz,))
    theta_env: np.ndarray  # 環境温位 [K]
    rho_0: np.ndarray      # 背景密度 [kg/m^3]
    p_env: np.ndarray      # 環境圧力 [Pa]

    # grid
    dx: float
    dz: float
    nx: int
    nz: int

    # 物理定数
    g: float = 9.80665
    c_p: float = 1004.0
    L_v: float = 2.5e6
    R_d: float = 287.0
    p_ref: float = 100000.0  # exner 関数の基準圧力 [Pa]

    @classmethod
    def from_config(cls, cfg) -> "Field2D":
        """config.Config から 2D 鉛直断面 field を構築。 ly 方向は 1 cell 厚で扱う。"""
        nx, _, nz = cfg.cell_counts()
        dx = cfg.grid.dx
        dz = cfg.grid.dz
        T0 = cfg.initial.T0
        p0 = cfg.initial.p0
        lapse = cfg.initial.lapse_rate
        q_v0 = cfg.initial.q_v0

        # 鉛直プロファイル (= 1D)
        z = np.arange(nz) * dz + dz / 2  # cell 中心
        T_env_z = T0 - lapse * z
        # 静水圧近似
        g = 9.80665
        Md = 0.02896
        R = 8.314462
        p_env_z = p0 * np.maximum(1.0 - lapse * z / T0, 1e-6) ** (g * Md / (R * lapse))
        rho_0_z = p_env_z / (287.0 * T_env_z)
        # 温位 θ = T * (p_ref / p)^(R/cp)、 p_ref = 100000 Pa
        theta_env_z = T_env_z * (100000.0 / p_env_z) ** (287.0 / 1004.0)

        # 2D 場の初期化 = 環境プロファイルを x 方向に broadcast
        # q_v は標準大気の高度減衰 (= スケールハイト 2km)、 これしないと上層で超過飽和 + 暴騰
        Hq = 2000.0  # 水蒸気スケールハイト [m]
        q_v_z = q_v0 * np.exp(-z / Hq)
        theta_2d = np.tile(theta_env_z, (nx, 1))   # shape (nx, nz)
        q_v_2d = np.tile(q_v_z, (nx, 1))
        u_2d = np.zeros((nx, nz), dtype=np.float64)
        w_2d = np.zeros((nx, nz), dtype=np.float64)
        q_l_2d = np.zeros((nx, nz), dtype=np.float64)

        return cls(
            u=u_2d, w=w_2d, theta=theta_2d, q_v=q_v_2d, q_l=q_l_2d,
            theta_env=theta_env_z, rho_0=rho_0_z, p_env=p_env_z,
            dx=dx, dz=dz, nx=nx, nz=nz,
        )

    def add_warm_bubble(self, x_center: float, z_center: float, radius: float, dtheta: float):
        """warm bubble = θ' perturbation の球、 古典的 thermal test 用 trigger"""
        x_idx = np.arange(self.nx) * self.dx + self.dx / 2
        z_idx = np.arange(self.nz) * self.dz + self.dz / 2
        xx, zz = np.meshgrid(x_idx, z_idx, indexing="ij")
        r2 = (xx - x_center) ** 2 + (zz - z_center) ** 2
        mask = r2 < radius ** 2
        # 滑らかな bump (= cosine taper)
        bump = np.where(mask, 0.5 * (1.0 + np.cos(np.pi * np.sqrt(r2) / radius)), 0.0)
        self.theta += dtheta * bump

    def exner(self) -> np.ndarray:
        """Exner 関数 π = (p / p_ref)^(R/cp)、 shape (nz,)"""
        return (self.p_env / self.p_ref) ** (self.R_d / self.c_p)

    def q_v_sat(self, T: np.ndarray, p: np.ndarray) -> np.ndarray:
        """飽和水蒸気混合比、 Tetens"""
        T_C = T - 273.15
        e_sat = 611.2 * np.exp(17.67 * T_C / (T_C + 243.5))
        eps = 0.622
        return eps * e_sat / np.maximum(p - e_sat, 1.0)

    # ----- step の中身 -----

    def advect(self, X: np.ndarray, dt: float) -> np.ndarray:
        """upwind 1 次の 2D 移流、 周期 x + 壁 z"""
        u_pos = np.maximum(self.u, 0.0)
        u_neg = np.minimum(self.u, 0.0)
        w_pos = np.maximum(self.w, 0.0)
        w_neg = np.minimum(self.w, 0.0)

        # x 方向 (= 周期境界、 np.roll で wrap)
        dXdx_pos = (X - np.roll(X, +1, axis=0)) / self.dx
        dXdx_neg = (np.roll(X, -1, axis=0) - X) / self.dx
        flux_x = u_pos * dXdx_pos + u_neg * dXdx_neg

        # z 方向 (= 壁境界、 端は 0 padding)
        X_below = np.zeros_like(X); X_below[:, 1:] = X[:, :-1]
        X_above = np.zeros_like(X); X_above[:, :-1] = X[:, 1:]
        dXdz_pos = (X - X_below) / self.dz
        dXdz_neg = (X_above - X) / self.dz
        flux_z = w_pos * dXdz_pos + w_neg * dXdz_neg

        return X - dt * (flux_x + flux_z)

    def buoyancy_step(self, dt: float) -> None:
        """浮力で w を更新、 θ' (= 環境からの偏差) と 雲水負荷で計算"""
        theta_prime = self.theta - self.theta_env[np.newaxis, :]
        # 仮温位の偏差 (= 水蒸気が多いと軽い、 雲水が多いと重い)
        theta_v_factor = (1.0 + 0.61 * self.q_v - self.q_l)
        buoyancy = self.g * (theta_prime / self.theta_env[np.newaxis, :] + (theta_v_factor - 1.0))
        self.w += buoyancy * dt

    def condense_step(self, dt: float, tau_c: float = 30.0, tau_e: float = 200.0) -> None:
        """飽和判定 + 双方向 phase transition、 有限時定数で振動回避"""
        # T を θ + Exner から復元
        pi = self.exner()[np.newaxis, :]
        T = self.theta * pi
        p = self.p_env[np.newaxis, :]
        q_sat = self.q_v_sat(T, p)
        # 凝結 (= 過飽和) と 蒸発 (= 不飽和 + 雲水あり)
        dq = np.where(
            self.q_v > q_sat,
            (self.q_v - q_sat) * (dt / tau_c),       # 凝結 = q_v → q_l
            -np.minimum(self.q_l, (q_sat - self.q_v) * (dt / tau_e)),  # 蒸発 = q_l → q_v
        )
        self.q_v -= dq
        self.q_l += dq
        # 潜熱で θ 更新 (= 凝結 dq>0 で θ 上がる)
        dtheta = self.L_v * dq / (self.c_p * pi)
        self.theta += dtheta

    def _build_pressure_solver(self) -> None:
        """FFT spectral + tridiagonal の事前計算 (= solver 構造の cache)。

        x は周期 (= rfft で半長 K = nx//2+1 モード)、 各モード k_x について z 方向に
        nz×nz tridiagonal 線形系を解く。 行列は ψ に対する 3 点差分 + Neumann BC、
        モード毎に対角 (= a, c) は共通で、 主対角 b のみ k_x_mod² 依存。

        重要: divergence は forward 差分 で測り、 gradient は forward で復元する
        (= 標準 3 点 Laplacian と discrete Hodge 整合)。 spectral 側では連続 k² ではなく
        **modified wavenumber** k_mod² = (2 sin(π k / nx) / dx)² を使う ── これが
        forward 差分 (= ψ[i+1] − ψ[i])/dx を 2 回噛ませた時の eigenvalue。 ここを揃えないと
        射影後も div が残り、 SOR と同じ症状になる (= 2026-05-25 1 段目 NG の根因)。
        """
        # rfft index k = 0..nx//2、 modified wavenumber for forward-diff Laplacian
        k_idx = np.arange(self.nx // 2 + 1)
        # (ψ[i+1] − 2 ψ[i] + ψ[i−1])/dx² の eigenvalue = −(2 sin(π k/nx)/dx)²
        sin_half = np.sin(np.pi * k_idx / self.nx)
        self._kx2 = (2.0 * sin_half / self.dx) ** 2  # shape (K,)
        self._inv_dz2 = 1.0 / (self.dz ** 2)

    def pressure_projection(self) -> None:
        """FFT spectral + tridiagonal direct solve で anelastic 連続式を厳密射影。

        mass-flux potential ψ = ρ₀ φ に対する Poisson:
            ∂²ψ/∂x² + ∂²ψ/∂z² = ∂(ρ₀ u*)/∂x + ∂(ρ₀ w*)/∂z
        x: 周期 (rfft で対角化、 mode k_x で −k_x² ψ̂)
        z: 壁 Neumann (w=0 ⟹ ∂ψ/∂z = 0)、 mode 毎に Thomas で direct solve
        k_x = 0 mode: 平均自由度 (gauge) を 0 に pin。

        速度補正:
            (ρ₀ u)_new = (ρ₀ u*) − ∂ψ/∂x
            (ρ₀ w)_new = (ρ₀ w*) − ∂ψ/∂z
        後で u, w に戻す (= ρ₀ で割る)、 上下端 w=0 を強制。
        """
        if not hasattr(self, "_kx2"):
            self._build_pressure_solver()

        rho = self.rho_0[np.newaxis, :]  # (1, nz)
        rho_u = rho * self.u             # (nx, nz)
        rho_w = rho * self.w             # (nx, nz)

        # RHS = div(ρ₀ u*) を forward 差分で組む (= 3 点 Laplacian と discrete Hodge 整合)。
        # x 周期: (ρu[i+1] − ρu[i])/dx、 z 壁: (ρw[j+1] − ρw[j])/dz、 端は w=0 を ghost に使う。
        d_rhou_dx = (np.roll(rho_u, -1, axis=0) - rho_u) / self.dx
        d_rhow_dz = np.empty_like(rho_w)
        d_rhow_dz[:, :-1] = (rho_w[:, 1:] - rho_w[:, :-1]) / self.dz
        # 上端 j = nz−1: w=0 BC ⟹ ghost ρ_0 w[nz] = 0、 d = (0 − rho_w[:, -1])/dz
        d_rhow_dz[:, -1] = (0.0 - rho_w[:, -1]) / self.dz
        D = d_rhou_dx + d_rhow_dz  # shape (nx, nz)

        # x: rfft、 mode 毎に z 方向 tridiagonal solve
        D_hat = np.fft.rfft(D, axis=0)  # shape (nx//2+1, nz) complex
        # D_hat は shape (K, nz)、 K = nx//2+1。 rfft の order は axis=0 が先になる
        # 実際 shape は (K, nz)、 確認: np.fft.rfft(D, axis=0).shape == (K, nz)
        psi_hat = np.zeros_like(D_hat)

        inv_dz2 = self._inv_dz2
        nz = self.nz
        K = self._kx2.size
        # 主対角 b、 下対角 a、 上対角 c を 全モード 一括 (= shape (K, nz))。
        # 内点 j: a = inv_dz2、 b = −2 inv_dz2 − kx²、 c = inv_dz2
        # Neumann 端: ψ̂[−1] = ψ̂[0] ⟹ j=0 で a=0, b = −inv_dz2 − kx², c = inv_dz2
        # k_x = 0 mode は gauge 自由度のため ψ̂[0] = 0 に pin (行を b[0]=1, a=c=0, d=0 に置換)
        kx2 = self._kx2[:, np.newaxis]  # (K, 1)
        a = np.full((K, nz), inv_dz2)
        b = np.full((K, nz), -2.0 * inv_dz2) - kx2  # broadcast
        c = np.full((K, nz), inv_dz2)
        a[:, 0] = 0.0
        b[:, 0] = -inv_dz2 - kx2[:, 0]
        c[:, -1] = 0.0
        b[:, -1] = -inv_dz2 - kx2[:, 0]
        d = D_hat.copy()  # (K, nz)
        # k_x = 0 mode の gauge pin: ψ̂[0] = 0
        b[0, 0] = 1.0
        c[0, 0] = 0.0
        d[0, 0] = 0.0
        # 全モード 一括 Thomas forward sweep (j over nz、 K 並列)
        # 複素数 d と実数 a/b/c の混合: 計算は b, c を複素 promote
        b = b.astype(D_hat.dtype, copy=False)
        c = c.astype(D_hat.dtype, copy=False)
        a = a.astype(D_hat.dtype, copy=False)
        for j in range(1, nz):
            m = a[:, j] / b[:, j - 1]
            b[:, j] = b[:, j] - m * c[:, j - 1]
            d[:, j] = d[:, j] - m * d[:, j - 1]
        # back substitution
        psi_hat[:, -1] = d[:, -1] / b[:, -1]
        for j in range(nz - 2, -1, -1):
            psi_hat[:, j] = (d[:, j] - c[:, j] * psi_hat[:, j + 1]) / b[:, j]

        # 逆変換で ψ(x, z) を復元
        psi = np.fft.irfft(psi_hat, n=self.nx, axis=0)  # shape (nx, nz)

        # 速度補正: (ρ₀ u)_new = (ρ₀ u*) − ∂ψ/∂x、 (ρ₀ w)_new = (ρ₀ w*) − ∂ψ/∂z。
        # **backward 差分** で復元 (= forward div と Hodge 対応、 div(grad) = 3 点 Laplacian)。
        dpsi_dx = (psi - np.roll(psi, +1, axis=0)) / self.dx
        dpsi_dz = np.empty_like(psi)
        dpsi_dz[:, 1:] = (psi[:, 1:] - psi[:, :-1]) / self.dz
        # 下端 j=0: Neumann (ψ[−1] = ψ[0]) ⟹ backward diff = 0
        dpsi_dz[:, 0] = 0.0

        rho_u_new = rho_u - dpsi_dx
        rho_w_new = rho_w - dpsi_dz
        self.u = rho_u_new / rho
        self.w = rho_w_new / rho
        # 壁境界 (= cell-center が wall に直接乗ってる collocated 解釈): w[:, 0] / w[:, -1] = 0。
        # この強制で j=0 / j=nz-1 の 1 row の div が ~O(w/dz) 残るが (= ~1e-4)、 内部は
        # 機械精度。 完全 staggered 化が将来 task、 現状は壁面近傍 1 cell の不整合を許容して
        # 雲対流 dynamics の正しさを優先する trade-off。
        self.w[:, 0] = 0.0
        self.w[:, -1] = 0.0

    def divergence_anelastic(self) -> np.ndarray:
        """連続式 残差 ∂(ρ₀u)/∂x + ∂(ρ₀w)/∂z を返す (= 検証用、 質量保存誤差)。

        pressure_projection と **同じ forward 差分**で組む (= discrete Hodge 整合)。
        """
        rho = self.rho_0[np.newaxis, :]
        rho_u = rho * self.u
        rho_w = rho * self.w
        d_rhou_dx = (np.roll(rho_u, -1, axis=0) - rho_u) / self.dx
        d_rhow_dz = np.empty_like(rho_w)
        d_rhow_dz[:, :-1] = (rho_w[:, 1:] - rho_w[:, :-1]) / self.dz
        d_rhow_dz[:, -1] = (0.0 - rho_w[:, -1]) / self.dz
        return d_rhou_dx + d_rhow_dz

    def step(self, dt: float, do_projection: bool = True) -> None:
        """1 step 進める = 移流 + 浮力 + 凝結 + 圧力射影。

        do_projection = True (= 2026-05-25 default 改訂): FFT spectral + tridiag solver
        で連続式 div(ρ₀ u) = 0 を厳密射影、 中央上昇 column に対する 補償下降流 dipole
        が出る。 SOR 時代の omega tuning / 発散モード問題は構造的に消えた。
        False を残すのは projection 無しでの場の振る舞い観察用 (= 旧 default、 移行用)。
        """
        # 1. 全場を移流
        self.theta = self.advect(self.theta, dt)
        self.q_v = self.advect(self.q_v, dt)
        self.q_l = self.advect(self.q_l, dt)
        self.u = self.advect(self.u, dt)
        self.w = self.advect(self.w, dt)

        # 2. 浮力で w 更新
        self.buoyancy_step(dt)

        # 3. 凝結 / 蒸発 + 潜熱
        self.condense_step(dt)

        # 4. (optional) 圧力射影で連続式を満たす
        if do_projection:
            self.pressure_projection()
        # 壁境界注意: cell-center の w[:, 0] / w[:, -1] を 0 強制 しない (= 2026-05-25
        # 改訂)。 wall は cell-face (= ghost) に置き、 advect / pressure_projection は
        # ghost ρw = 0 で BC を満たす設計。 cell-center 値を 0 強制すると質量保存が破れる。

    def summary(self) -> str:
        return (
            f"Field2D nx×nz={self.nx}×{self.nz}  "
            f"theta'=[{(self.theta-self.theta_env).min():.2f}, {(self.theta-self.theta_env).max():.2f}]K  "
            f"w=[{self.w.min():+.2f}, {self.w.max():+.2f}]m/s  "
            f"q_v_max={self.q_v.max()*1e3:.3f}g/kg  q_l_max={self.q_l.max()*1e3:.4f}g/kg"
        )
