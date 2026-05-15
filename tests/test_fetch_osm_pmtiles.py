"""brief 16: scripts/fetch_osm_pmtiles.py の unit test (全関数 mandate)."""
import sqlite3
import sys
from pathlib import Path
from unittest.mock import MagicMock

# src/ と scripts/ を path に追加 (= fujihill package と script 両方 import 可)
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / 'src'))
sys.path.insert(0, str(REPO_ROOT / 'scripts'))
import fetch_osm_pmtiles  # noqa: E402


# brief 14 schema の最小 inline 版 (= peer 1 が landing する前でも test 通す)
SCHEMA_SQL = """
CREATE TABLE tiles (
  source TEXT NOT NULL,
  zoom_level INTEGER NOT NULL,
  tile_column INTEGER NOT NULL,
  tile_row INTEGER NOT NULL,
  format TEXT NOT NULL,
  data BLOB,
  fetched_at TEXT NOT NULL,
  fetch_status INTEGER NOT NULL DEFAULT 200,
  PRIMARY KEY (source, zoom_level, tile_column, tile_row)
);
CREATE TABLE metadata (
  source TEXT NOT NULL,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (source, name)
);
"""


def _fresh_db():
    db = sqlite3.connect(':memory:')
    db.executescript(SCHEMA_SQL)
    return db


def test_extract_tile_happy_returns_bytes():
    """reader.get が bytes 返したらそのまま return."""
    reader = MagicMock()
    reader.get.return_value = b'\x1f\x8b\x08\x00fake-pbf-bytes'
    result = fetch_osm_pmtiles.extract_tile(reader, 17, 116296, 51625)
    assert result == b'\x1f\x8b\x08\x00fake-pbf-bytes'
    reader.get.assert_called_once_with(17, 116296, 51625)


def test_extract_tile_out_of_range_returns_none():
    """reader.get が None 返したら None そのまま return (= 範囲外)."""
    reader = MagicMock()
    reader.get.return_value = None
    result = fetch_osm_pmtiles.extract_tile(reader, 17, 0, 0)
    assert result is None


def test_insert_tile_status_200_with_data():
    """status=200 / data=bytes で row 入る."""
    db = _fresh_db()
    fetch_osm_pmtiles.insert_tile(db, 'osm', 17, 116296, 51625, 200, b'pbf-bytes')
    db.commit()
    rows = list(db.execute(
        'SELECT source, zoom_level, tile_column, tile_row, format, data, fetch_status '
        'FROM tiles'
    ))
    assert len(rows) == 1
    assert rows[0] == ('osm', 17, 116296, 51625, 'pbf', b'pbf-bytes', 200)


def test_insert_tile_status_404_with_none_data():
    """status=404 / data=None でも行は残る (= 再試行スキップ用)."""
    db = _fresh_db()
    fetch_osm_pmtiles.insert_tile(db, 'osm', 17, 99999, 99999, 404, None)
    db.commit()
    rows = list(db.execute(
        'SELECT data, fetch_status FROM tiles WHERE zoom_level=17 AND tile_column=99999'
    ))
    assert len(rows) == 1
    assert rows[0][0] is None
    assert rows[0][1] == 404


def test_compute_to_fetch_happy_subtracts_existing_and_sorts():
    """wanted=5 / existing=2 → 3 件 sort 済."""
    wanted = {
        (17, 116296, 51625),
        (17, 116297, 51625),
        (17, 116296, 51626),
        (17, 116297, 51626),
        (17, 116298, 51625),
    }
    existing = {
        (17, 116296, 51625),
        (17, 116297, 51625),
    }
    result = fetch_osm_pmtiles.compute_to_fetch(wanted, existing)
    assert len(result) == 3
    # sort 済 (= tuple の自然順)
    assert result == sorted(result)
    # 期待 3 件が正しい
    assert set(result) == {
        (17, 116296, 51626),
        (17, 116297, 51626),
        (17, 116298, 51625),
    }


def test_compute_to_fetch_all_existing_returns_empty():
    """wanted ⊆ existing なら空 list."""
    wanted = {(17, 1, 1), (17, 2, 2)}
    existing = {(17, 1, 1), (17, 2, 2), (17, 3, 3)}
    result = fetch_osm_pmtiles.compute_to_fetch(wanted, existing)
    assert result == []


def test_compute_to_fetch_deterministic_same_input_same_output():
    """同 input → 同 output (= JS 版と cross-check するための前提)."""
    wanted = {(17, 5, 5), (17, 3, 3), (17, 1, 1), (17, 4, 4), (17, 2, 2)}
    existing = {(17, 3, 3)}
    r1 = fetch_osm_pmtiles.compute_to_fetch(wanted, existing)
    r2 = fetch_osm_pmtiles.compute_to_fetch(wanted, existing)
    assert r1 == r2
    assert r1 == [(17, 1, 1), (17, 2, 2), (17, 4, 4), (17, 5, 5)]


# ----- main() smoke -----


def test_main_dummy_run(tmp_path, monkeypatch):
    """main() を mock 経由で 1 周走らせる (= integration smoke).

    course load → enumerate → existing 集計 → confirm skip (--force) →
    PMTiles reader.get で 1 件抽出 → metadata 書き込み. pmtiles.reader.Reader を
    MagicMock に差し替えて実 PMTiles file 無しで走らせる.
    """
    from unittest.mock import patch as _patch

    import init_tile_db  # type: ignore[import-not-found]

    db_path = tmp_path / "tiles.sqlite"
    init_tile_db.init_db(db_path)

    course_path = tmp_path / "course.json"
    course_path.write_text(
        '[{"lat": 35.4, "lon": 138.7, "elevation_m": 1000, "distance_m": 0}]',
        encoding="utf-8",
    )

    # ダミー .pmtiles file (= open() が成功するだけで良い、 中身は Reader mock が読む)
    pmtiles_path = tmp_path / "japan.pmtiles"
    pmtiles_path.write_bytes(b"\x00" * 16)

    # Reader / MmapSource を差し替え: reader.get は固定 bytes を返す
    fake_reader = MagicMock()
    fake_reader.get.return_value = b"\x1f\x8b\x08\x00fake-pbf-tile-bytes"

    # pmtiles package が無い環境でも import エラーで止まらないよう sys.modules に shim を挿す
    fake_mod_reader = MagicMock()
    fake_mod_reader.Reader = MagicMock(return_value=fake_reader)
    fake_mod_reader.MmapSource = MagicMock(return_value=MagicMock())
    monkeypatch.setitem(sys.modules, "pmtiles", MagicMock())
    monkeypatch.setitem(sys.modules, "pmtiles.reader", fake_mod_reader)

    monkeypatch.setattr(
        sys, "argv",
        [
            "fetch_osm_pmtiles.py",
            "--pmtiles", str(pmtiles_path),
            "--course", str(course_path),
            "--db", str(db_path),
            "--corridor-tiles", "1",
            "--force",
        ],
    )

    fetch_osm_pmtiles.main()

    # DB に osm tile row が入った確認
    with sqlite3.connect(db_path) as db:
        n_tiles = db.execute(
            "SELECT COUNT(*) FROM tiles WHERE source='osm'"
        ).fetchone()[0]
        assert n_tiles >= 1, "main() must insert at least one osm tile"
        meta_n = db.execute(
            "SELECT COUNT(*) FROM metadata WHERE source='osm'"
        ).fetchone()[0]
        assert meta_n >= 4, (
            f"metadata rows for osm too few: {meta_n}"
        )
