"""b107 = 3D multicell sim runner + 量化 test = 4 件。

7. happy + 内容 sanity: shape (50, 50, 30) float32 + isfinite
8. q_l max > 0.5 g/kg (= ライブカメラ層雲下限)
9. multicell 量化: 6 連結成分 ≥ 2
10. y 軸方向 押出ではない negative pin: y slice 相対差 > 5%

brief: ~/.agents/scratch/fujihc-trainer-project/b107-3d-multicell-cumulus.md
"""
from __future__ import annotations
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
from scipy.ndimage import label


HERE = Path(__file__).parent
ROOT = HERE.parent.parent.parent
OUTPUT_DIR = HERE / "output"
SIM_NPZ = OUTPUT_DIR / "field_moist_3d_snapshots.npz"
RUN_SCRIPT = HERE / "run_field_moist_3d.py"

GRID_NX, GRID_NY, GRID_NZ = 50, 50, 50
N_SNAP_EXPECTED = 30


@pytest.fixture(scope="module")
def fresh_3d_sim():
    """run_field_moist_3d を 1 度実行、 全 test で再利用"""
    result = subprocess.run(
        [sys.executable, str(RUN_SCRIPT)],
        cwd=HERE,
        capture_output=True,
        text=True,
        timeout=1200,
    )
    if result.returncode != 0:
        pytest.fail(f"run_field_moist_3d failed: {result.stdout[-2000:]}\n{result.stderr[-2000:]}")
    if not SIM_NPZ.exists():
        pytest.fail("npz output 不在")
    return np.load(SIM_NPZ)


def test_npz_shape_dtype_finite(fresh_3d_sim):
    data = fresh_3d_sim
    n_snap = len(data["steps"])
    assert n_snap == N_SNAP_EXPECTED, f"snapshot 数 {n_snap} != {N_SNAP_EXPECTED}"
    last = n_snap - 1
    for key_prefix in ("w", "v", "q_l", "theta", "q_v"):
        arr = data[f"{key_prefix}_{last:03d}"]
        assert arr.shape == (GRID_NX, GRID_NY, GRID_NZ), \
            f"{key_prefix}_{last:03d} shape 不一致: {arr.shape}"
        assert arr.dtype == np.float32, f"{key_prefix}_{last:03d} dtype 不一致"
        assert np.all(np.isfinite(arr)), \
            f"{key_prefix}_{last:03d} に NaN / Inf"


def test_q_l_max_above_threshold(fresh_3d_sim):
    last = N_SNAP_EXPECTED - 1
    q_l = fresh_3d_sim[f"q_l_{last:03d}"]
    q_l_max_g_per_kg = q_l.max() * 1e3
    assert q_l_max_g_per_kg > 0.5, \
        f"q_l max が 0.5 g/kg 未達: {q_l_max_g_per_kg:.3f} g/kg"


def test_multicell_two_or_more_connected_components(fresh_3d_sim):
    """6-連結成分 ≥ 2 (= multicell 定義)"""
    last = N_SNAP_EXPECTED - 1
    q_l = fresh_3d_sim[f"q_l_{last:03d}"]
    threshold_kg_per_kg = 1e-4  # 0.1 g/kg
    cloud_mask = q_l > threshold_kg_per_kg
    # 6 連結 structure: 中心 cell から +/-x, +/-y, +/-z の 6 方向のみ (対角なし)
    structure = np.zeros((3, 3, 3), dtype=bool)
    structure[1, 1, :] = True
    structure[1, :, 1] = True
    structure[:, 1, 1] = True
    labeled, n_components = label(cloud_mask, structure=structure)
    print(f"[multicell] connected components (6-conn, q_l > 0.1 g/kg): {n_components}")
    assert n_components >= 2, \
        f"multicell でない、 単独セル: n_components={n_components}"


def test_y_axis_not_uniform_extrusion(fresh_3d_sim):
    """y slice 間で q_l 場が完全同形でない (= 押出ではない pin)"""
    last = N_SNAP_EXPECTED - 1
    q_l = fresh_3d_sim[f"q_l_{last:03d}"]
    q_l_y10 = q_l[:, 10, :]
    q_l_y40 = q_l[:, 40, :]
    norm_y10 = np.linalg.norm(q_l_y10)
    norm_y40 = np.linalg.norm(q_l_y40)
    if norm_y10 + norm_y40 < 1e-10:
        pytest.fail(f"q_l 両 slice ともゼロ、 凝結未発生: norm_y10={norm_y10}, norm_y40={norm_y40}")
    rel_diff = np.linalg.norm(q_l_y10 - q_l_y40) / max(norm_y10, norm_y40, 1e-10)
    print(f"[y-slice] rel_diff = {rel_diff:.4f}")
    assert rel_diff > 0.05, \
        f"y slice 完全同形 ({rel_diff:.4f}) = 押出 trap、 3 軸 dynamics 不在"
