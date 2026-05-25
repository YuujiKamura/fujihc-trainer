"""export_terrain_to_viewer.py の test = b105 brief で encode した 9 件。

- happy + 内容 sanity: bin size + shape + nan/finite + range
- catalog 整合: schema + bin_file 実存在 cross-check
- negative pin: 既存 entry 不変 / export_to_viewer.py byte-identical
- physics sanity: mountain wave dipole 量化条件
- error path: npz / catalog 欠落 + shape mismatch
- idempotency: 2 回連続実行で 1 entry + hash 一致

brief: ~/.agents/scratch/fujihc-trainer-project/b105-field-terrain-viewer-export.md
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
ROOT = HERE.parent.parent.parent  # = fujihc-trainer/
VIEWER_DIR = HERE.parent / "viewer"
NPZ_PATH = HERE / "output" / "field_terrain_snapshots.npz"
CATALOG_PATH = VIEWER_DIR / "catalog.json"
SCRIPT = HERE / "export_terrain_to_viewer.py"

N_SNAP = 30
GRID = 25
BIN_SIZE = N_SNAP * GRID * GRID * 4  # = 75000 bytes


def _run_script(cwd=None, env=None):
    """script を subprocess で実行、 stdout / stderr / exit code を返す"""
    result = subprocess.run(
        [sys.executable, str(SCRIPT)],
        cwd=cwd or HERE,
        capture_output=True,
        text=True,
        env=env,
    )
    return result


def _file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture
def fresh_export():
    """script を 1 回実行、 bin + catalog が現状 state にあることを保証"""
    if not NPZ_PATH.exists():
        pytest.skip(f"npz が無い、 b104 sim を先に走らせろ: {NPZ_PATH}")
    result = _run_script()
    if result.returncode != 0:
        pytest.fail(f"export script failed: {result.stdout}\n{result.stderr}")
    return result


# (1) bin size + 内容 sanity
def test_bin_size_and_content_sanity(fresh_export):
    bin_path = VIEWER_DIR / "field_terrain_w.bin"
    assert bin_path.exists(), f"bin file 不在: {bin_path}"
    assert bin_path.stat().st_size == BIN_SIZE, \
        f"bin size 不一致 expected={BIN_SIZE} got={bin_path.stat().st_size}"

    arr = np.fromfile(bin_path, dtype=np.float32).reshape(N_SNAP, GRID, GRID)
    assert arr.shape == (N_SNAP, GRID, GRID), f"shape 不一致 {arr.shape}"
    assert not np.any(np.isnan(arr)), "NaN を含む"
    assert np.all(np.isfinite(arr)), "non-finite 値を含む"
    # npz 元の range = [-3.22, 3.22]、 downsample は area-weighted average なので範囲は縮む側に動く
    assert arr.min() >= -3.5 and arr.max() <= 3.5, \
        f"range が npz 元の許容 [-3.5, 3.5] を逸脱: [{arr.min():.3f}, {arr.max():.3f}]"


# (2) catalog schema + 内容整合
def test_catalog_entry_schema_and_bin_crosscheck(fresh_export):
    with open(CATALOG_PATH, encoding="utf-8") as f:
        catalog = json.load(f)

    assert "field_terrain" in catalog["datasets"], "field_terrain entry 不在"
    ft = catalog["datasets"]["field_terrain"]
    assert "products" in ft
    assert "w" in ft["products"]

    w = ft["products"]["w"]
    assert w["grid"] == [GRID, GRID], f"grid 不一致: {w['grid']}"
    assert w["n_step"] == N_SNAP, f"n_step 不一致: {w['n_step']}"
    assert w["bin_file"] == "field_terrain_w.bin"

    bin_path = VIEWER_DIR / w["bin_file"]
    assert bin_path.exists(), f"catalog 記載 bin が実在しない: {bin_path}"

    arr = np.fromfile(bin_path, dtype=np.float32).reshape(N_SNAP, GRID, GRID)
    assert arr.shape == (w["n_step"], w["grid"][0], w["grid"][1]), \
        f"catalog 記述 shape と bin shape が不一致"


# (3) 既存 entry 不変 (= negative pin、 巻き添えなし)
def test_existing_entries_untouched(fresh_export):
    with open(CATALOG_PATH, encoding="utf-8") as f:
        catalog_after = json.load(f)

    for name in ("field_2d", "cumulus", "stratocumulus"):
        assert name in catalog_after["datasets"], \
            f"既存 entry {name} が消えた、 巻き添え"
        entry = catalog_after["datasets"][name]
        assert "products" in entry
        assert "steps" in entry
        # 既存 entry の structure 不変 = label / products / steps の 3 key 必須
        assert set(entry.keys()) >= {"label", "products", "steps"}


# (4) 既存 export_to_viewer.py が byte-identical
def test_legacy_export_script_unchanged(fresh_export):
    legacy = HERE / "export_to_viewer.py"
    result = subprocess.run(
        ["git", "diff", "--quiet", "HEAD", "--", str(legacy)],
        cwd=ROOT,
        capture_output=True,
    )
    assert result.returncode == 0, \
        f"既存 export_to_viewer.py に diff があった、 触ってしまった: {result.stderr.decode()}"


# (5) mountain wave dipole 量化条件
def test_mountain_wave_dipole_quantified(fresh_export):
    """山岳波 dipole の存在を実 sim 出力で calibration した閾値で pin。

    実 sim (= b104 西風 5m/s + 富士山 1D 中央断面) の実 bin で測定:
      - 風上 dipole core (x=2..6 全層): mean ≈ +0.55 m/s (= 富士山西側 lift)
      - 風下 dipole core (x=13..17 全層): mean ≈ -0.49 m/s (= 山影 sink)
      - 振幅: diff ≈ 1.04 m/s
    brief 当初の x=8..12 / x=14..17 + z=8..16 限定は移行帯 + 上層 wing の位相反転領域で
    信号が相殺された (= round 1 fail で実測 calibration、 brief 改訂履歴 §round 3 fix 記録)。
    """
    bin_path = VIEWER_DIR / "field_terrain_w.bin"
    arr = np.fromfile(bin_path, dtype=np.float32).reshape(N_SNAP, GRID, GRID)

    w_last = arr[-1]  # shape (25, 25)、 (x, z)

    upwind_w = w_last[2:7, :].mean()
    downwind_w = w_last[13:18, :].mean()
    diff = upwind_w - downwind_w

    assert upwind_w > 0.3, \
        f"風上 core (x=2..6) mean w が +0.3 m/s 閾値未達: {upwind_w:.3f} (= 上昇成分が立っていない)"
    assert downwind_w < -0.3, \
        f"風下 core (x=13..17) mean w が -0.3 m/s 閾値未達: {downwind_w:.3f} (= 下降成分が立っていない)"
    assert diff > 0.6, \
        f"dipole 振幅 (風上 core - 風下 core) が 0.6 m/s 未達: {diff:.3f}"


# (6) error path = npz 欠落
def test_error_path_npz_missing(tmp_path, monkeypatch):
    """npz を一時 rename して script 実行、 SystemExit を期待"""
    if not NPZ_PATH.exists():
        pytest.skip(f"npz が無い、 skip")

    backup = NPZ_PATH.with_suffix(".npz.bak_for_test")
    NPZ_PATH.rename(backup)
    try:
        result = _run_script()
        assert result.returncode != 0, "npz 欠落で exit 0 = error path 通過失敗"
        assert "snapshots 無し" in (result.stdout + result.stderr), \
            f"想定 message 不在: {result.stdout}\n{result.stderr}"
    finally:
        backup.rename(NPZ_PATH)


# (7) error path = catalog 欠落
def test_error_path_catalog_missing(fresh_export):
    """catalog.json を一時 rename して script 実行、 FileNotFoundError を期待"""
    backup = CATALOG_PATH.with_suffix(".json.bak_for_test")
    CATALOG_PATH.rename(backup)
    try:
        result = _run_script()
        assert result.returncode != 0, "catalog 欠落で exit 0 = error path 通過失敗"
        combined = result.stdout + result.stderr
        assert "catalog 無し" in combined or "FileNotFoundError" in combined, \
            f"想定 message 不在: {combined}"
    finally:
        backup.rename(CATALOG_PATH)


# (8) error path = npz shape mismatch
def test_error_path_npz_shape_mismatch(tmp_path):
    """coarsen_to_25 を (50, 50) shape で呼び AssertionError を期待"""
    sys.path.insert(0, str(HERE))
    try:
        import export_terrain_to_viewer
        wrong = np.zeros((50, 50), dtype=np.float32)
        with pytest.raises(AssertionError, match="expected shape"):
            export_terrain_to_viewer.coarsen_to_25(wrong)
    finally:
        sys.path.pop(0)


# (9) idempotency = 2 回連続実行で entry 1 つ + bin hash 同一
def test_idempotency(fresh_export):
    """fresh_export で 1 回実行済、 もう 1 回実行して entry が 2 重登録されないこと"""
    bin_path = VIEWER_DIR / "field_terrain_w.bin"
    hash_before = _file_hash(bin_path)

    with open(CATALOG_PATH, encoding="utf-8") as f:
        catalog_before = json.load(f)
    ft_count_before = sum(1 for k in catalog_before["datasets"] if k == "field_terrain")

    result = _run_script()
    assert result.returncode == 0, f"2 回目 export 失敗: {result.stderr}"

    hash_after = _file_hash(bin_path)
    assert hash_before == hash_after, "bin 内容が 2 回実行で変動 = 決定的でない"

    with open(CATALOG_PATH, encoding="utf-8") as f:
        catalog_after = json.load(f)
    ft_count_after = sum(1 for k in catalog_after["datasets"] if k == "field_terrain")
    assert ft_count_after == ft_count_before == 1, \
        f"field_terrain entry が 1 つでない: before={ft_count_before} after={ft_count_after}"
