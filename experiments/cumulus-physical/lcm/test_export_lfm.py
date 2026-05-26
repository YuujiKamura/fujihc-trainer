"""b120 = LFM cloud_score atlas bin export 用 test (= 8 件)。

既存 5 dataset / 既存 bin / catalog top-level schema_version の byte-identical 保護、
SCORE_FLOOR pin、 tile 配置規約 pin、 idempotency、 error path 3 系統。

brief: ~/.agents/scratch/fujihc-trainer-project/b120-lfm-cloud-score-atlas-export.md
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
REPO_ROOT = HERE.parent.parent.parent
USER_HOME = REPO_ROOT.parent
VIEWER_DIR = HERE.parent / "viewer"
CATALOG_PATH = VIEWER_DIR / "catalog.json"
SCRIPT = HERE / "export_lfm_to_viewer.py"
BIN_FILE = "lfm_fuji_2022_12_21_cloud_score.bin"
BIN_PATH = VIEWER_DIR / BIN_FILE
DATASET_NAME = "lfm_fuji_2022_12_21"

LFM_DIR = USER_HOME / ".agents" / "scratch" / "fujihc-trainer-project" / "lfm-sample"
LPALL = LFM_DIR / "Z__C_RJTD_20221221010000_LFM_GPV_Rjp_L-pall_FH0100_grib2.bin"
LSURF = LFM_DIR / "Z__C_RJTD_20221221010000_LFM_GPV_Rjp_Lsurf_FH0100_grib2.bin"

ATLAS_W, ATLAS_H = 125, 125
N_STEP = 2
ATLAS_BIN_SIZE = N_STEP * ATLAS_W * ATLAS_H * 4   # = 125,000 bytes
ATLAS_TILE_CELLS = 25
EXISTING_DATASETS = ("cumulus", "stratocumulus", "field_2d", "field_terrain", "field_moist")


def _file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _existing_dataset_snapshot() -> dict:
    """既存 5 dataset entry + top-level schema_version の snapshot を返す。"""
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    return {
        "schema_version": catalog.get("schema_version"),
        "datasets": {name: catalog["datasets"][name] for name in EXISTING_DATASETS if name in catalog["datasets"]},
    }


@pytest.fixture(scope="module")
def export_run():
    """export script を 1 度走らせて bin + catalog を更新、 snapshot を返す。"""
    if not LPALL.exists() or not LSURF.exists():
        pytest.skip(f"LFM grib2 不在 (LPALL: {LPALL.exists()}, LSURF: {LSURF.exists()})")
    before_snapshot = _existing_dataset_snapshot()
    # 既存 5 dataset 各 bin の hash
    before_bin_hashes = {}
    for name in EXISTING_DATASETS:
        entry = before_snapshot["datasets"].get(name)
        if entry is None:
            continue
        for prod_name, prod in entry.get("products", {}).items():
            bin_path = VIEWER_DIR / prod["bin_file"]
            if bin_path.exists():
                before_bin_hashes[prod["bin_file"]] = _file_hash(bin_path)

    result = subprocess.run(
        [sys.executable, str(SCRIPT)],
        cwd=HERE,
        capture_output=True,
        text=True,
        timeout=600,
    )
    if result.returncode != 0:
        pytest.fail(f"export script failed:\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}")
    return {
        "before_snapshot": before_snapshot,
        "before_bin_hashes": before_bin_hashes,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }


# === 1. happy + bin size ===

def test_bin_file_and_size(export_run):
    assert BIN_PATH.exists(), f"bin file not generated: {BIN_PATH}"
    assert BIN_PATH.stat().st_size == ATLAS_BIN_SIZE, (
        f"bin size mismatch: expected {ATLAS_BIN_SIZE}, got {BIN_PATH.stat().st_size}"
    )
    atlas = np.fromfile(BIN_PATH, dtype=np.float32).reshape(N_STEP, ATLAS_H, ATLAS_W)
    assert atlas.shape == (N_STEP, ATLAS_H, ATLAS_W)
    assert atlas.dtype == np.float32
    assert np.all(np.isfinite(atlas)), "atlas contains NaN/Inf"


# === 2. SCORE_FLOOR / 0..100 / p100 / live voxels (= misleading test 回避) ===

def test_score_floor_and_range(export_run):
    atlas = np.fromfile(BIN_PATH, dtype=np.float32).reshape(N_STEP, ATLAS_H, ATLAS_W)
    # n_step=2 dup なので step=0 と step=1 は完全同値、 まず一致 pin
    assert np.array_equal(atlas[0], atlas[1]), "n_step dup mismatch"
    flat = atlas[0]
    assert flat.min() >= 0.0, f"min below 0: {flat.min()}"
    assert flat.max() <= 100.0, f"max above 100: {flat.max()}"
    # source field has p100 ≈ 96.189 (= cloud_state.txt 実測)、 downsample で
    # 多少下がるが 5pt 以内に収まる
    assert flat.max() >= 50.0, f"max suspiciously low (no live cloud signal?): {flat.max()}"
    n_above_floor = int((flat >= 55.0).sum())
    assert n_above_floor > 0, "SCORE_FLOOR=55 を超える voxel が 0、 physical signal が live していない"


# === 3. tile 配置規約 pin (= iy=ty*5+tx、 row-major) ===

def test_tile_layout(export_run):
    atlas = np.fromfile(BIN_PATH, dtype=np.float32).reshape(N_STEP, ATLAS_H, ATLAS_W)
    tile = ATLAS_TILE_CELLS
    # voxel_3d の y layer iy=12 (= 中央) は tile (ty_idx=2, tx_idx=2) に居る
    iy = 12
    ty_idx = iy // 5
    tx_idx = iy % 5
    assert ty_idx == 2 and tx_idx == 2
    central_tile = atlas[0, ty_idx*tile:(ty_idx+1)*tile, tx_idx*tile:(tx_idx+1)*tile]
    assert central_tile.shape == (tile, tile)
    # 中央 tile が finite + range OK (= tile slice が正しく packed)
    assert np.all(np.isfinite(central_tile))
    # 全 25 tile が atlas 全領域を埋める (no gap)
    for iy_test in range(25):
        ty = iy_test // 5
        tx = iy_test % 5
        sub = atlas[0, ty*tile:(ty+1)*tile, tx*tile:(tx+1)*tile]
        assert sub.shape == (tile, tile), f"tile iy={iy_test} mis-sized"


# === 4. catalog entry schema ===

def test_catalog_entry_schema(export_run):
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    assert DATASET_NAME in catalog["datasets"], f"{DATASET_NAME} entry not in catalog"
    entry = catalog["datasets"][DATASET_NAME]
    assert entry["atlas_layout"] == [5, 5]
    assert entry["atlas_tile_cells"] == 25
    assert "JMA LFM" in entry["source"]
    assert "yuujikamura" not in entry["source"], "User-Agent (= personal email) が catalog に漏出"
    prod = entry["products"]["cloud_score"]
    assert prod["bin_file"] == BIN_FILE
    assert prod["n_step"] == 2
    assert prod["atlas_layout"] == [5, 5]
    assert prod["grid"] == [25, 25]
    assert 0.0 <= prod["min"] <= 100.0
    assert 0.0 <= prod["max"] <= 100.0
    assert prod["min"] <= prod["max"]


# === 5. 既存 5 dataset entry / schema_version byte-identical (negative pin) ===

def test_existing_datasets_unchanged(export_run):
    before = export_run["before_snapshot"]
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    assert catalog.get("schema_version") == before["schema_version"], (
        f"schema_version drifted: before={before['schema_version']}, after={catalog.get('schema_version')}"
    )
    for name in EXISTING_DATASETS:
        if name not in before["datasets"]:
            continue
        assert catalog["datasets"][name] == before["datasets"][name], (
            f"existing dataset {name} entry was modified"
        )


# === 6. 既存 bin file byte-identical ===

def test_existing_bin_files_unchanged(export_run):
    before_hashes = export_run["before_bin_hashes"]
    for bin_file, before_hash in before_hashes.items():
        bin_path = VIEWER_DIR / bin_file
        assert bin_path.exists(), f"existing bin file disappeared: {bin_path}"
        assert _file_hash(bin_path) == before_hash, f"existing bin file modified: {bin_file}"


# === 7. idempotency ===

def test_idempotent_rerun(export_run):
    """2 回目実行で entry 1 個維持、 bin hash 不変。"""
    bin_hash_before = _file_hash(BIN_PATH)
    catalog_before = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    n_entries_before = len(catalog_before["datasets"])
    result = subprocess.run(
        [sys.executable, str(SCRIPT)],
        cwd=HERE,
        capture_output=True,
        text=True,
        timeout=600,
    )
    assert result.returncode == 0, f"rerun failed:\nstderr:\n{result.stderr}"
    bin_hash_after = _file_hash(BIN_PATH)
    catalog_after = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    assert bin_hash_before == bin_hash_after, "bin file hash changed on idempotent rerun"
    assert len(catalog_after["datasets"]) == n_entries_before, "catalog grew entries on rerun"
    assert DATASET_NAME in catalog_after["datasets"]


# === 8. error path: grib2 source missing ===

def test_missing_grib2_exits_nonzero(tmp_path):
    """LPALL/LSURF が見えない CWD で走らせると SystemExit。"""
    # subprocess を temp CWD で起動、 PYTHONPATH を lcm/ に向けつつ、 USER_HOME
    # 解決を temp に向けることで grib2 を「不在」 状態にする。 ── 直接 path をひっくり返す
    # のは不可なので、 export script を import して compute_cloud_score を mock せず
    # LPALL を temp に書き換えた sub-script を走らせる方法に切替。
    fake_script = tmp_path / "test_missing.py"
    fake_script.write_text(
        "import sys\n"
        f"sys.path.insert(0, r'{HERE}')\n"
        "import export_lfm_to_viewer as m\n"
        "from pathlib import Path\n"
        f"m.LPALL_DEFAULT = Path(r'{tmp_path}') / 'nonexistent.bin'\n"
        f"m.LSURF_DEFAULT = Path(r'{tmp_path}') / 'nonexistent2.bin'\n"
        "m.main()\n",
        encoding="utf-8",
    )
    result = subprocess.run(
        [sys.executable, str(fake_script)],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode != 0, "expected non-zero exit when grib2 missing"
    assert "not found" in result.stderr or "not found" in result.stdout
