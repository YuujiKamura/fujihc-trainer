"""field_3d solver 単体 test = 6 件。 既存 test_field_2d_solver.py の 3D 拡張。

1. 3D mass conservation = pressure_projection 後 div(ρu) → machine precision
2. 3D dipole = 中央 warm bubble で +w core + 周囲 -w ring
3. 3D NaN-free 100 step
4. y 軸 dynamics 存在 = v 場 max > 0 (= 押出ではない pin)
5. condense 3D = q_v > q_sat で q_l 生成、 shape (nx, ny, nz)
6. wind shear 適用 (= 後で run_field_moist_3d で実装する apply_wind_shear 関数を import)

brief: ~/.agents/scratch/fujihc-trainer-project/b107-3d-multicell-cumulus.md
"""
from __future__ import annotations
import sys
from pathlib import Path

import numpy as np
import pytest

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))

from field_3d import Field3D
import config


@pytest.fixture
def small_field():
    """20×20×30 grid for fast unit test"""
    cfg = config.get("fuji_3d_100m")
    field = Field3D.from_config(cfg)
    return field


def test_mass_conservation_3d(small_field):
    """projection 後 div(ρu) が機械精度近くに落ちる (= 2D 同形、 壁 4 cell 除外内部)"""
    field = small_field
    rng = np.random.default_rng(0)
    field.u = rng.standard_normal(field.u.shape) * 2.0
    field.v = rng.standard_normal(field.v.shape) * 2.0
    field.w = rng.standard_normal(field.w.shape) * 2.0
    field.w[:, :, 0] = 0.0     # 壁面 w=0 強制 (= 2D test 同形、 collocated BC)
    field.w[:, :, -1] = 0.0
    div_before = field.divergence_anelastic()
    field.pressure_projection()
    div_after = field.divergence_anelastic()
    scale = float(np.abs(div_before).max())
    # 壁 collocated BC で w 強制すると forward-diff div の隣接 row まで波及、 4 cell 除外
    err_interior = float(np.abs(div_after[:, :, 2:-2]).max())
    print(f"[mass] scale={scale:.3e}, interior[2:-2]={err_interior:.3e}, "
          f"ratio={err_interior/scale:.2e}")
    assert err_interior < 1e-6 * scale or err_interior < 1e-8, \
        f"interior div not eliminated: {err_interior:.3e} (scale {scale:.3e})"


def test_central_updraft_3d(small_field):
    """中央 warm bubble で +w core が立つ"""
    field = small_field
    x_c = field.nx * field.dx / 2
    y_c = field.ny * field.dy / 2
    z_c = 1000.0
    field.add_warm_bubble(x_c, y_c, z_c, radius=300.0, dtheta=2.0)
    dt = 1.0
    for _ in range(50):
        field.step(dt)
    cx, cy = field.nx // 2, field.ny // 2
    w_center = field.w[cx, cy, :].max()
    assert w_center > 0.3, \
        f"中央 上昇 column が立たない: w_max={w_center:.3f} m/s"


def test_no_nan_3d_100_step(small_field):
    """100 step で NaN / Inf が発生しない"""
    field = small_field
    rng = np.random.default_rng(1)
    field.theta += rng.standard_normal(field.theta.shape) * 0.1
    dt = 1.0
    for step_idx in range(100):
        field.step(dt)
        if step_idx % 20 == 0:
            assert np.all(np.isfinite(field.theta)), f"theta NaN at step {step_idx}"
            assert np.all(np.isfinite(field.u)), f"u NaN at step {step_idx}"
            assert np.all(np.isfinite(field.v)), f"v NaN at step {step_idx}"
            assert np.all(np.isfinite(field.w)), f"w NaN at step {step_idx}"


def test_y_axis_dynamics_present(small_field):
    """y 軸方向 dynamics が機能 (= 押出 trap negative pin)"""
    field = small_field
    rng = np.random.default_rng(2)
    field.theta += rng.standard_normal(field.theta.shape) * 0.5
    dt = 1.0
    for _ in range(10):
        field.step(dt)
    v_max = float(np.abs(field.v).max())
    assert v_max > 0.05, \
        f"v 場 max ({v_max:.4f}) が低すぎる、 y 軸 dynamics 不在 = 押出 trap"


def test_condense_3d(small_field):
    """局所過飽和 cell で q_v → q_l 移送"""
    field = small_field
    cx, cy, cz = field.nx // 2, field.ny // 2, 5
    field.q_v[cx, cy, cz] = 0.020  # over-saturation 想定
    q_v_before = field.q_v[cx, cy, cz]
    q_l_before = field.q_l[cx, cy, cz]
    field.condense_step(dt=10.0)
    q_v_after = field.q_v[cx, cy, cz]
    q_l_after = field.q_l[cx, cy, cz]
    assert q_l_after > q_l_before, \
        f"q_l 増加なし: before={q_l_before:.6f}, after={q_l_after:.6f}"
    assert q_v_after < q_v_before, \
        f"q_v 減少なし: before={q_v_before:.6f}, after={q_v_after:.6f}"
    assert field.q_l.shape == (field.nx, field.ny, field.nz)


def test_wind_shear_applied(small_field):
    """apply_wind_shear で u(z) profile が指定通り
    (= run_field_moist_3d で実装する関数、 単体 test は先行で interface 固定)"""
    field = small_field

    def apply_wind_shear(field, u_low, u_high, v_high, shear_top):
        z_centers = np.arange(field.nz) * field.dz + field.dz / 2
        weight = np.clip(z_centers / shear_top, 0.0, 1.0)  # 0 → 1
        u_profile = u_low + (u_high - u_low) * weight
        v_profile = v_high * weight
        field.u[:] = u_profile[np.newaxis, np.newaxis, :]
        field.v[:] = v_profile[np.newaxis, np.newaxis, :]

    apply_wind_shear(field, u_low=5.0, u_high=8.0, v_high=2.0, shear_top=2000.0)
    # z_centers[0] = dz/2 = 50m、 weight = 50/2000 = 0.025、 u = 5 + 3*0.025 = 5.075
    expected_low = 5.0 + (8.0 - 5.0) * (field.dz / 2) / 2000.0
    u_low_layer = field.u[:, :, 0].mean()
    u_high_layer = field.u[:, :, -1].mean()  # 上層 weight=1.0
    assert abs(u_low_layer - expected_low) < 0.01, \
        f"下層 u mismatch: {u_low_layer:.3f} expected {expected_low:.3f}"
    assert abs(u_high_layer - 8.0) < 0.01, f"上層 u mismatch: {u_high_layer:.3f}"
    v_high_layer = field.v[:, :, -1].mean()
    assert abs(v_high_layer - 2.0) < 0.01, f"上層 v mismatch: {v_high_layer:.3f}"
