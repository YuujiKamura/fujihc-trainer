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
  3. 圧力射影 (= projection method): div(rho_0 u) = 0 を SOR で満たして速度を補正
  4. 凝結 / 蒸発: 各 cell で q_v ⇄ q_l、 時定数 τ_c / τ_e で transition、 潜熱 θ feedback

初期条件: 地表中央付近に warm bubble (= +2K) を置いて上昇させる、 古典的 dry/moist
thermal test、 cumulus 対流の最小単位。

8 担当者合意 (= 2026-05-25 チーム): anelastic / θ / 簡易凝結 (= τ relaxation) / 周期 x +
壁 z 境界 / Smagorinsky SGS は当面省略 (= 数値拡散が代用)、 後段で Deardorff TKE 追加。
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

    def pressure_projection(self) -> None:
        """簡易: 連続式 div(rho_0 u) = 0 を SOR 反復で射影、 速度を補正。

        anelastic: ρ_0(z) ∂u/∂x + ∂(ρ_0 w)/∂z = 0 を満たすよう、
        圧力ポテンシャル φ を解いて u -= ∇φ / ρ_0。 SOR 30 step で粗く満たす (= ボトムアップ
        段階での精度は要求しない、 動くこと優先)。
        """
        rho = self.rho_0[np.newaxis, :]  # shape (1, nz)
        # 速度の divergence
        div = np.zeros_like(self.u)
        # x 周期
        du_dx = (np.roll(self.u, -1, axis=0) - np.roll(self.u, +1, axis=0)) / (2 * self.dx)
        # z 壁: 上下端は 0
        rho_w = rho * self.w
        d_rhow_dz = np.zeros_like(rho_w)
        d_rhow_dz[:, 1:-1] = (rho_w[:, 2:] - rho_w[:, :-2]) / (2 * self.dz)
        div = du_dx + d_rhow_dz / rho

        # SOR で Poisson φ を解く (= 簡易、 ∇²φ = div、 30 反復)
        phi = np.zeros_like(div)
        omega = 1.7
        dx2 = self.dx ** 2
        dz2 = self.dz ** 2
        denom = 2.0 / dx2 + 2.0 / dz2
        for _ in range(30):
            phi_xm = np.roll(phi, +1, axis=0)
            phi_xp = np.roll(phi, -1, axis=0)
            phi_zm = np.roll(phi, +1, axis=1); phi_zm[:, 0] = phi[:, 0]
            phi_zp = np.roll(phi, -1, axis=1); phi_zp[:, -1] = phi[:, -1]
            phi_new = ((phi_xm + phi_xp) / dx2 + (phi_zm + phi_zp) / dz2 - div) / denom
            phi = phi + omega * (phi_new - phi)

        # 速度補正 u -= ∇φ
        dphi_dx = (np.roll(phi, -1, axis=0) - np.roll(phi, +1, axis=0)) / (2 * self.dx)
        dphi_dz = np.zeros_like(phi)
        dphi_dz[:, 1:-1] = (phi[:, 2:] - phi[:, :-2]) / (2 * self.dz)
        self.u -= dphi_dx
        self.w -= dphi_dz
        # 壁境界: 上下端で w=0
        self.w[:, 0] = 0.0
        self.w[:, -1] = 0.0

    def step(self, dt: float, do_projection: bool = False) -> None:
        """1 step 進める = 移流 + 浮力 + 凝結 + (optional) 圧力射影。

        do_projection = False: ボトムアップ最初は projection なし (= 簡易、
        質量保存崩れるが場の振る舞いを観察する用)。 後段で True に切替。
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
        # 壁境界: 上下端で w=0
        self.w[:, 0] = 0.0
        self.w[:, -1] = 0.0

    def summary(self) -> str:
        return (
            f"Field2D nx×nz={self.nx}×{self.nz}  "
            f"theta'=[{(self.theta-self.theta_env).min():.2f}, {(self.theta-self.theta_env).max():.2f}]K  "
            f"w=[{self.w.min():+.2f}, {self.w.max():+.2f}]m/s  "
            f"q_v_max={self.q_v.max()*1e3:.3f}g/kg  q_l_max={self.q_l.max()*1e3:.4f}g/kg"
        )
