"""b108 = b107 3D voxel を 2D atlas として export (= viewer 改修なし、 preparation のみ)。

field_moist_3d_snapshots.npz (= 50×50×50 × 30 step) → 25×25×25 ダウンサンプル → 5×5 tile
配置で 125×125 atlas を 3 product 分生成、 既存 viewer / catalog は一切触らない。

scope = atlas bin file 3 個の生成のみ。 viewer shader / JS / catalog 改修は b109 別 brief、
user 戻り後 atomic commit (= schema_version bump + linear 拡張対応 + baseline png + 既存
5 dataset 後退テスト) で対応。

brief: ~/.agents/scratch/fujihc-trainer-project/b108-viewer-3d-atlas.md
"""
from __future__ import annotations
from pathlib import Path

import numpy as np


ATLAS_TILE_CELLS = 25         # 1 tile の cell 寸法 (= xz 各方向)
ATLAS_LAYOUT = (5, 5)         # tile grid (tx, ty)、 25 y layer を 5×5 配置
ATLAS_TEXTURE_SIZE = (125, 125)  # = 5 * 25
DOWNSAMPLE_FROM = (50, 50, 50)
DOWNSAMPLE_TO = (25, 25, 25)
N_SNAP = 30
PRODUCTS = ("w", "theta_prime", "q_l")


def coarsen_to_25_3d(arr_3d: np.ndarray) -> np.ndarray:
    """(50, 50, 50) → (25, 25, 25) area-weighted average (= 2×2×2 block 平均)"""
    nx, ny, nz = arr_3d.shape
    if (nx, ny, nz) != DOWNSAMPLE_FROM:
        raise AssertionError(f"expected {DOWNSAMPLE_FROM}, got {(nx, ny, nz)}")
    a = arr_3d.reshape(25, 2, ny, nz).mean(axis=1)    # x: 50→25
    a = a.reshape(25, 25, 2, nz).mean(axis=2)          # y: 50→25
    a = a.reshape(25, 25, 25, 2).mean(axis=3)          # z: 50→25
    return a


def pack_atlas(voxel_3d: np.ndarray) -> np.ndarray:
    """(25, 25, 25) → (125, 125) atlas、 row-major: tile (tx, ty) = y layer iy=ty*5+tx"""
    if voxel_3d.shape != DOWNSAMPLE_TO:
        raise AssertionError(f"expected {DOWNSAMPLE_TO}, got {voxel_3d.shape}")
    atlas = np.zeros(ATLAS_TEXTURE_SIZE, dtype=np.float32)
    tile = ATLAS_TILE_CELLS
    for iy in range(ATLAS_TILE_CELLS):
        ty_idx = iy // ATLAS_LAYOUT[0]
        tx_idx = iy % ATLAS_LAYOUT[0]
        atlas[ty_idx*tile:(ty_idx+1)*tile, tx_idx*tile:(tx_idx+1)*tile] = voxel_3d[:, iy, :]
    return atlas


def main():
    here = Path(__file__).parent
    npz_path = here / "output" / "field_moist_3d_snapshots.npz"
    if not npz_path.exists():
        raise SystemExit(f"snapshots 無し: {npz_path}、 lcm/run_field_moist_3d.py を先に実行")

    data = np.load(npz_path)
    n_snap = len(data["steps"])
    if n_snap != N_SNAP:
        raise AssertionError(f"expected {N_SNAP} snapshot, got {n_snap}")
    print(f"snapshots: {n_snap}")

    viewer_dir = here.parent / "viewer"
    theta_env_3d = data["theta_env"][np.newaxis, np.newaxis, :]

    for product in PRODUCTS:
        atlas_stack = np.zeros((n_snap, *ATLAS_TEXTURE_SIZE), dtype=np.float32)
        for i in range(n_snap):
            if product == "theta_prime":
                arr_3d = data[f"theta_{i:03d}"].astype(np.float64) - theta_env_3d
            elif product == "q_l":
                arr_3d = data[f"q_l_{i:03d}"].astype(np.float64) * 1e3  # kg/kg → g/kg
            else:
                arr_3d = data[f"{product}_{i:03d}"].astype(np.float64)
            voxel_25 = coarsen_to_25_3d(arr_3d)
            atlas_stack[i] = pack_atlas(voxel_25).astype(np.float32)

        bin_path = viewer_dir / f"field_moist_3d_{product}.bin"
        atlas_stack.tofile(bin_path)
        clean = np.nan_to_num(atlas_stack)
        size_kb = bin_path.stat().st_size / 1024
        print(f"  {product:12s} (125×125)×{n_snap}step → {bin_path.name}  "
              f"({size_kb:.1f} KB)  range=[{clean.min():+.3g}, {clean.max():+.3g}]")

    print(f"\natlas bin 生成完了 (= catalog touch なし、 viewer 改修なし、 既存 dataset 不変)")
    print(f"  viewer 改修は b109 別 brief、 user 戻り後 atomic commit")


if __name__ == "__main__":
    main()
