"""brief 17a + Round 4 refactor: bridge.py から HTTP app を分離.

ローカル tile DB を HTTP 配信する aiohttp app を組み立てる module 関数を提供.
bridge.py の Bridge.run() からはこれを呼んで TCPSite に mount する.

依存: aiohttp, fujihc.tile_server.
"""
from __future__ import annotations

from pathlib import Path

from aiohttp import web

from fujihc import tile_server


def make_http_app(db_path: str | Path) -> web.Application:
    """tile_server の handler を aiohttp の route に mount した app を返す.

    route:
      GET  /tiles/{source}/{z}/{x}/{y}.{ext}    タイル binary
      GET  /tiles/{source}/metadata.json         metadata dict (JSON)
      GET  /tiles/_style.json                    MapLibre style (JSON)
      GET  /tiles/_metrics                       hit/miss カウンタ (brief 20)
    bind: 127.0.0.1 限定 (= 呼び出し側の TCPSite で pin、 LAN 内 ODbL 再配布事故防止)
    """
    handlers = tile_server.register_tile_routes(str(db_path))
    app = web.Application()

    async def h_tile(request: web.Request) -> web.Response:
        source = request.match_info["source"]
        try:
            z = int(request.match_info["z"])
            x = int(request.match_info["x"])
            y = int(request.match_info["y"])
        except ValueError:
            return web.Response(status=400, text="bad coord")
        status, ctype, data = handlers["tile"](source, z, x, y)
        if status != 200 or data is None:
            return web.Response(status=status)
        return web.Response(status=200, body=data, content_type=ctype,
                            headers={"Cache-Control": "public, max-age=31536000"})

    async def h_metadata(request: web.Request) -> web.Response:
        source = request.match_info["source"]
        status, meta = handlers["metadata"](source)
        if status != 200 or meta is None:
            return web.Response(status=status)
        return web.json_response(meta)

    async def h_style(request: web.Request) -> web.Response:
        status, style = handlers["style"]()
        if status != 200 or style is None:
            return web.Response(status=status)
        return web.json_response(style)

    async def h_metrics(request: web.Request) -> web.Response:
        return web.json_response(handlers["metrics"]())

    app.router.add_get("/tiles/{source}/metadata.json", h_metadata)
    app.router.add_get("/tiles/_style.json", h_style)
    app.router.add_get("/tiles/_metrics", h_metrics)
    app.router.add_get(r"/tiles/{source}/{z:\d+}/{x:\d+}/{y:\d+}.{ext:\w+}", h_tile)
    return app
