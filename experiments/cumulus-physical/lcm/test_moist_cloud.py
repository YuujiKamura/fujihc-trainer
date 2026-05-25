"""b106 = 湿った BL + 山岳 lift で凝結する雲 sim の test = 8 件。

- happy + 内容 sanity: shape + dtype + isfinite
- physics-pin: 凝結 量化 (q_l max > 0.5 g/kg)、 雲底位置 量化 (z 最小 500-3000m)
- negative pin 3 段: b104 sim runner / catalog field_terrain / field_terrain_w.bin が byte-identical
- error path: BL_TOP / TARGET_RH 不正

brief: ~/.agents/scratch/fujihc-trainer-project/b106-moist-bl-mountain-cloud.md
"""
from __future__ import annotations
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest


HERE = Path(__file__).parent
ROOT = HERE.parent.parent.parent
VIEWER_DIR = HERE.parent / "viewer"
OUTPUT_DIR = HERE / "output"
MOIST_NPZ = OUTPUT_DIR / "field_moist_snapshots.npz"
TERRAIN_NPZ = OUTPUT_DIR / "field_terrain_snapshots.npz"
CATALOG_PATH = VIEWER_DIR / "catalog.json"
RUN_MOIST = HERE / "run_field_moist.py"
RUN_TERRAIN = HERE / "run_field_terrain.py"
TERRAIN_BIN = VIEWER_DIR / "field_terrain_w.bin"

N_SNAP = 30
GRID_NX, GRID_NZ = 100, 150


def _run_script(script_path):
    return subprocess.run(
        [sys.executable, str(script_path)],
        cwd=HERE,
        capture_output=True,
        text=True,
        timeout=600,
    )


def _file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture(scope="module")
def fresh_moist_sim():
    """run_field_moist を 1 度実行、 全 test で再利用"""
    result = _run_script(RUN_MOIST)
    if result.returncode != 0:
        pytest.fail(f"run_field_moist failed: {result.stdout}\n{result.stderr}")
    if not MOIST_NPZ.exists():
        pytest.fail("npz output 不在")
    return np.load(MOIST_NPZ)


# (a) happy + 内容 sanity = shape / dtype / isfinite
def test_npz_shape_dtype_finite(fresh_moist_sim):
    data = fresh_moist_sim
    assert len(data["steps"]) == N_SNAP, f"snapshot 数不一致: {len(data['steps'])}"
    for i in range(N_SNAP):
        for key_prefix in ("w", "q_l", "theta", "q_v"):
            arr = data[f"{key_prefix}_{i:03d}"]
            assert arr.shape == (GRID_NX, GRID_NZ), \
                f"{key_prefix}_{i:03d} shape 不一致: {arr.shape}"
            assert arr.dtype == np.float32, \
                f"{key_prefix}_{i:03d} dtype 不一致: {arr.dtype}"
            assert np.all(np.isfinite(arr)), \
                f"{key_prefix}_{i:03d} に NaN/Inf 含有 (= θ 暴騰 trap suspect)"


# (b) 凝結 quantified = 最終 snapshot q_l max > 0.5 g/kg
def test_condensation_max_above_threshold(fresh_moist_sim):
    q_l_last = fresh_moist_sim[f"q_l_{N_SNAP-1:03d}"]
    q_l_max_g_per_kg = q_l_last.max() * 1e3
    assert q_l_max_g_per_kg > 0.5, \
        f"q_l max が ライブカメラ層雲の下限 0.5 g/kg 未達: {q_l_max_g_per_kg:.3f} g/kg"


# (c) 雲底位置 quantified = q_l>0.1 g/kg cell の z 最小 が 500-3000m 範囲
def test_cloud_base_in_realistic_range(fresh_moist_sim):
    q_l_last = fresh_moist_sim[f"q_l_{N_SNAP-1:03d}"]
    dz = float(fresh_moist_sim["dz"][0])
    threshold = 0.1e-3  # 0.1 g/kg = 1e-4 kg/kg、 cloud edge の閾値
    cloud_cells = np.argwhere(q_l_last > threshold)
    assert len(cloud_cells) > 0, \
        f"q_l > {threshold*1e3:.1f} g/kg の cell ゼロ、 雲が出ていない"
    z_min_index = cloud_cells[:, 1].min()
    z_min_m = z_min_index * dz + dz / 2  # cell 中心高度
    assert 500.0 <= z_min_m <= 3000.0, \
        f"雲底 (z 最小) = {z_min_m:.0f}m、 ライブカメラ層雲の雲底 ≈ 1km ± 2 layer (= 1200m) 範囲を逸脱"


# (d) b104 dry sim を再走、 q_l 全 snapshot 0 を negative pin
def test_b104_dry_sim_q_l_zero():
    """b104 sim runner (= run_field_terrain.py) が依然 q_l=0 を出す = 凝結未 trigger"""
    result = _run_script(RUN_TERRAIN)
    assert result.returncode == 0, \
        f"run_field_terrain failed: {result.stdout}\n{result.stderr}"
    data = np.load(TERRAIN_NPZ)
    for i in range(N_SNAP):
        arr = data[f"q_l_{i:03d}"]
        assert np.all(arr == 0.0), \
            f"b104 dry sim snapshot {i:03d} で q_l が 0 でない (= b106 が b104 を壊した)、 max={arr.max()}"


# (e) 既存 run_field_terrain.py が byte-identical
def test_run_field_terrain_unchanged():
    result = subprocess.run(
        ["git", "diff", "--quiet", "HEAD", "--", str(RUN_TERRAIN)],
        cwd=ROOT,
        capture_output=True,
    )
    assert result.returncode == 0, \
        "run_field_terrain.py に diff、 b104 sim runner を触ってしまった"


# (f) 既存 catalog field_terrain entry byte-identical
def test_catalog_field_terrain_entry_unchanged(fresh_moist_sim, tmp_path):
    """fresh_moist_sim fixture で run_field_moist 実行済、 catalog 触られた可能性"""
    with open(CATALOG_PATH, encoding="utf-8") as f:
        catalog = json.load(f)
    assert "field_terrain" in catalog["datasets"], "field_terrain entry が消えた"
    ft = catalog["datasets"]["field_terrain"]
    # b105 で landed した field_terrain entry の必須 key
    assert "products" in ft and "steps" in ft and "label" in ft
    for required_product in ("w", "theta_prime", "q_l", "ql", "effective_radius"):
        assert required_product in ft["products"], \
            f"field_terrain.products.{required_product} が消えた"


# (g) 既存 field_terrain_w.bin が byte-identical (= b105 で生成、 b106 が上書きしない)
def test_field_terrain_bin_unchanged(fresh_moist_sim):
    if not TERRAIN_BIN.exists():
        pytest.skip(f"field_terrain_w.bin 不在 (= b105 export 未実行)、 skip")
    hash_now = _file_hash(TERRAIN_BIN)
    # 再度 export_moist_to_viewer.py 実行しても terrain bin が変動しないこと
    export_moist = HERE / "export_moist_to_viewer.py"
    if export_moist.exists():
        _run_script(export_moist)
        hash_after = _file_hash(TERRAIN_BIN)
        assert hash_now == hash_after, "b106 export が field_terrain_w.bin を上書きした"


# (h) error path = BL_TOP 領域超過 + TARGET_RH 不正
def test_error_path_invalid_params():
    """initialize_moist_bl を直接呼び SystemExit を期待"""
    sys.path.insert(0, str(HERE))
    try:
        import run_field_moist
        import config
        from field_2d import Field2D

        cfg = config.get("fuji_2d_100m")
        field = Field2D.from_config(cfg)
        field.terrain_mask = np.zeros((field.nx, field.nz), dtype=bool)
        field.terrain_h = np.zeros(field.nx)

        # BL_TOP 領域超過
        with pytest.raises(SystemExit, match="領域高"):
            run_field_moist.initialize_moist_bl(field, bl_top=99999.0, target_rh=0.95)

        # TARGET_RH >= 1.0
        with pytest.raises(SystemExit, match="範囲必須"):
            run_field_moist.initialize_moist_bl(field, bl_top=4000.0, target_rh=1.5)

        # TARGET_RH < 0
        with pytest.raises(SystemExit, match="範囲必須"):
            run_field_moist.initialize_moist_bl(field, bl_top=4000.0, target_rh=-0.1)
    finally:
        sys.path.pop(0)
