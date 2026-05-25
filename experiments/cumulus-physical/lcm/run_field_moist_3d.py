"""b107 = 真 3 軸 field_3d + 富士山 2D terrain + multicell trigger 3 種 (= wind shear / BL 高湿 / random thermal) で複合多層雲を生成。

b106 (= 2D field + 1D 富士山断面) では 1 column 凝結 = 単独セル。 本 sim は y 軸 dynamics
+ 2D 山岳 + 3 種 trigger で複数対流セルが空間的に隣接 + 異なる成熟段階で並ぶ multicell
組織化対流を狙う。

brief: ~/.agents/scratch/fujihc-trainer-project/b107-3d-multicell-cumulus.md
"""
from __future__ import annotations
import time
from pathlib import Path

import numpy as np

import config
from field_3d import Field3D


BL_TOP = 4000.0
TARGET_RH = 0.95
U_LOW = 5.0
U_HIGH = 8.0
V_HIGH = 2.0
SHEAR_TOP = 3000.0
THERMAL_NOISE_K = 0.3
THERMAL_NOISE_Z_TOP = 2000.0
SEED = 42


def apply_terrain_mask_3d(field: Field3D, terrain_2d: np.ndarray):
    """terrain_2d (= shape (nx, ny) 標高 [m]) を field の各 (x, y) で z 中心と比較、
    z 中心 < h(x, y) なら mask=True (= 地中)。 step_with_terrain で u/v/w/q_l を 0 強制。
    """
    if terrain_2d.shape != (field.nx, field.ny):
        raise SystemExit(f"terrain shape {terrain_2d.shape} != ({field.nx}, {field.ny})")
    z_centers = np.arange(field.nz) * field.dz + field.dz / 2  # (nz,)
    h_xy = terrain_2d[:, :, np.newaxis]                          # (nx, ny, 1)
    mask = z_centers[np.newaxis, np.newaxis, :] < h_xy            # (nx, ny, nz)
    field.terrain_mask = mask
    field.terrain_h = terrain_2d
    print(f"terrain mask: 地中 cell = {mask.sum()}/{mask.size} ({mask.mean()*100:.1f}%)")
    print(f"terrain h: min={terrain_2d.min():.0f}m max={terrain_2d.max():.0f}m peak={np.unravel_index(terrain_2d.argmax(), terrain_2d.shape)}")


def step_with_terrain_3d(field: Field3D, dt: float):
    field.step(dt)
    if hasattr(field, "terrain_mask"):
        m = field.terrain_mask
        field.u = np.where(m, 0.0, field.u)
        field.v = np.where(m, 0.0, field.v)
        field.w = np.where(m, 0.0, field.w)
        field.q_l = np.where(m, 0.0, field.q_l)


def initialize_moist_bl_3d(field: Field3D, bl_top: float, target_rh: float):
    if bl_top > field.nz * field.dz:
        raise SystemExit(f"BL_TOP={bl_top}m が領域高 {field.nz * field.dz}m を超過")
    if not (0.0 < target_rh < 1.0):
        raise SystemExit(f"TARGET_RH={target_rh} は (0, 1) 範囲必須")
    if not hasattr(field, "terrain_mask"):
        raise SystemExit("terrain mask 未設定、 apply_terrain_mask_3d を先に呼べ")

    z_centers = np.arange(field.nz) * field.dz + field.dz / 2
    T_env = field.theta_env * field.exner()
    q_sat_z = field.q_v_sat(T_env, field.p_env)
    bl_z_mask = z_centers < bl_top
    n_bl_layer = int(bl_z_mask.sum())
    print(f"BL 高湿初期化: z<{bl_top:.0f}m ({n_bl_layer} layer) を RH={target_rh*100:.0f}% に")
    print(f"  q_sat (BL 内 mean): {q_sat_z[bl_z_mask].mean()*1e3:.2f} g/kg")
    field.q_v[:, :, bl_z_mask] = q_sat_z[bl_z_mask] * target_rh
    field.q_v[field.terrain_mask] = 0.0


def apply_wind_shear(field: Field3D, u_low: float, u_high: float,
                     v_high: float, shear_top: float):
    """鉛直 wind shear: z<shear_top で線形遷移、 z>=shear_top で上層値固定"""
    z_centers = np.arange(field.nz) * field.dz + field.dz / 2
    weight = np.clip(z_centers / shear_top, 0.0, 1.0)
    u_profile = u_low + (u_high - u_low) * weight
    v_profile = v_high * weight
    field.u[:] = u_profile[np.newaxis, np.newaxis, :]
    field.v[:] = v_profile[np.newaxis, np.newaxis, :]
    if hasattr(field, "terrain_mask"):
        field.u[field.terrain_mask] = 0.0
        field.v[field.terrain_mask] = 0.0
    print(f"wind shear: u {u_low}→{u_high} m/s, v 0→{v_high} m/s, shear_top={shear_top}m")


def add_random_thermal(field: Field3D, amplitude_K: float, z_top: float, seed: int):
    """BL 内 random thermal noise (= 決定的 seed)、 multiple thermal pulse trigger"""
    rng = np.random.default_rng(seed)
    z_centers = np.arange(field.nz) * field.dz + field.dz / 2
    z_mask = z_centers < z_top
    perturbation = rng.standard_normal((field.nx, field.ny, field.nz)) * amplitude_K
    perturbation[:, :, ~z_mask] = 0.0
    if hasattr(field, "terrain_mask"):
        perturbation[field.terrain_mask] = 0.0
    field.theta += perturbation
    print(f"random thermal: ±{amplitude_K} K (= seed={seed}), z<{z_top}m")


def main():
    out_dir = Path(__file__).parent / "output"
    out_dir.mkdir(exist_ok=True)

    cfg = config.get("fuji_3d_100m")
    print(cfg.summary())
    print()

    field = Field3D.from_config(cfg)

    terrain_path = Path(__file__).parent.parent / "obs" / "fixtures" / "terrain_2d_central.npy"
    if not terrain_path.exists():
        raise SystemExit(f"terrain 無し: {terrain_path}、 obs/extract_terrain_2d.py を先に実行")
    terrain_2d = np.load(terrain_path)
    print(f"terrain 読込: shape={terrain_2d.shape}, max={terrain_2d.max():.0f}m")
    apply_terrain_mask_3d(field, terrain_2d)

    initialize_moist_bl_3d(field, BL_TOP, TARGET_RH)
    apply_wind_shear(field, U_LOW, U_HIGH, V_HIGH, SHEAR_TOP)
    add_random_thermal(field, THERMAL_NOISE_K, THERMAL_NOISE_Z_TOP, SEED)
    print(field.summary())
    print()

    dt = cfg.time.dt
    n_step = int(cfg.time.sim_time / dt)
    output_interval = max(1, int(cfg.time.output_interval / dt))

    snapshots = []
    t0 = time.time()
    for step_idx in range(n_step):
        step_with_terrain_3d(field, dt)
        if step_idx % output_interval == 0:
            elapsed = time.time() - t0
            sim_time = step_idx * dt
            print(f"step {step_idx:5d}  sim={sim_time:6.0f}s  wall={elapsed:6.1f}s  {field.summary()}", flush=True)
            snapshots.append({
                "step": int(step_idx),
                "sim_time": float(sim_time),
                "theta": field.theta.astype(np.float32).copy(),
                "q_v": field.q_v.astype(np.float32).copy(),
                "q_l": field.q_l.astype(np.float32).copy(),
                "u": field.u.astype(np.float32).copy(),
                "v": field.v.astype(np.float32).copy(),
                "w": field.w.astype(np.float32).copy(),
            })

    total = time.time() - t0
    print(f"\n=== 完了 ===")
    print(f"wall time: {total:.2f}s ({total/60:.1f} min)")
    print(f"sim_time/wall: {(n_step) * dt / total:.2f}x")
    q_l_max = max(snap["q_l"].max() for snap in snapshots)
    v_max = max(np.abs(snap["v"]).max() for snap in snapshots)
    print(f"q_l global max: {q_l_max*1e3:.3f} g/kg")
    print(f"|v| global max: {v_max:.3f} m/s")

    out_path = out_dir / "field_moist_3d_snapshots.npz"
    save_dict = {}
    for i, snap in enumerate(snapshots):
        for key in ("theta", "q_v", "q_l", "u", "v", "w"):
            save_dict[f"{key}_{i:03d}"] = snap[key]
    save_dict["steps"] = np.array([s["step"] for s in snapshots])
    save_dict["sim_times"] = np.array([s["sim_time"] for s in snapshots])
    save_dict["theta_env"] = field.theta_env
    save_dict["terrain_2d"] = terrain_2d
    save_dict["dx"] = np.array([field.dx])
    save_dict["dy"] = np.array([field.dy])
    save_dict["dz"] = np.array([field.dz])
    np.savez_compressed(out_path, **save_dict)
    print(f"出力: {out_path} ({out_path.stat().st_size/1024/1024:.1f} MB)")


if __name__ == "__main__":
    main()
