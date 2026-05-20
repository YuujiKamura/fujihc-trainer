"""http_app の静的 file 配信 route が動くかの test (= 26b 補完).

bridge.py の /tiles/ と同一 origin で viewer HTML / JS を serve できることを pin する。
そうでないと viewer の `fetch('/tiles/_setup_status')` が CORS で死ぬ + そもそも
viewer がブラウザに load されない (= 26b 動作確認できない)。
"""
from pathlib import Path

import pytest
from aiohttp.test_utils import TestClient, TestServer

from fujihc.http_app import make_http_app


@pytest.fixture
async def client(tmp_path):
    db = tmp_path / "tiles.sqlite"
    db.touch()
    course = tmp_path / "course.json"
    course.write_text("[]", encoding="utf-8")
    web_root = tmp_path / "web"
    web_root.mkdir()
    (web_root / "index.html").write_text(
        "<!doctype html><html><body><h1>fujihc</h1></body></html>", encoding="utf-8"
    )
    (web_root / "viewer-maplibre.js").write_text("// dummy js", encoding="utf-8")
    (web_root / "course.json").write_text("[]", encoding="utf-8")
    app = make_http_app(db_path=db, course_path=course, web_root=web_root)
    async with TestClient(TestServer(app)) as c:
        yield c


@pytest.mark.asyncio
async def test_root_returns_index_html(client):
    resp = await client.get("/")
    assert resp.status == 200
    assert resp.headers["Content-Type"].startswith("text/html")
    body = await resp.text()
    assert "fujihc" in body


@pytest.mark.asyncio
async def test_static_js_served(client):
    resp = await client.get("/viewer-maplibre.js")
    assert resp.status == 200


@pytest.mark.asyncio
async def test_course_json_served(client):
    resp = await client.get("/course.json")
    assert resp.status == 200


@pytest.mark.asyncio
async def test_tiles_route_not_shadowed_by_static(client, tmp_path):
    # /tiles/* は static で奪われず、 tile_server が 503 (= DB 空) を返す
    resp = await client.get("/tiles/gsi_dem/14/0/0.png")
    # DB は touch だけで schema 無い → 503 か 500 のいずれか、 200 が返ったら static に奪われた証拠
    assert resp.status != 200


@pytest.mark.asyncio
async def test_web_root_missing_does_not_crash(tmp_path):
    db = tmp_path / "tiles.sqlite"
    db.touch()
    course = tmp_path / "course.json"
    course.write_text("[]", encoding="utf-8")
    # web_root 不在でも app 構築は成功 (= 静的 route は登録されないだけ)
    app = make_http_app(db_path=db, course_path=course, web_root=tmp_path / "no_such_dir")
    async with TestClient(TestServer(app)) as c:
        resp = await c.get("/")
        assert resp.status == 404
