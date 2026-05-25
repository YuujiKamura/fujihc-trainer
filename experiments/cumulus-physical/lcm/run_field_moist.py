"""b104 山岳波 sim に BL 高湿初期化を載せ、 山岳 lift で凝結 → ライブカメラスケールの雲を出す。

b104 dry sim (= run_field_terrain.py) では q_v が exp decay の dry profile で q_sat 未達、
凝結 trigger せず q_l 全 0 だった。 本 sim runner では `apply_terrain_mask` で terrain_mask
を確定後、 BL (z<4000m、 ライブカメラ 5/25 16:22 写真の雲頂高度) を RH=95% で上書き、
地中 cell の q_v を 0 化。 西風 5m/s で b104 と同じ lift trigger、 over-saturation cell が
condense_step (= field_2d.py:163, τ_c=30s) で q_l に転換。

brief: ~/.agents/scratch/fujihc-trainer-project/b106-moist-bl-mountain-cloud.md
"""
from __future__ import annotations
import json
import time
from pathlib import Path

import numpy as np

import config
from field_2d import Field2D


BL_TOP = 4000.0       # [m] ライブカメラ層雲の雲頂高度 4km
TARGET_RH = 0.95      # 飽和の 95%、 lift で 100% 超えやすい余裕
DEFAULT_U_INIT = 5.0  # 西風 [m/s]、 b104 と同じ


def apply_terrain_mask(field: Field2D, terrain_h: np.ndarray):
    """terrain_h を mask として field に格納 (= run_field_terrain.py:22-33 と同形)"""
    z_centers = np.arange(field.nz) * field.dz + field.dz / 2
    mask = z_centers[np.newaxis, :] < terrain_h[:, np.newaxis]
    field.terrain_mask = mask
    field.terrain_h = terrain_h
    print(f"terrain mask: 地中 cell = {mask.sum()}/{mask.size} ({mask.mean()*100:.1f}%)")
    print(f"terrain h: min={terrain_h.min():.0f}m max={terrain_h.max():.0f}m")


def step_with_terrain(field: Field2D, dt: float):
    """field.step + 地中 cell の u/w/q_l 0 化 (= run_field_terrain.py:36-44 と同形)"""
    field.step(dt)
    if hasattr(field, "terrain_mask"):
        m = field.terrain_mask
        field.u = np.where(m, 0.0, field.u)
        field.w = np.where(m, 0.0, field.w)
        field.q_l = np.where(m, 0.0, field.q_l)


def initialize_moist_bl(field: Field2D, bl_top: float, target_rh: float):
    """BL (z<bl_top) を q_sat × target_rh で上書き + 地中 cell q_v 0 化。

    軸5 audit 指摘: step_with_terrain は q_v を触らない (= field_2d.py 確認済)、
    BL 高湿初期化は terrain mask 適用後に呼び、 地中 cell の q_v を明示的に 0 化。
    """
    if bl_top > field.nz * field.dz:
        raise SystemExit(f"BL_TOP={bl_top}m が領域高 {field.nz * field.dz}m を超過")
    if not (0.0 < target_rh < 1.0):
        raise SystemExit(f"TARGET_RH={target_rh} は (0, 1) 範囲必須 (= 初期過飽和 θ 暴騰回避)")
    if not hasattr(field, "terrain_mask"):
        raise SystemExit("terrain mask 未設定、 apply_terrain_mask を先に呼べ")

    z_centers = np.arange(field.nz) * field.dz + field.dz / 2  # shape (nz,)
    T_env = field.theta_env * field.exner()                     # shape (nz,)
    q_sat_z = field.q_v_sat(T_env, field.p_env)                # shape (nz,)
    bl_z_mask = z_centers < bl_top                              # shape (nz,)

    n_bl_layer = int(bl_z_mask.sum())
    print(f"BL 高湿初期化: z<{bl_top:.0f}m ({n_bl_layer} layer) を RH={target_rh*100:.0f}% に上書き")
    print(f"  q_sat profile (BL 内 mean): {q_sat_z[bl_z_mask].mean()*1e3:.2f} g/kg")
    print(f"  q_v target (BL 内 mean): {(q_sat_z[bl_z_mask] * target_rh).mean()*1e3:.2f} g/kg")

    field.q_v[:, bl_z_mask] = q_sat_z[bl_z_mask] * target_rh
    field.q_v[field.terrain_mask] = 0.0


def main():
    out_dir = Path(__file__).parent / "output"
    out_dir.mkdir(exist_ok=True)

    cfg = config.get("fuji_2d_100m")
    print(cfg.summary())
    print()

    field = Field2D.from_config(cfg)

    terrain_path = Path(__file__).parent.parent / "obs" / "fixtures" / "terrain_1d_central.npy"
    if not terrain_path.exists():
        raise SystemExit(f"terrain 無し: {terrain_path}")
    terrain_h = np.load(terrain_path)
    print(f"terrain 読込: shape={terrain_h.shape}, max={terrain_h.max():.0f}m")
    apply_terrain_mask(field, terrain_h)

    initialize_moist_bl(field, BL_TOP, TARGET_RH)

    u_init = DEFAULT_U_INIT
    field.u[:] = u_init
    field.u[field.terrain_mask] = 0.0
    print(f"initial wind: u = +{u_init} m/s (= 西風)")
    print(field.summary())
    print()

    dt = cfg.time.dt
    n_step = int(cfg.time.sim_time / dt)
    output_interval = max(1, int(cfg.time.output_interval / dt))

    snapshots = []
    t0 = time.time()
    for step_idx in range(n_step):
        step_with_terrain(field, dt)
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
                "w": field.w.astype(np.float32).copy(),
            })

    total = time.time() - t0
    print(f"\n=== 完了 ===")
    print(f"wall time: {total:.2f}s ({total/60:.1f} min)")
    print(f"sim_time/wall: {(n_step) * dt / total:.2f}x")
    print(f"snapshots: {len(snapshots)}")

    q_l_max = max(snap["q_l"].max() for snap in snapshots)
    print(f"q_l global max: {q_l_max*1e3:.3f} g/kg")

    out_path = out_dir / "field_moist_snapshots.npz"
    save_dict = {}
    for i, snap in enumerate(snapshots):
        for key in ("theta", "q_v", "q_l", "u", "w"):
            save_dict[f"{key}_{i:03d}"] = snap[key]
    save_dict["steps"] = np.array([s["step"] for s in snapshots])
    save_dict["sim_times"] = np.array([s["sim_time"] for s in snapshots])
    save_dict["theta_env"] = field.theta_env
    save_dict["terrain_h"] = terrain_h
    save_dict["dx"] = np.array([field.dx])
    save_dict["dz"] = np.array([field.dz])
    np.savez_compressed(out_path, **save_dict)
    print(f"出力: {out_path} ({out_path.stat().st_size/1024:.1f} KB)")


if __name__ == "__main__":
    main()
