"""2D 鉛直断面 Eulerian 場の最小走行: warm bubble → 上昇 → 凝結 → 雲発達。

config の fuji_2d_100m preset を駆動。 ローカル PC で 15k cell × 1800 step、 数十分想定。
"""
from __future__ import annotations
import json
import time
from pathlib import Path

import numpy as np

import config
from field_2d import Field2D


def main():
    out_dir = Path(__file__).parent / "output"
    out_dir.mkdir(exist_ok=True)

    cfg = config.get("fuji_2d_100m")
    print(cfg.summary())
    print()

    field = Field2D.from_config(cfg)
    # 地表中央付近に warm bubble = 古典的 thermal trigger
    x_center = cfg.domain.lx / 2
    z_center = 500.0  # 地上 500m
    radius = 1000.0
    dtheta = 2.0  # +2K
    field.add_warm_bubble(x_center, z_center, radius, dtheta)
    print(f"warm bubble: center=({x_center}, {z_center}), radius={radius}m, dθ=+{dtheta}K")
    print(field.summary())
    print()

    dt = cfg.time.dt
    n_step = int(cfg.time.sim_time / dt)
    output_interval = max(1, int(cfg.time.output_interval / dt))

    # snapshot 保存 (= 30 frame くらい)
    snapshots = []
    t0 = time.time()
    for step_idx in range(n_step):
        field.step(dt)
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
        # 早期停止: 全 cell の |w|, q_l が 微小なら停止
        if step_idx > 100 and np.abs(field.w).max() < 0.01 and field.q_l.max() < 1e-7:
            print(f"step {step_idx}: 場が静止、 早期停止")
            break

    total = time.time() - t0
    print(f"\n=== 完了 ===")
    print(f"wall time: {total:.2f}s ({total/60:.1f} min)")
    print(f"sim_time/wall: {(step_idx + 1) * dt / total:.2f}x")
    print(f"snapshots: {len(snapshots)}")

    # 結果を npz で保存
    out_path = out_dir / "field_2d_snapshots.npz"
    save_dict = {}
    for i, snap in enumerate(snapshots):
        for key in ("theta", "q_v", "q_l", "u", "w"):
            save_dict[f"{key}_{i:03d}"] = snap[key]
    save_dict["steps"] = np.array([snap["step"] for snap in snapshots])
    save_dict["sim_times"] = np.array([snap["sim_time"] for snap in snapshots])
    save_dict["theta_env"] = field.theta_env
    save_dict["dx"] = np.array([field.dx])
    save_dict["dz"] = np.array([field.dz])
    np.savez_compressed(out_path, **save_dict)
    print(f"出力: {out_path} ({out_path.stat().st_size/1024:.1f} KB)")


if __name__ == "__main__":
    main()
