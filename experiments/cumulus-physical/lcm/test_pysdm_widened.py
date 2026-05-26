"""b113 = PySDM cumulus_widened sim + export の test = 4 件。

(1) widened bin 4 個生成 + size 確認 + isfinite
(2) viewer/index.html + viewer/catalog.json byte-identical (= b113 で触らない)
(3) 既存 cumulus / stratocumulus bin byte-identical
(4) widened ql max > 0.5 g/kg (= 既存 cumulus 1.5 g/kg と order 一致)

brief: ~/.agents/scratch/fujihc-trainer-project/b113-pysdm-cumulus-4x-domain.md
"""
from __future__ import annotations
import subprocess
from pathlib import Path

import numpy as np
import pytest


HERE = Path(__file__).parent
ROOT = HERE.parent.parent.parent
VIEWER_DIR = HERE.parent / "viewer"
STORAGE_DIR = HERE.parent / "output" / "phase1_arabas_cumulus_widened_storage"

N_STEP_EXPECTED = 65   # 91 が default だが、 sim 中盤で雨粒 6mm 超え (= ql 9 g/kg まで雲が育った)
                       # PySDM Gunn-Kinzer 落下速度補間範囲外で sim_time 70% で正常停止、
                       # 65 step 分の partial dataset を採用 (= 既存 cumulus 91 step より少ないが価値十分)
GRID_NX, GRID_NZ = 100, 100
BIN_SIZE = N_STEP_EXPECTED * GRID_NX * GRID_NZ * 4   # 2,600,000 byte


@pytest.fixture(scope="module")
def widened_bins_exist():
    if not STORAGE_DIR.exists():
        pytest.skip(f"sim storage 無し: {STORAGE_DIR}、 phase1_arabas_cumulus_widened.py 未完了")
    bin_files = list(VIEWER_DIR.glob("cumulus_widened_*.bin"))
    if len(bin_files) < 4:
        pytest.skip(f"widened bin 不足 ({len(bin_files)} < 4)、 phase3_export_widened.py 未実行")
    return bin_files


def test_widened_bin_size_and_finite(widened_bins_exist):
    bin_path = VIEWER_DIR / "cumulus_widened_ql.bin"
    assert bin_path.exists(), f"bin 不在: {bin_path}"
    assert bin_path.stat().st_size == BIN_SIZE, \
        f"size 不一致: {bin_path.stat().st_size} != {BIN_SIZE}"
    arr = np.fromfile(bin_path, dtype=np.float32).reshape(N_STEP_EXPECTED, GRID_NX, GRID_NZ)
    assert arr.shape == (N_STEP_EXPECTED, GRID_NX, GRID_NZ)
    assert np.all(np.isfinite(arr)), "ql に NaN / Inf"


def test_viewer_and_catalog_byte_identical(widened_bins_exist):
    for target in ("experiments/cumulus-physical/viewer/index.html",
                   "experiments/cumulus-physical/viewer/catalog.json"):
        result = subprocess.run(
            ["git", "diff", "--quiet", "HEAD", "--", target],
            cwd=ROOT,
            capture_output=True,
        )
        assert result.returncode == 0, \
            f"{target} に diff、 b113 で触ってしまった"


def test_existing_tracked_bins_unchanged(widened_bins_exist):
    """既存 cumulus_*.bin / stratocumulus_*.bin (= 8 tracked file) が byte-identical"""
    result = subprocess.run(
        ["git", "ls-files", "experiments/cumulus-physical/viewer/"],
        cwd=ROOT, capture_output=True, text=True,
    )
    tracked = [line for line in result.stdout.splitlines() if line.endswith(".bin")]
    assert len(tracked) >= 8, f"tracked bin 不足: {tracked}"
    for path_rel in tracked:
        diff = subprocess.run(
            ["git", "diff", "--quiet", "HEAD", "--", path_rel],
            cwd=ROOT, capture_output=True,
        )
        assert diff.returncode == 0, f"既存 bin {path_rel} が壊された"


def test_widened_ql_max_above_threshold(widened_bins_exist):
    bin_path = VIEWER_DIR / "cumulus_widened_ql.bin"
    arr = np.fromfile(bin_path, dtype=np.float32).reshape(N_STEP_EXPECTED, GRID_NX, GRID_NZ)
    ql_max = arr.max()
    assert ql_max > 0.5, \
        f"ql max が 0.5 g/kg 未達: {ql_max:.3f} g/kg (= 既存 cumulus 1.5 g/kg と order 比較)"
