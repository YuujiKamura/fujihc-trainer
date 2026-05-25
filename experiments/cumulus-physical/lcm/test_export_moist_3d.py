"""b108 = atlas bin 生成 test = 5 件。 viewer / catalog / 既存 bin の byte-identical 保護。

brief: ~/.agents/scratch/fujihc-trainer-project/b108-viewer-3d-atlas.md
"""
from __future__ import annotations
import hashlib
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest


HERE = Path(__file__).parent
ROOT = HERE.parent.parent.parent
VIEWER_DIR = HERE.parent / "viewer"
OUTPUT_DIR = HERE / "output"
SIM_NPZ = OUTPUT_DIR / "field_moist_3d_snapshots.npz"
SCRIPT = HERE / "export_moist_3d_to_viewer.py"

ATLAS_W, ATLAS_H = 125, 125
N_SNAP = 30
ATLAS_BIN_SIZE = N_SNAP * ATLAS_W * ATLAS_H * 4  # = 1,875,000 byte


def _file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture(scope="module")
def fresh_atlas():
    if not SIM_NPZ.exists():
        pytest.skip(f"sim npz 不在: {SIM_NPZ}、 run_field_moist_3d.py を先に")
    result = subprocess.run(
        [sys.executable, str(SCRIPT)],
        cwd=HERE,
        capture_output=True,
        text=True,
        timeout=300,
    )
    if result.returncode != 0:
        pytest.fail(f"export failed: {result.stdout[-1500:]}\n{result.stderr[-1500:]}")
    return result


def test_atlas_bin_size_and_finite(fresh_atlas):
    for product in ("w", "theta_prime", "q_l"):
        bin_path = VIEWER_DIR / f"field_moist_3d_{product}.bin"
        assert bin_path.exists(), f"bin 不在: {bin_path}"
        assert bin_path.stat().st_size == ATLAS_BIN_SIZE, \
            f"size 不一致: {bin_path.stat().st_size} != {ATLAS_BIN_SIZE}"
        arr = np.fromfile(bin_path, dtype=np.float32).reshape(N_SNAP, ATLAS_H, ATLAS_W)
        assert arr.shape == (N_SNAP, ATLAS_H, ATLAS_W)
        assert np.all(np.isfinite(arr)), f"{product} に NaN / Inf"


def test_atlas_tile_layout_consistency(fresh_atlas):
    """全 25 y layer が atlas tile に正しい配置で配置されるか pin

    pack_atlas の規約: iy ∈ [0, 24]、 ty_idx = iy // 5、 tx_idx = iy % 5
    tile (tx_idx, ty_idx) の 25×25 block = voxel_3d[:, iy, :]
    """
    sys.path.insert(0, str(HERE))
    try:
        import export_moist_3d_to_viewer as m
        rng = np.random.default_rng(0)
        voxel_25 = rng.standard_normal((25, 25, 25)).astype(np.float32)
        atlas = m.pack_atlas(voxel_25)
        assert atlas.shape == (125, 125)

        for iy in range(25):
            ty_idx = iy // 5
            tx_idx = iy % 5
            tile = atlas[ty_idx*25:(ty_idx+1)*25, tx_idx*25:(tx_idx+1)*25]
            expected = voxel_25[:, iy, :]
            np.testing.assert_allclose(tile, expected, rtol=1e-6, atol=1e-7,
                                       err_msg=f"tile iy={iy} (tx={tx_idx}, ty={ty_idx}) mismatch")
    finally:
        sys.path.pop(0)


def test_viewer_and_catalog_byte_identical(fresh_atlas):
    """viewer/index.html + catalog.json が完全 byte-identical (= b108 で touch なし)"""
    for target in ("experiments/cumulus-physical/viewer/index.html",
                   "experiments/cumulus-physical/viewer/catalog.json"):
        result = subprocess.run(
            ["git", "diff", "--quiet", "HEAD", "--", target],
            cwd=ROOT,
            capture_output=True,
        )
        assert result.returncode == 0, \
            f"{target} に diff、 b108 で触ってしまった"


def test_tracked_existing_bin_unchanged(fresh_atlas):
    """tracked 既存 bin (= cumulus_*.bin / stratocumulus_*.bin 8 file) が byte-identical"""
    result = subprocess.run(
        ["git", "ls-files", "experiments/cumulus-physical/viewer/"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    tracked = [line for line in result.stdout.splitlines() if line.endswith(".bin")]
    assert len(tracked) >= 8, f"tracked bin が予想より少ない: {tracked}"
    for path_rel in tracked:
        diff_result = subprocess.run(
            ["git", "diff", "--quiet", "HEAD", "--", path_rel],
            cwd=ROOT,
            capture_output=True,
        )
        assert diff_result.returncode == 0, \
            f"tracked bin {path_rel} に diff = b108 が壊した"


def test_error_path_shape_mismatch():
    """coarsen_to_25_3d を 非 (50,50,50) で呼び AssertionError"""
    sys.path.insert(0, str(HERE))
    try:
        import export_moist_3d_to_viewer as m
        wrong = np.zeros((40, 40, 40), dtype=np.float32)
        with pytest.raises(AssertionError, match="expected"):
            m.coarsen_to_25_3d(wrong)
        wrong2 = np.zeros((20, 20, 20), dtype=np.float32)
        with pytest.raises(AssertionError, match="expected"):
            m.pack_atlas(wrong2)
    finally:
        sys.path.pop(0)
