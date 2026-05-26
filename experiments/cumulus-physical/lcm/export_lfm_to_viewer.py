"""b120 = LFM cloud_score を sandbox viewer 用 atlas bin として export。

lfm_cloud_score.compute_cloud_score を呼んで (121, 90, 90) cloud_score を取得、
(25, 25, 25) に block-mean area-weighted downsample、 b108 pack_atlas で
5x5 tile の (125, 125) atlas にパック、 n_step=2 で同 timestep dup
(= 既存 viewer の step slider が >= 2 仮定でも壊れない)、 catalog に
1 entry 追加。 既存 5 dataset / 既存 bin は完全 byte-identical。

LFM zip の再 fetch / 別 timestep 拡張時の User-Agent は LFM_FETCH_USER_AGENT
で物理 pin (= fujihc-trainer/CLAUDE.md 配布元配慮、 「嘘の連絡先を送るな」 規律)。

ref:
  - brief: ~/.agents/scratch/fujihc-trainer-project/b120-lfm-cloud-score-atlas-export.md
"""
from __future__ import annotations
import json
import os
import sys
import tempfile
from pathlib import Path

import numpy as np

from lfm_cloud_score import compute_cloud_score
from export_moist_3d_to_viewer import pack_atlas


# === configuration ===
LFM_FETCH_USER_AGENT = "fujihc-trainer/0.1 (yuujikamura@gmail.com)"

HERE = Path(__file__).parent
REPO_ROOT = HERE.parent.parent.parent      # fujihc-trainer/
USER_HOME = REPO_ROOT.parent                # C:/Users/yuuji/

# LFM grib2 source (= scratch、 前 session で 1 回 fetch 済)
LFM_DIR = USER_HOME / ".agents" / "scratch" / "fujihc-trainer-project" / "lfm-sample"
LPALL_DEFAULT = LFM_DIR / "Z__C_RJTD_20221221010000_LFM_GPV_Rjp_L-pall_FH0100_grib2.bin"
LSURF_DEFAULT = LFM_DIR / "Z__C_RJTD_20221221010000_LFM_GPV_Rjp_Lsurf_FH0100_grib2.bin"

# Sandbox viewer dataset target
VIEWER_DIR = HERE.parent / "viewer"
CATALOG_PATH = VIEWER_DIR / "catalog.json"
DATASET_NAME = "lfm_fuji_2022_12_21"
BIN_FILE = "lfm_fuji_2022_12_21_cloud_score.bin"

# Atlas geometry (= b108 SoT 踏襲)
TARGET_SHAPE = (25, 25, 25)   # (nz, ny, nx) downsample target
ATLAS_TILE_CELLS = 25
ATLAS_LAYOUT = (5, 5)
N_STEP = 2                    # dup the same field, satisfies existing >= 2 step slider


def atomic_write_json(path: Path, obj: dict) -> None:
    """tmp file + os.replace で atomic 置換 (= b108 / b105 慣習踏襲、 partial JSON 防止)。

    SoT は本来 export_terrain_to_viewer.py / export_moist_to_viewer.py 内、 import 不可
    (= 同名 file が package ではないため from-import 解決が壊れる) なので本 script 内に
    function 同型で再 encode。 b120 着手 step で確認した limitation、 SoT 二重定義は
    catalog json 書換 atomic 性のためで、 1 catalog file は同時に 1 writer のみ。
    """
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(json.dumps(obj, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp_path, path)


def block_mean_downsample(arr_3d: np.ndarray, target_shape: tuple) -> np.ndarray:
    """Non-integer ratio に対応した area-weighted downsample。

    (snz, sny, snx) を (tnz, tny, tnx) に、 軸毎に fractional weighting を計算した
    averaging matrix を構築し einsum で合算。 b108 coarsen_to_25_3d (= 整数比 2x2x2)
    と思想同型、 非整数比を fractional overlap で扱う拡張。

    Returns float32 array of shape target_shape.
    """
    src = np.asarray(arr_3d, dtype=np.float64)
    if src.ndim != 3:
        raise AssertionError(f"expected 3D array, got shape {src.shape}")
    tnz, tny, tnx = target_shape
    snz, sny, snx = src.shape

    def avg_matrix(src_n: int, target_n: int) -> np.ndarray:
        """target 1D bin と source 1D bin の overlap length を normalize した matrix。"""
        M = np.zeros((target_n, src_n), dtype=np.float64)
        for j in range(target_n):
            lo_t = j / target_n
            hi_t = (j + 1) / target_n
            for i in range(src_n):
                lo_s = i / src_n
                hi_s = (i + 1) / src_n
                overlap = max(0.0, min(hi_s, hi_t) - max(lo_s, lo_t))
                M[j, i] = overlap
        row_sum = M.sum(axis=1, keepdims=True)
        row_sum[row_sum == 0] = 1.0   # safety against zero-overlap rows
        return M / row_sum

    Mz = avg_matrix(snz, tnz)
    My = avg_matrix(sny, tny)
    Mx = avg_matrix(snx, tnx)
    out = np.einsum("ai,bj,ck,ijk->abc", Mz, My, Mx, src)
    return out.astype(np.float32)


def build_atlas_n_step(voxel_3d: np.ndarray, n_step: int) -> np.ndarray:
    """voxel_3d (25, 25, 25) → atlas (n_step, 125, 125) float32 by duping。"""
    atlas_2d = pack_atlas(voxel_3d)
    return np.stack([atlas_2d for _ in range(n_step)], axis=0).astype(np.float32)


def main():
    if not LPALL_DEFAULT.exists():
        print(f"error: LFM L-pall not found: {LPALL_DEFAULT}", file=sys.stderr)
        raise SystemExit(1)
    if not LSURF_DEFAULT.exists():
        print(f"error: LFM L-surf not found: {LSURF_DEFAULT}", file=sys.stderr)
        raise SystemExit(1)
    if not CATALOG_PATH.exists():
        print(f"error: catalog.json not found: {CATALOG_PATH}", file=sys.stderr)
        raise SystemExit(1)

    print(f"LFM source User-Agent (= for any re-fetch / new timestep): {LFM_FETCH_USER_AGENT}")
    print("Computing cloud_score (= lfm_cloud_score.compute_cloud_score) ...")
    res = compute_cloud_score(LPALL_DEFAULT, LSURF_DEFAULT)
    cloud_score = res["cloud_score"]
    print(f"  source shape: {cloud_score.shape}, range [{np.nanmin(cloud_score):.1f}, {np.nanmax(cloud_score):.1f}]")

    print(f"Downsampling to {TARGET_SHAPE} (block-mean area-weighted) ...")
    voxel_3d = block_mean_downsample(cloud_score, TARGET_SHAPE)
    voxel_3d = np.clip(voxel_3d, 0.0, 100.0)
    n_above_floor = int((voxel_3d >= 55.0).sum())
    print(f"  downsampled shape: {voxel_3d.shape}, range [{voxel_3d.min():.1f}, {voxel_3d.max():.1f}], score>=55: {n_above_floor}/{voxel_3d.size}")

    print(f"Packing to atlas (n_step={N_STEP} dup) ...")
    atlas_n_step = build_atlas_n_step(voxel_3d, N_STEP)
    bin_path = VIEWER_DIR / BIN_FILE
    atlas_n_step.tofile(bin_path)
    bin_bytes = bin_path.stat().st_size
    print(f"  wrote {bin_path} ({bin_bytes} bytes = {bin_bytes/1024.0:.1f} KB)")

    print(f"Updating catalog.json (atomic merge) ...")
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    entry = {
        "label": "LFM 2km cloud_score (2022-12-21 02:00 JST +1h)",
        "atlas_layout": list(ATLAS_LAYOUT),
        "atlas_tile_cells": ATLAS_TILE_CELLS,
        "source": (
            "JMA LFM GPV sample (= 気象庁 局地数値予報モデル 2km、 "
            "lfmmodel_221221.zip、 "
            "https://www.data.jma.go.jp/developer/gpv_sample.html)"
        ),
        "products": {
            "cloud_score": {
                "unit": "score 0..100 (= ice-saturated RH max-blend cover_3d + ascent bonus - subsid penalty)",
                "n_step": N_STEP,
                "grid": [ATLAS_TILE_CELLS, ATLAS_TILE_CELLS],
                "atlas_layout": list(ATLAS_LAYOUT),
                "min": round(float(voxel_3d.min()), 6),
                "max": round(float(voxel_3d.max()), 6),
                "mean": round(float(voxel_3d.mean()), 6),
                "bin_size_kb": round(bin_bytes / 1024.0, 1),
                "bin_file": BIN_FILE,
            },
        },
        "steps": list(range(N_STEP)),
    }
    catalog["datasets"][DATASET_NAME] = entry
    atomic_write_json(CATALOG_PATH, catalog)
    print(f"  catalog entry added: datasets.{DATASET_NAME}")
    print("done.")


if __name__ == "__main__":
    main()
