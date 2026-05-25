"""terrain_100m.npz (= b102 で landed、 100×100×100m grid) から中央 50×50 を抽出、
2D fixture `fixtures/terrain_2d_central.npy` として保存。 b107 multicell 3D sim 用。

外部 fetch ゼロ (= 既存 fujihc DEM cache 再利用、 GSI 配布元負荷ゼロ)。
1 回限り生成、 idempotent (= 同 input → 同 output)。

brief: ~/.agents/scratch/fujihc-trainer-project/b107-3d-multicell-cumulus.md
"""
from __future__ import annotations
from pathlib import Path

import numpy as np


HERE = Path(__file__).parent
INPUT = HERE / "fixtures" / "terrain_100m.npz"
OUTPUT = HERE / "fixtures" / "terrain_2d_central.npy"


def main():
    if not INPUT.exists():
        raise SystemExit(f"input 不在: {INPUT}、 obs/build_terrain_grid.py を先に実行")
    data = np.load(INPUT)
    print(f"input keys: {list(data.files)}")
    terrain = None
    for key in ("terrain", "elevation", "h", "z"):
        if key in data.files:
            terrain = data[key]
            print(f"terrain key = '{key}', shape = {terrain.shape}")
            break
    if terrain is None:
        terrain = data[data.files[0]]
        print(f"terrain key = first ('{data.files[0]}'), shape = {terrain.shape}")

    if terrain.ndim != 2:
        raise SystemExit(f"expected 2D terrain, got shape {terrain.shape}")
    nx, ny = terrain.shape
    if nx < 50 or ny < 50:
        raise SystemExit(f"terrain too small for 50×50 center crop: {terrain.shape}")

    cx, cy = nx // 2, ny // 2
    terrain_2d = terrain[cx - 25:cx + 25, cy - 25:cy + 25].astype(np.float32)
    print(f"center crop: shape={terrain_2d.shape}, min={terrain_2d.min():.0f}m, "
          f"max={terrain_2d.max():.0f}m, peak idx={np.unravel_index(terrain_2d.argmax(), terrain_2d.shape)}")

    terrain_2d_clean = np.nan_to_num(terrain_2d, nan=500.0)
    if not np.allclose(terrain_2d, terrain_2d_clean, equal_nan=True):
        n_nan = int(np.isnan(terrain_2d).sum())
        print(f"NaN 検出: {n_nan} cell、 500m で置換")

    np.save(OUTPUT, terrain_2d_clean)
    print(f"出力: {OUTPUT} ({OUTPUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
