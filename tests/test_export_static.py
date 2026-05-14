"""brief 31: scripts/export_static.py の単体 test。

実 data/tiles.sqlite には依存せず、 fixture DB を tmp_path に作って export_gsi_dem_tree が
正しく PNG ツリーを書き出すことを確認する。 copy_pmtiles / copy_course は shutil.copy2 の
動作確認 + size 一致を pin する。
"""

from __future__ import annotations

import hashlib
import sqlite3
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import export_static  # noqa: E402


def _make_fixture_db(db_path: Path, rows: list[tuple[int, int, int, bytes]]) -> None:
    """rows = [(z, x, y, data), ...] で source='gsi_dem' fetch_status=200 行を埋める。"""
    con = sqlite3.connect(str(db_path))
    try:
        con.execute(
            "CREATE TABLE tiles ("
            "  source TEXT NOT NULL, zoom_level INTEGER NOT NULL,"
            "  tile_column INTEGER NOT NULL, tile_row INTEGER NOT NULL,"
            "  format TEXT NOT NULL, data BLOB, fetched_at TEXT NOT NULL,"
            "  fetch_status INTEGER NOT NULL DEFAULT 200,"
            "  PRIMARY KEY (source, zoom_level, tile_column, tile_row)"
            ")"
        )
        for z, x, y, data in rows:
            con.execute(
                "INSERT INTO tiles VALUES ('gsi_dem', ?, ?, ?, 'png', ?, '2025-01-01T00:00:00Z', 200)",
                (z, x, y, data),
            )
        con.commit()
    finally:
        con.close()


def test_export_gsi_dem_tree_empty_db(tmp_path: Path) -> None:
    """空 DB → 0 file export + 例外なし。"""
    db = tmp_path / "empty.sqlite"
    _make_fixture_db(db, [])
    out = tmp_path / "out"
    n = export_static.export_gsi_dem_tree(db, out)
    assert n == 0
    # tiles/gsi_dem 配下に PNG なし
    pngs = list((out / "tiles" / "gsi_dem").rglob("*.png")) if (out / "tiles" / "gsi_dem").exists() else []
    assert pngs == []


def test_export_gsi_dem_tree_writes_bytes_unchanged(tmp_path: Path) -> None:
    """PNG bytes が SHA256 で row data と一致 (= write_bytes、 encoding 破壊なし)。"""
    db = tmp_path / "with-rows.sqlite"
    # 3 row、 異なる zoom/x/y、 bytes は PNG magic 0x89 始まりの実 PNG header 風
    rows = [
        (8, 226, 100, b"\x89PNG\r\n\x1a\n" + b"\x00" * 100 + b"row_0"),
        (10, 905, 402, b"\x89PNG\r\n\x1a\n" + b"\xab" * 80 + b"row_1"),
        (14, 14488, 6440, b"\x89PNG\r\n\x1a\n" + b"\xcd\xef" * 50 + b"row_2"),
    ]
    _make_fixture_db(db, rows)
    out = tmp_path / "out"
    n = export_static.export_gsi_dem_tree(db, out)
    assert n == 3
    for z, x, y, data in rows:
        p = out / "tiles" / "gsi_dem" / str(z) / str(x) / f"{y}.png"
        assert p.exists(), f"missing: {p}"
        assert p.read_bytes() == data, f"bytes mismatch at {p}"
        assert hashlib.sha256(p.read_bytes()).hexdigest() == hashlib.sha256(data).hexdigest()


def test_copy_pmtiles_size_match(tmp_path: Path) -> None:
    """copy_pmtiles 後 size 一致 (= shutil.copy2)。"""
    src = tmp_path / "src.pmtiles"
    payload = b"PMTILES_FAKE" + b"\x00" * 1024
    src.write_bytes(payload)
    dst = tmp_path / "out" / "map.pmtiles"
    size = export_static.copy_pmtiles(src, dst)
    assert dst.exists()
    assert size == len(payload)
    assert dst.read_bytes() == payload


def test_copy_course_content_match(tmp_path: Path) -> None:
    """copy_course 後 内容一致 (= shutil.copy2、 JSON 改変なし)。"""
    src = tmp_path / "course.json"
    payload = '[{"lat": 35.4, "lon": 138.7, "elevation_m": 1000}]'
    src.write_text(payload, encoding="utf-8")
    dst = tmp_path / "out" / "course.json"
    size = export_static.copy_course(src, dst)
    assert dst.exists()
    assert size == len(payload.encode("utf-8"))
    assert dst.read_text(encoding="utf-8") == payload


def test_export_static_no_http_url_in_source() -> None:
    """物理 grep gate: export_static.py source 内に http:// / https:// 一切含まない (= 外部 fetch ゼロ規律)。"""
    src_path = REPO_ROOT / "scripts" / "export_static.py"
    text = src_path.read_text(encoding="utf-8")
    assert "http://" not in text, "external HTTP URL appeared in export_static.py"
    assert "https://" not in text, "external HTTPS URL appeared in export_static.py"


def test_main_argparse_smoke(tmp_path: Path) -> None:
    """main() が argparse + 3 関数 + print で 0 を返す (= CLI 接続 smoke)。"""
    db = tmp_path / "tiles.sqlite"
    _make_fixture_db(db, [(8, 226, 100, b"\x89PNG_x")])
    pmt = tmp_path / "fuji.pmtiles"
    pmt.write_bytes(b"PMTILES" + b"\x00" * 16)
    course = tmp_path / "course.json"
    course.write_text("[]", encoding="utf-8")
    out = tmp_path / "out"
    rc = export_static.main([
        "--db", str(db),
        "--pmtiles", str(pmt),
        "--course", str(course),
        "--out", str(out),
    ])
    assert rc == 0
    assert (out / "tiles" / "gsi_dem" / "8" / "226" / "100.png").exists()
    assert (out / "map.pmtiles").exists()
    assert (out / "course.json").exists()
