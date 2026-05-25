"""富士山地形 + 西風一様 で山岳起源対流の最初 sim。

field_2d.py 既存 (= b100 質量保存改善済) に terrain mask を追加、 下端境界として
富士山 1D 中央断面 (= obs/fixtures/terrain_1d_central.npy、 peak x=50 で 3755m) を
組み込む。 一様風 5 m/s を西から吹かせ、 富士山にぶつかって山岳起源 lift が出るか、
lee 側に山岳波が出るかを観察。

これは「業界に無い、 富士山 1 山に集中した物理計算」 の最初の踏み石、 user 2026-05-25
「ならやってみろ」 への着手。
"""
from __future__ import annotations
import json
import time
from pathlib import Path

import numpy as np

import config
from field_2d import Field2D


def apply_terrain_mask(field: Field2D, terrain_h: np.ndarray):
    """terrain_h (= 1D 標高 [m]、 shape (nx,)) を mask として field に格納。

    各 cell の z 中心が h(x) より下なら mask=True (= 地中)、 そこは u=w=0 固定。
    """
    z_centers = np.arange(field.nz) * field.dz + field.dz / 2  # shape (nz,)
    # mask shape (nx, nz)、 True = 地中
    mask = z_centers[np.newaxis, :] < terrain_h[:, np.newaxis]
    field.terrain_mask = mask
    field.terrain_h = terrain_h
    print(f"terrain mask: 地中 cell = {mask.sum()}/{mask.size} ({mask.mean()*100:.1f}%)")
    print(f"terrain h: min={terrain_h.min():.0f}m max={terrain_h.max():.0f}m peak idx={int(terrain_h.argmax())}")


def step_with_terrain(field: Field2D, dt: float):
    """field.step を呼び、 直後に terrain mask cell の u, w を 0 に固定 (= solid wall)"""
    field.step(dt)
    if hasattr(field, "terrain_mask"):
        m = field.terrain_mask
        field.u = np.where(m, 0.0, field.u)
        field.w = np.where(m, 0.0, field.w)
        # 地中の q_l も 0 (= 雲水は地中に無い)
        field.q_l = np.where(m, 0.0, field.q_l)


def main():
    out_dir = Path(__file__).parent / "output"
    out_dir.mkdir(exist_ok=True)

    cfg = config.get("fuji_2d_100m")
    print(cfg.summary())
    print()

    field = Field2D.from_config(cfg)

    # 富士山 1D 中央断面を terrain として
    terrain_path = Path(__file__).parent.parent / "obs" / "fixtures" / "terrain_1d_central.npy"
    if not terrain_path.exists():
        raise SystemExit(f"terrain 無し: {terrain_path}")
    terrain_h = np.load(terrain_path)
    print(f"terrain 読込: shape={terrain_h.shape}, max={terrain_h.max():.0f}m")
    apply_terrain_mask(field, terrain_h)

    # 西風 5 m/s を一様初期 (= u_2d を全 cell に +5)、 地中 cell は 0 に
    u_init = 5.0
    field.u[:] = u_init
    field.u[field.terrain_mask] = 0.0
    print(f"initial wind: u = +{u_init} m/s (= 西風)、 地中 cell 除外")
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

    out_path = out_dir / "field_terrain_snapshots.npz"
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
