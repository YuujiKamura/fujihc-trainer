"""真 3 軸 (x, y, z) Eulerian field solver = field_2d.py の 3D 拡張、 b107 brief 着手。

field_2d は (x, z) で multicell が出ない (= y 方向 dynamics ゼロの 1 column 凝結)。
本 module は v 場 (= y 風) を加えて x/y 周期 + z 壁 で真 3 軸 dynamics を回す:

- 場 shape: (nx, ny, nz) for u/v/w/θ/q_v/q_l
- 環境プロファイル: rho_0(z) / θ_env(z) / p_env(z) は 1D 維持、 z 軸 broadcast
- step: 移流 (= 3 軸 upwind) → 浮力 (= θ' → w) → 凝結 → 圧力射影 (= 2 軸 rfft + 1 軸 Thomas)
- 圧力射影: x/y 周期 → rfft2 で 2D 対角化、 z 壁 Neumann → 各 (kx, ky) mode で Thomas、
  (kx=0, ky=0) mode は gauge pin (= ψ̂[0,0,0]=0)。 modified wavenumber
  k² = (2 sin(πk/n)/dx)² + (2 sin(πk/n)/dy)² で discrete Hodge 整合。

brief: ~/.agents/scratch/fujihc-trainer-project/b107-3d-multicell-cumulus.md
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional

import numpy as np


@dataclass
class Field3D:
    """(nx, ny, nz) Eulerian state container + 3D solver"""

    u: np.ndarray       # (nx, ny, nz) 水平 x 風 [m/s]
    v: np.ndarray       # (nx, ny, nz) 水平 y 風 [m/s]
    w: np.ndarray       # (nx, ny, nz) 鉛直 風 [m/s]
    theta: np.ndarray   # (nx, ny, nz) 温位 [K]
    q_v: np.ndarray     # (nx, ny, nz) 水蒸気混合比 [kg/kg]
    q_l: np.ndarray     # (nx, ny, nz) 雲水混合比 [kg/kg]

    theta_env: np.ndarray  # (nz,) 環境温位プロファイル [K]
    rho_0: np.ndarray      # (nz,) 背景密度 [kg/m^3]
    p_env: np.ndarray      # (nz,) 環境圧力 [Pa]

    dx: float
    dy: float
    dz: float
    nx: int
    ny: int
    nz: int

    # 物理 constants
    g: float = 9.80665
    R_d: float = 287.0
    c_p: float = 1004.0
    L_v: float = 2.5e6
    p_ref: float = 100000.0

    # pressure solver cache
    _kx2: Optional[np.ndarray] = field(default=None, repr=False)
    _ky2: Optional[np.ndarray] = field(default=None, repr=False)
    _inv_dz2: float = field(default=0.0, repr=False)

    def __post_init__(self):
        self._build_pressure_solver()

    @classmethod
    def from_config(cls, cfg) -> "Field3D":
        nx, ny, nz = cfg.cell_counts()
        dx = cfg.grid.dx
        dy = cfg.grid.dy
        dz = cfg.grid.dz
        T0 = cfg.initial.T0
        p0 = cfg.initial.p0
        lapse = cfg.initial.lapse_rate
        q_v0 = cfg.initial.q_v0

        z = np.arange(nz) * dz + dz / 2
        T_env_z = T0 - lapse * z
        g_const = 9.80665
        Md = 0.02896
        R = 8.314462
        p_env_z = p0 * np.maximum(1.0 - lapse * z / T0, 1e-6) ** (g_const * Md / (R * lapse))
        rho_0_z = p_env_z / (287.0 * T_env_z)
        theta_env_z = T_env_z * (100000.0 / p_env_z) ** (287.0 / 1004.0)

        Hq = 2000.0
        q_v_z = q_v0 * np.exp(-z / Hq)

        # 1D profile を (nx, ny, nz) に broadcast
        theta_3d = np.broadcast_to(theta_env_z, (nx, ny, nz)).copy()
        q_v_3d = np.broadcast_to(q_v_z, (nx, ny, nz)).copy()
        u_3d = np.zeros((nx, ny, nz), dtype=np.float64)
        v_3d = np.zeros((nx, ny, nz), dtype=np.float64)
        w_3d = np.zeros((nx, ny, nz), dtype=np.float64)
        q_l_3d = np.zeros((nx, ny, nz), dtype=np.float64)

        return cls(
            u=u_3d, v=v_3d, w=w_3d, theta=theta_3d, q_v=q_v_3d, q_l=q_l_3d,
            theta_env=theta_env_z, rho_0=rho_0_z, p_env=p_env_z,
            dx=dx, dy=dy, dz=dz, nx=nx, ny=ny, nz=nz,
        )

    def add_warm_bubble(self, x_center, y_center, z_center, radius, dtheta):
        """3D warm bubble (= θ' 球) を θ に重畳"""
        xi = np.arange(self.nx) * self.dx + self.dx / 2
        yi = np.arange(self.ny) * self.dy + self.dy / 2
        zi = np.arange(self.nz) * self.dz + self.dz / 2
        xx, yy, zz = np.meshgrid(xi, yi, zi, indexing="ij")
        r2 = (xx - x_center) ** 2 + (yy - y_center) ** 2 + (zz - z_center) ** 2
        mask = r2 < radius ** 2
        bump = np.where(mask, 0.5 * (1.0 + np.cos(np.pi * np.sqrt(r2) / radius)), 0.0)
        self.theta += dtheta * bump

    def exner(self) -> np.ndarray:
        """Exner π = (p / p_ref)^(R/cp)、 shape (nz,)"""
        return (self.p_env / self.p_ref) ** (self.R_d / self.c_p)

    def q_v_sat(self, T, p):
        """Tetens、 shape は T/p に合わせる"""
        T_C = T - 273.15
        e_sat = 611.2 * np.exp(17.67 * T_C / (T_C + 243.5))
        eps = 0.622
        return eps * e_sat / np.maximum(p - e_sat, 1.0)

    def advect(self, X: np.ndarray, dt: float) -> np.ndarray:
        """3D upwind 1次、 x/y 周期 + z 壁"""
        u_pos = np.maximum(self.u, 0.0)
        u_neg = np.minimum(self.u, 0.0)
        v_pos = np.maximum(self.v, 0.0)
        v_neg = np.minimum(self.v, 0.0)
        w_pos = np.maximum(self.w, 0.0)
        w_neg = np.minimum(self.w, 0.0)

        # x 方向 周期
        dXdx_pos = (X - np.roll(X, +1, axis=0)) / self.dx
        dXdx_neg = (np.roll(X, -1, axis=0) - X) / self.dx
        flux_x = u_pos * dXdx_pos + u_neg * dXdx_neg

        # y 方向 周期
        dXdy_pos = (X - np.roll(X, +1, axis=1)) / self.dy
        dXdy_neg = (np.roll(X, -1, axis=1) - X) / self.dy
        flux_y = v_pos * dXdy_pos + v_neg * dXdy_neg

        # z 方向 壁、 端 0 padding
        X_below = np.zeros_like(X); X_below[:, :, 1:] = X[:, :, :-1]
        X_above = np.zeros_like(X); X_above[:, :, :-1] = X[:, :, 1:]
        dXdz_pos = (X - X_below) / self.dz
        dXdz_neg = (X_above - X) / self.dz
        flux_z = w_pos * dXdz_pos + w_neg * dXdz_neg

        return X - dt * (flux_x + flux_y + flux_z)

    def buoyancy_step(self, dt: float) -> None:
        """浮力で w を更新、 θ' (= 環境からの偏差) + 雲水負荷"""
        theta_env_3d = self.theta_env[np.newaxis, np.newaxis, :]
        theta_prime = self.theta - theta_env_3d
        theta_v_factor = (1.0 + 0.61 * self.q_v - self.q_l)
        buoyancy = self.g * (theta_prime / theta_env_3d + (theta_v_factor - 1.0))
        self.w += buoyancy * dt

    def condense_step(self, dt: float, tau_c: float = 30.0, tau_e: float = 200.0) -> None:
        """飽和判定 + 双方向 phase transition"""
        pi = self.exner()[np.newaxis, np.newaxis, :]  # (1, 1, nz)
        T = self.theta * pi
        p = self.p_env[np.newaxis, np.newaxis, :]
        q_sat = self.q_v_sat(T, p)
        dq = np.where(
            self.q_v > q_sat,
            (self.q_v - q_sat) * (dt / tau_c),
            -np.minimum(self.q_l, (q_sat - self.q_v) * (dt / tau_e)),
        )
        self.q_v -= dq
        self.q_l += dq
        dtheta = self.L_v * dq / (self.c_p * pi)
        self.theta += dtheta

    def _build_pressure_solver(self) -> None:
        """3D Poisson の事前計算 = (kx, ky) modified wavenumber + z 軸 inv_dz²"""
        # x 方向 rfft index (= 半長)
        kx_idx = np.arange(self.nx // 2 + 1)
        sin_half_x = np.sin(np.pi * kx_idx / self.nx)
        self._kx2 = (2.0 * sin_half_x / self.dx) ** 2  # shape (Kx,)

        # y 方向 fft index (= 全長、 周期境界、 ただし real input なので axis=1 は通常 fft)
        # 注意: numpy.fft.rfftn は最後 axis を real-mode にする、 ここでは axis=(0, 1) 順で
        # rfft2 を使い x を real-mode、 y を complex-fft とする path。 ただし code 単純化のため
        # axis=0 で rfft (x)、 axis=1 で fft (y) の 2 段で実装、 modified wavenumber を
        # それぞれ独立に与える。
        ky_idx = np.arange(self.ny)
        # numpy.fft 規約: complex fft の index は 0..n-1、 k = 0..n/2 は正、 n/2..n-1 は負
        # modified wavenumber は |sin(πk/n)|² で正負同等
        sin_half_y = np.sin(np.pi * ky_idx / self.ny)
        self._ky2 = (2.0 * sin_half_y / self.dy) ** 2  # shape (ny,)

        self._inv_dz2 = 1.0 / (self.dz ** 2)

    def pressure_projection(self) -> None:
        """3D anelastic 連続式を 2 軸 rfft + z 軸 Thomas で厳密射影。

        Poisson: ∂²ψ/∂x² + ∂²ψ/∂y² + ∂²ψ/∂z² = ∂(ρ₀u*)/∂x + ∂(ρ₀v*)/∂y + ∂(ρ₀w*)/∂z
        x: 周期 (rfft), y: 周期 (fft), z: 壁 Neumann (Thomas)
        (kx=0, ky=0) mode: ψ̂[0,0,:] = 0 gauge pin
        """
        rho = self.rho_0[np.newaxis, np.newaxis, :]  # (1, 1, nz)
        rho_u = rho * self.u  # (nx, ny, nz)
        rho_v = rho * self.v
        rho_w = rho * self.w

        # RHS = forward 差分 で 3 軸 divergence (= discrete Hodge 整合)
        d_rhou_dx = (np.roll(rho_u, -1, axis=0) - rho_u) / self.dx
        d_rhov_dy = (np.roll(rho_v, -1, axis=1) - rho_v) / self.dy
        d_rhow_dz = np.empty_like(rho_w)
        d_rhow_dz[:, :, :-1] = (rho_w[:, :, 1:] - rho_w[:, :, :-1]) / self.dz
        d_rhow_dz[:, :, -1] = (0.0 - rho_w[:, :, -1]) / self.dz
        D = d_rhou_dx + d_rhov_dy + d_rhow_dz  # (nx, ny, nz)

        # 2 軸 spectral: axis=0 で rfft (x)、 axis=1 で fft (y)
        D_hat = np.fft.fft(np.fft.rfft(D, axis=0), axis=1)  # (Kx, ny, nz) complex

        Kx = self._kx2.size
        ny = self.ny
        nz = self.nz
        inv_dz2 = self._inv_dz2

        # k² combined = kx² + ky²、 shape (Kx, ny, 1)
        kx2 = self._kx2[:, np.newaxis, np.newaxis]  # (Kx, 1, 1)
        ky2 = self._ky2[np.newaxis, :, np.newaxis]  # (1, ny, 1)
        k2 = kx2 + ky2  # (Kx, ny, 1)

        # tridiagonal 構成: 主対角 b = -2/dz² - k²、 下/上 = 1/dz²、 Neumann 端
        a = np.full((Kx, ny, nz), inv_dz2)
        b = np.full((Kx, ny, nz), -2.0 * inv_dz2) - k2  # broadcast
        c = np.full((Kx, ny, nz), inv_dz2)
        # Neumann 下端 j=0: ghost ψ̂[-1] = ψ̂[0] ⟹ a=0, b = -inv_dz² - k²
        a[:, :, 0] = 0.0
        b[:, :, 0] = -inv_dz2 - k2[:, :, 0]
        # Neumann 上端 j=nz-1
        c[:, :, -1] = 0.0
        b[:, :, -1] = -inv_dz2 - k2[:, :, 0]

        d = D_hat.copy()
        # gauge pin: (kx=0, ky=0) mode で ψ̂[0,0,0] = 0
        b[0, 0, 0] = 1.0
        c[0, 0, 0] = 0.0
        d[0, 0, 0] = 0.0

        # complex 化
        a = a.astype(D_hat.dtype, copy=False)
        b = b.astype(D_hat.dtype, copy=False)
        c = c.astype(D_hat.dtype, copy=False)

        # Thomas forward sweep (j over nz、 Kx × ny 並列)
        for j in range(1, nz):
            m = a[:, :, j] / b[:, :, j - 1]
            b[:, :, j] = b[:, :, j] - m * c[:, :, j - 1]
            d[:, :, j] = d[:, :, j] - m * d[:, :, j - 1]

        # back substitution
        psi_hat = np.zeros_like(D_hat)
        psi_hat[:, :, -1] = d[:, :, -1] / b[:, :, -1]
        for j in range(nz - 2, -1, -1):
            psi_hat[:, :, j] = (d[:, :, j] - c[:, :, j] * psi_hat[:, :, j + 1]) / b[:, :, j]

        # 逆変換
        psi = np.fft.irfft(np.fft.ifft(psi_hat, axis=1), n=self.nx, axis=0).real  # (nx, ny, nz)

        # 速度補正 = backward 差分 3 軸
        dpsi_dx = (psi - np.roll(psi, +1, axis=0)) / self.dx
        dpsi_dy = (psi - np.roll(psi, +1, axis=1)) / self.dy
        dpsi_dz = np.empty_like(psi)
        dpsi_dz[:, :, 1:] = (psi[:, :, 1:] - psi[:, :, :-1]) / self.dz
        dpsi_dz[:, :, 0] = 0.0  # 下端 Neumann ⟹ backward diff = 0

        rho_u_new = rho_u - dpsi_dx
        rho_v_new = rho_v - dpsi_dy
        rho_w_new = rho_w - dpsi_dz
        self.u = rho_u_new / rho
        self.v = rho_v_new / rho
        self.w = rho_w_new / rho

        # 壁強制 (= 2D 版と同じ trade-off、 壁面 1 cell の不整合許容)
        self.w[:, :, 0] = 0.0
        self.w[:, :, -1] = 0.0

    def divergence_anelastic(self) -> np.ndarray:
        """連続式 残差 ∂(ρ₀u)/∂x + ∂(ρ₀v)/∂y + ∂(ρ₀w)/∂z (= 検証用)"""
        rho = self.rho_0[np.newaxis, np.newaxis, :]
        rho_u = rho * self.u
        rho_v = rho * self.v
        rho_w = rho * self.w
        d_rhou_dx = (np.roll(rho_u, -1, axis=0) - rho_u) / self.dx
        d_rhov_dy = (np.roll(rho_v, -1, axis=1) - rho_v) / self.dy
        d_rhow_dz = np.empty_like(rho_w)
        d_rhow_dz[:, :, :-1] = (rho_w[:, :, 1:] - rho_w[:, :, :-1]) / self.dz
        d_rhow_dz[:, :, -1] = (0.0 - rho_w[:, :, -1]) / self.dz
        return d_rhou_dx + d_rhov_dy + d_rhow_dz

    def step(self, dt: float, do_projection: bool = True) -> None:
        """1 step = 移流 + 浮力 + 凝結 + 圧力射影"""
        self.theta = self.advect(self.theta, dt)
        self.q_v = self.advect(self.q_v, dt)
        self.q_l = self.advect(self.q_l, dt)
        self.u = self.advect(self.u, dt)
        self.v = self.advect(self.v, dt)
        self.w = self.advect(self.w, dt)

        self.buoyancy_step(dt)
        self.condense_step(dt)

        if do_projection:
            self.pressure_projection()

    def summary(self) -> str:
        theta_env_3d = self.theta_env[np.newaxis, np.newaxis, :]
        theta_prime = self.theta - theta_env_3d
        return (
            f"Field3D nx×ny×nz={self.nx}×{self.ny}×{self.nz}  "
            f"theta'=[{theta_prime.min():+.2f}, {theta_prime.max():+.2f}]K  "
            f"u=[{self.u.min():+.2f}, {self.u.max():+.2f}]m/s  "
            f"v=[{self.v.min():+.2f}, {self.v.max():+.2f}]m/s  "
            f"w=[{self.w.min():+.2f}, {self.w.max():+.2f}]m/s  "
            f"q_v_max={self.q_v.max()*1e3:.3f}g/kg  q_l_max={self.q_l.max()*1e3:.4f}g/kg"
        )
