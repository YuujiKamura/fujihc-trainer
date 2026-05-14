"""brief 15: fetch_gsi_dem.py の 全関数 mandate test.

fetch_one (happy / 404 / その他 HTTPError) / insert_tile / confirm_or_abort を
mock 駆動で網羅する. 実 GSI server には絶対叩かない (= user 判断、 script 実行
は user の手元).
"""

from __future__ import annotations

import io
import sqlite3
import sys
import urllib.error
from pathlib import Path
from unittest.mock import patch

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "src"))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import fetch_gsi_dem  # noqa: E402


# brief 14 schema を inline (peer 1 の init_tile_db.py が未 land でも自立 test
# 可能にするため). 本物の schema は scripts/init_tile_db.py に landed 予定、
# 本 test は schema の存在のみに依存し fetch_status 列だけを assert する.
SCHEMA_SQL = """
PRAGMA user_version = 1;
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


@pytest.fixture
def tmp_db(tmp_path):
    """brief 14 schema を持つ tmp SQLite DB."""
    db_path = tmp_path / "tiles.sqlite"
    db = sqlite3.connect(db_path)
    db.executescript(SCHEMA_SQL)
    db.commit()
    yield db
    db.close()


# ----- fetch_one -----


def test_fetch_one_happy_returns_200_and_bytes():
    """200 OK + body bytes が返る (urlopen mock)."""
    fake_body = b"\x89PNG\r\n\x1a\nfake_png_bytes"
    fake_resp = io.BytesIO(fake_body)
    # context manager 用に __enter__ / __exit__ を持つ wrapper
    class _CM:
        def __enter__(self):
            return fake_resp

        def __exit__(self, *a):
            return False

    with patch("fetch_gsi_dem.urllib.request.urlopen", return_value=_CM()):
        status, data = fetch_gsi_dem.fetch_one(14, 14552, 6451, "ua/test")
    assert status == 200
    assert data == fake_body


def test_fetch_one_404_returns_404_and_none():
    """404 は raise せず (404, None) を返す (= 海面下 / 山頂周辺タイル用)."""
    err = urllib.error.HTTPError(
        url="http://x", code=404, msg="Not Found", hdrs=None, fp=None
    )
    with patch("fetch_gsi_dem.urllib.request.urlopen", side_effect=err):
        status, data = fetch_gsi_dem.fetch_one(14, 14552, 6451, "ua/test")
    assert status == 404
    assert data is None


def test_fetch_one_other_http_error_raises():
    """500 等の 404 以外の HTTPError は raise する (= rate limit / server down 検知)."""
    err = urllib.error.HTTPError(
        url="http://x", code=500, msg="Server Error", hdrs=None, fp=None
    )
    with patch("fetch_gsi_dem.urllib.request.urlopen", side_effect=err):
        with pytest.raises(urllib.error.HTTPError):
            fetch_gsi_dem.fetch_one(14, 14552, 6451, "ua/test")


# ----- insert_tile -----


def test_insert_tile_200_and_404_rows(tmp_db):
    """200 行は data あり、 404 行は data NULL、 fetch_status 列に正しい値."""
    fetch_gsi_dem.insert_tile(tmp_db, "gsi_dem", 14, 1, 2, 200, b"png_bytes")
    fetch_gsi_dem.insert_tile(tmp_db, "gsi_dem", 14, 3, 4, 404, None)
    tmp_db.commit()

    rows = tmp_db.execute(
        "SELECT zoom_level, tile_column, tile_row, data, fetch_status "
        "FROM tiles WHERE source=? ORDER BY tile_column",
        ("gsi_dem",),
    ).fetchall()
    assert len(rows) == 2
    # 200 row
    assert rows[0] == (14, 1, 2, b"png_bytes", 200)
    # 404 row: data is NULL
    assert rows[1][:3] == (14, 3, 4)
    assert rows[1][3] is None
    assert rows[1][4] == 404


# ----- confirm_or_abort -----


def test_confirm_or_abort_under_threshold_returns_true():
    """threshold 以下なら prompt せず True."""
    assert fetch_gsi_dem.confirm_or_abort(36, 1000, force=False) is True


def test_confirm_or_abort_over_threshold_force_returns_true():
    """threshold 超 + force=True なら prompt skip して True (CI 用)."""
    assert fetch_gsi_dem.confirm_or_abort(5000, 1000, force=True) is True


def test_confirm_or_abort_over_threshold_input_y_returns_true(monkeypatch):
    """threshold 超 + input 'y' なら True."""
    monkeypatch.setattr("builtins.input", lambda *_a, **_k: "y")
    assert fetch_gsi_dem.confirm_or_abort(5000, 1000, force=False) is True


def test_confirm_or_abort_over_threshold_input_n_returns_false(monkeypatch):
    """threshold 超 + input 'n' なら False (= abort path)."""
    monkeypatch.setattr("builtins.input", lambda *_a, **_k: "n")
    assert fetch_gsi_dem.confirm_or_abort(5000, 1000, force=False) is False
