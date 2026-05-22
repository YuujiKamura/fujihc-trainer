"""brief 17a + 26b: bridge.py から HTTP app を分離.

ローカル tile DB を HTTP 配信する aiohttp app を組み立てる module 関数を提供.
bridge.py の Bridge.run() からはこれを呼んで TCPSite に mount する.

brief 26b で追加:
  - GET  /tiles/_setup_status         course + DB 充足度 (= source 別 status)
  - POST /tiles/_fetch_gsi            GSI 標高 async fetch を spawn
  - POST /tiles/_extract_osm          OSM PMTiles 抽出を spawn (body に pmtiles_path)

依存: aiohttp, fujihill.tile_server, fujihill.dbinit.
"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Awaitable, Callable, Optional

from aiohttp import web

from fujihill import dbinit, tile_server

log = logging.getLogger(__name__)


def make_http_app(
    db_path: str | Path,
    course_path: str | Path | None = None,
    progress_broadcaster: Optional[Callable[[dict], Awaitable[None]]] = None,
    web_root: str | Path | None = None,
    debug_frame_path: str | Path | None = None,
) -> web.Application:
    """tile_server の handler を aiohttp の route に mount した app を返す.

    Args:
        db_path: ローカル tile DB の path.
        course_path: course.json の path. None 時は viewer/course.json 相対.
            /tiles/_setup_status は course_path を必要とする.
        progress_broadcaster: 1 進捗イベント (dict) を WS 全 client に流す
            async callable. None なら dbinit progress は no-op.
        debug_frame_path: POST /debug/frame の PNG 保存先. None 時は data/debug-frame.png.

    route:
      GET  /tiles/{source}/{z}/{x}/{y}.{ext}     タイル binary
      GET  /tiles/{source}/metadata.json         metadata dict (JSON)
      GET  /tiles/_style.json                    MapLibre style (JSON)
      GET  /tiles/_metrics                       hit/miss カウンタ (brief 20)
      GET  /tiles/_setup_status                  source 別充足度 (brief 26b)
      POST /tiles/_fetch_gsi                     GSI fetch 起動 (brief 26b)
      POST /tiles/_extract_osm                   OSM 抽出起動 (brief 26b)
      POST /debug/frame                          viewer 画面 PNG を保存 (デバッグ)
    bind: 127.0.0.1 限定 (= 呼び出し側の TCPSite で pin、 LAN 内 ODbL 再配布事故防止)
    """
    handlers = tile_server.register_tile_routes(str(db_path))
    app = web.Application()

    # course_path default は repo root の web/course.json
    if course_path is None:
        course_path = Path(__file__).resolve().parent.parent.parent / 'web' / 'course.json'
    course_path_s = str(course_path)

    # dbinit task の二重起動防止 (= fire-and-forget, 1 source につき 1 task)
    inflight: dict[str, asyncio.Task] = {}

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
        headers = {"Cache-Control": "public, max-age=31536000"}
        # Protomaps PMTiles の vector tile は gzip 圧縮されたまま DB に保存される.
        # MapLibre は Content-Encoding: gzip を見て decompress するため、 検知して header を付与.
        # PNG は magic 0x89 0x50 で始まる、 gzip は 0x1f 0x8b、 後者なら encoding 明示.
        if len(data) >= 2 and data[0] == 0x1F and data[1] == 0x8B:
            headers["Content-Encoding"] = "gzip"
        return web.Response(status=200, body=data, content_type=ctype, headers=headers)

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

    async def h_setup_status(request: web.Request) -> web.Response:
        status, body = tile_server.get_setup_status(str(db_path), course_path_s)
        if status != 200 or body is None:
            return web.Response(status=status)
        return web.json_response(body)

    async def _progress(payload: dict) -> None:
        if progress_broadcaster is None:
            return
        await progress_broadcaster({'type': 'dbinit_progress', **payload})

    async def h_fetch_gsi(request: web.Request) -> web.Response:
        if 'gsi_dem' in inflight and not inflight['gsi_dem'].done():
            return web.json_response({'state': 'busy', 'source': 'gsi_dem'}, status=409)
        try:
            course = dbinit.load_course_json(course_path_s)
        except (OSError, ValueError) as exc:
            return web.json_response({'error': str(exc)}, status=503)

        async def _runner():
            try:
                await dbinit.fetch_gsi_async(
                    db_path=str(db_path), course=course,
                    progress_cb=_progress,
                )
            except Exception as exc:  # noqa: BLE001
                log.warning('fetch_gsi_async failed: %s', exc)
                await _progress({
                    'source': 'gsi_dem', 'n': 0, 'total': 0, 'phase': 'error',
                    'message': str(exc),
                })

        inflight['gsi_dem'] = asyncio.create_task(_runner())
        return web.json_response({'state': 'started', 'source': 'gsi_dem'}, status=202)

    async def h_fetch_minimap_raster(request: web.Request) -> web.Response:
        """brief 30: minimap raster の起動時 1-shot fetch を spawn.

        body 不要 (= bbox / zoom は tile_constants の中央定数). 既に走行中なら
        409 (= GSI / OSM 抽出と同じ inflight 制御).
        """
        if 'osm_raster' in inflight and not inflight['osm_raster'].done():
            return web.json_response(
                {'state': 'busy', 'source': 'osm_raster'}, status=409,
            )

        async def _runner():
            try:
                await dbinit.fetch_minimap_raster_async(
                    db_path=str(db_path), progress_cb=_progress,
                )
            except Exception as exc:  # noqa: BLE001
                log.warning('fetch_minimap_raster_async failed: %s', exc)
                await _progress({
                    'source': 'osm_raster', 'n': 0, 'total': 0,
                    'phase': 'error', 'message': str(exc),
                })

        inflight['osm_raster'] = asyncio.create_task(_runner())
        return web.json_response(
            {'state': 'started', 'source': 'osm_raster'}, status=202,
        )

    async def h_extract_osm(request: web.Request) -> web.Response:
        if 'osm' in inflight and not inflight['osm'].done():
            return web.json_response({'state': 'busy', 'source': 'osm'}, status=409)
        try:
            body = await request.json()
        except Exception:  # noqa: BLE001
            return web.json_response({'error': 'invalid json'}, status=400)
        pm_path = body.get('pmtiles_path') if isinstance(body, dict) else None
        if not pm_path or not isinstance(pm_path, str):
            return web.json_response({'error': 'pmtiles_path required'}, status=400)
        try:
            course = dbinit.load_course_json(course_path_s)
        except (OSError, ValueError) as exc:
            return web.json_response({'error': str(exc)}, status=503)

        async def _runner():
            try:
                await dbinit.extract_osm_async(
                    db_path=str(db_path), pmtiles_path=pm_path,
                    course=course, progress_cb=_progress,
                )
            except FileNotFoundError as exc:
                await _progress({
                    'source': 'osm', 'n': 0, 'total': 0, 'phase': 'error',
                    'message': str(exc),
                })
            except Exception as exc:  # noqa: BLE001
                log.warning('extract_osm_async failed: %s', exc)
                await _progress({
                    'source': 'osm', 'n': 0, 'total': 0, 'phase': 'error',
                    'message': str(exc),
                })

        inflight['osm'] = asyncio.create_task(_runner())
        return web.json_response({'state': 'started', 'source': 'osm'}, status=202)

    # POST /debug/frame: viewer の WebGL 画面を PNG で受け取りローカルに保存する。
    # 開発時に viewer の実レンダリング結果を実ファイルとして観るためのデバッグ用途
    # (= OS のウィンドウキャプチャは WebGL canvas で白飛びするため、 描画 buffer 自体を
    # viewer 側から送ってもらう)。 viewer は ?cap=1 のときだけ送信する。 bridge は
    # 127.0.0.1 限定 bind なので外部からは届かない。 保存先は既定 data/debug-frame.png。
    if debug_frame_path is None:
        debug_frame_path = Path(__file__).resolve().parent.parent.parent / 'data' / 'debug-frame.png'
    debug_frame_path = Path(debug_frame_path)

    async def h_debug_frame(request: web.Request) -> web.Response:
        body = await request.read()
        if not body:
            return web.json_response({'error': 'empty body'}, status=400)
        debug_frame_path.parent.mkdir(parents=True, exist_ok=True)
        debug_frame_path.write_bytes(body)
        return web.json_response({'saved': str(debug_frame_path), 'bytes': len(body)})

    app.router.add_get("/tiles/{source}/metadata.json", h_metadata)
    app.router.add_get("/tiles/_style.json", h_style)
    app.router.add_get("/tiles/_metrics", h_metrics)
    app.router.add_get("/tiles/_setup_status", h_setup_status)
    app.router.add_post("/tiles/_fetch_gsi", h_fetch_gsi)
    app.router.add_post("/tiles/_extract_osm", h_extract_osm)
    app.router.add_post("/tiles/_fetch_minimap_raster", h_fetch_minimap_raster)
    app.router.add_post("/debug/frame", h_debug_frame)
    app.router.add_get(r"/tiles/{source}/{z:\d+}/{x:\d+}/{y:\d+}.{ext:\w+}", h_tile)

    # 静的 file 配信 (= viewer HTML / JS / CSS / course.json)、 同一 origin で /tiles/ と並走。
    # /tiles/* route の後に登録 (= aiohttp は登録順 dispatch、 /tiles を static で奪われない)。
    web_root_p = Path(web_root) if web_root else Path(__file__).resolve().parent.parent.parent / "web"
    if web_root_p.exists():
        async def h_root(request: web.Request) -> web.Response:
            index = web_root_p / "index.html"
            if not index.exists():
                return web.Response(status=404)
            return web.Response(body=index.read_bytes(), content_type="text/html")
        app.router.add_get("/", h_root)
        app.router.add_static("/", path=str(web_root_p), show_index=False)
    return app
