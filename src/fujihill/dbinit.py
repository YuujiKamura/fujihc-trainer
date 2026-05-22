"""brief 26b: 起動時 DB 構築 (= dbinit) の async 化された fetch / extract 関数群.

scripts/fetch_gsi_dem.py と scripts/fetch_osm_pmtiles.py の中核 logic を
非同期化し、 1 タイル完了ごとに progress_cb を呼ぶ形に揃える. bridge.py 側
の HTTP endpoint (POST /tiles/_fetch_gsi / _extract_osm) はこれを spawn して
WS broadcast に流す. scripts は本 module の薄い CLI wrapper として残る.

設計境界:
  - DOM / WebSocket / aiohttp に依存しない (= bridge.py 側から callback 注入)
  - urllib request 等 sync I/O は asyncio.to_thread で wrap
  - 中央定数は tile_constants から import (= SCHEMA_VERSION / zoom / rate などのローカル再定義禁止)
  - progress_cb は { source, n, total, phase } の dict 1 引数で呼ばれる
"""
from __future__ import annotations

import asyncio
import json
import sqlite3
import urllib.error
import urllib.request
from pathlib import Path
from typing import Awaitable, Callable, Optional

from fujihill.tile_constants import (
    DEFAULT_CORRIDOR_TILES,
    FUJI_TERRAIN_BBOX,
    GSI_DEM_ZOOMS,
    GSI_RATE_LIMIT_SEC,
    MINIMAP_BBOX,
    MINIMAP_OSM_ZOOM,
    OSM_VECTOR_ZOOMS,
)
from fujihill.tile_coverage import enumerate_bbox_tiles, enumerate_coverage_tiles

GSI_URL = 'https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/{z}/{x}/{y}.png'
OSM_RASTER_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
DEFAULT_USER_AGENT = (
    'fujihill-trainer/0.1 (https://github.com/YuujiKamura/fujihc-trainer)'
)

# progress_cb は同期でも async でも受け付ける (= bridge 側から coroutine を渡せる).
ProgressCb = Optional[Callable[[dict], Optional[Awaitable[None]]]]


async def _emit(progress_cb: ProgressCb, payload: dict) -> None:
    if progress_cb is None:
        return
    result = progress_cb(payload)
    if asyncio.iscoroutine(result):
        await result


def _fetch_one_sync(z: int, x: int, y: int, user_agent: str, timeout: float = 10.0):
    """1 タイルを GSI から sync で取得 (= to_thread 経由で呼ぶ)."""
    req = urllib.request.Request(
        GSI_URL.format(z=z, x=x, y=y),
        headers={'User-Agent': user_agent},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return (200, resp.read())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return (404, None)
        raise


def _fetch_one_url_sync(url: str, user_agent: str, timeout: float = 10.0):
    """1 タイルを任意 URL から sync で取得 (= to_thread 経由で呼ぶ).

    brief 30: OSM raster (= minimap) 用. GSI と並列の URL pattern を持つため
    _fetch_one_sync (= GSI 固定) を再利用せず、 url 引数を取る変種を追加.
    """
    req = urllib.request.Request(url, headers={'User-Agent': user_agent})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return (200, resp.read())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return (404, None)
        raise


def _insert_tile_sync(db_path: Path, source: str, z: int, x: int, y: int,
                      status: int, data: Optional[bytes], fmt: str) -> None:
    with sqlite3.connect(db_path) as db:
        db.execute(
            'INSERT OR REPLACE INTO tiles '
            '(source, zoom_level, tile_column, tile_row, format, data, fetched_at, fetch_status) '
            "VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)",
            (source, z, x, y, fmt, data, status),
        )
        db.commit()


def _upsert_metadata_sync(db_path: Path, source: str, items: list) -> None:
    with sqlite3.connect(db_path) as db:
        for name, value in items:
            db.execute(
                'INSERT OR REPLACE INTO metadata (source, name, value) VALUES (?, ?, ?)',
                (source, name, value),
            )
        db.commit()


def _existing_tiles_sync(db_path: Path, source: str) -> set:
    with sqlite3.connect(db_path) as db:
        return set(
            db.execute(
                'SELECT zoom_level, tile_column, tile_row FROM tiles WHERE source=?',
                (source,),
            ).fetchall()
        )


async def fetch_gsi_async(
    db_path,
    course,
    zoom: int = GSI_DEM_ZOOMS[0],
    corridor_tiles: int = DEFAULT_CORRIDOR_TILES,
    rate_limit_sec: float = GSI_RATE_LIMIT_SEC,
    user_agent: str = DEFAULT_USER_AGENT,
    progress_cb: ProgressCb = None,
    bbox=FUJI_TERRAIN_BBOX,
) -> dict:
    """GSI 標高タイルを async でレート制限 DL してローカル DB に格納.

    Args:
        db_path: 出力先 SQLite. 既に schema 初期化済前提 (init_tile_db).
        course: [{lat, lon, ...}, ...] の list (= 既 load 済).
        zoom: zoom 整数 (中央定数 GSI_DEM_ZOOMS[0] が default).
        corridor_tiles: 各点の周辺タイル幅 (中央定数 DEFAULT_CORRIDOR_TILES).
        rate_limit_sec: 各 fetch 後の sleep 秒数 (= GSI ToS 1 req/sec 安全側).
        user_agent: GSI に送る UA.
        progress_cb: 1 タイル fetch ごとに { source, n, total, phase } を渡す.
                     phase は 'fetching' (= 進行中) / 'done' (= 完了 1 回のみ).
        bbox: 地形メッシュ用に追加で覆う (lon_min, lat_min, lon_max, lat_max).
              default は FUJI_TERRAIN_BBOX (= 富士山の外周まで). None を渡すと
              course corridor のみ (= 旧来の細い帯、 corridor 限定 test 用).

    Fetch 対象タイルは course corridor と bbox の和集合. corridor 単独では
    富士スバルライン沿いの細い帯しか取れず、 viewer (terrain3d.html) が要求する
    富士山本体のタイルが DB に無く 404 欠け / GSI 都度 fetch になっていた.

    Returns:
        { fetched: int, skipped: int, errors: int, total: int }
    """
    db_path = Path(db_path)
    coverage = enumerate_coverage_tiles(course, [zoom], corridor_tiles)
    if bbox is not None:
        coverage |= enumerate_bbox_tiles(bbox, zoom)
    tiles = sorted(coverage)
    existing = await asyncio.to_thread(_existing_tiles_sync, db_path, 'gsi_dem')
    to_fetch = [t for t in tiles if t not in existing]
    total = len(tiles)

    fetched = 0
    errors = 0
    skipped = len(existing & set(tiles))

    # 初期 progress (= 0/total, fetching) を 1 度送って UI bar を初期化させる
    await _emit(progress_cb, {
        'source': 'gsi_dem', 'n': skipped, 'total': total, 'phase': 'fetching',
    })

    for i, (z, x, y) in enumerate(to_fetch):
        try:
            status, data = await asyncio.to_thread(
                _fetch_one_sync, z, x, y, user_agent,
            )
        except urllib.error.HTTPError:
            errors += 1
            continue
        await asyncio.to_thread(
            _insert_tile_sync, db_path, 'gsi_dem', z, x, y, status, data, 'png',
        )
        if status == 200:
            fetched += 1
        await _emit(progress_cb, {
            'source': 'gsi_dem',
            'n': skipped + i + 1,
            'total': total,
            'phase': 'fetching',
        })
        if rate_limit_sec > 0:
            await asyncio.sleep(rate_limit_sec)

    await asyncio.to_thread(_upsert_metadata_sync, db_path, 'gsi_dem', [
        ('attribution', '国土地理院 標高タイル (dem5a_png)'),
        ('format', 'png'),
        ('minzoom', str(zoom)),
        ('maxzoom', str(zoom)),
        ('user_agent_used', user_agent),
        ('fetched_by', 'fujihill.dbinit.fetch_gsi_async'),
    ])

    await _emit(progress_cb, {
        'source': 'gsi_dem',
        'n': total,
        'total': total,
        'phase': 'done',
    })

    return {
        'fetched': fetched,
        'skipped': skipped,
        'errors': errors,
        'total': total,
    }


async def fetch_minimap_raster_async(
    db_path,
    bbox=MINIMAP_BBOX,
    zoom: int = MINIMAP_OSM_ZOOM,
    rate_limit_sec: float = GSI_RATE_LIMIT_SEC,
    user_agent: str = DEFAULT_USER_AGENT,
    progress_cb: ProgressCb = None,
) -> dict:
    """OSM raster タイルを bbox + zoom 内で 1 req/sec 逐次 DL → DB 格納 (brief 30).

    minimap (= #minimap-top canvas) 用の事前 fetch + DB cache. 起動時 1 回だけ
    呼び出され、 以降は viewer が ${TILE_BASE_URL}/osm_raster/{z}/{x}/{y}.png
    で DB から hit する. OSM Tile Usage Policy の「cache aggressively」推奨
    に積極準拠.

    Args:
        db_path: 出力先 SQLite. 既に schema 初期化済前提 (init_tile_db).
        bbox: (lon_min, lat_min, lon_max, lat_max) tuple of floats.
        zoom: zoom 整数 (中央定数 MINIMAP_OSM_ZOOM=11 が default).
        rate_limit_sec: 各 fetch 後の sleep 秒数 (= GSI と同じく 1 req/s 安全側).
        user_agent: OSM に送る UA (= GSI と同じ自前 UA).
        progress_cb: 1 タイル fetch ごとに { source: 'osm_raster', n, total, phase } を渡す.

    Returns:
        { fetched: int, skipped: int, errors: int, total: int }
    """
    db_path = Path(db_path)
    tiles = sorted(enumerate_bbox_tiles(bbox, zoom))
    existing = await asyncio.to_thread(_existing_tiles_sync, db_path, 'osm_raster')
    to_fetch = [t for t in tiles if t not in existing]
    total = len(tiles)

    fetched = 0
    errors = 0
    skipped = len(existing & set(tiles))

    await _emit(progress_cb, {
        'source': 'osm_raster', 'n': skipped, 'total': total, 'phase': 'fetching',
    })

    for i, (z, x, y) in enumerate(to_fetch):
        url = OSM_RASTER_URL.format(z=z, x=x, y=y)
        try:
            status, data = await asyncio.to_thread(
                _fetch_one_url_sync, url, user_agent,
            )
        except urllib.error.HTTPError:
            errors += 1
            continue
        await asyncio.to_thread(
            _insert_tile_sync, db_path, 'osm_raster', z, x, y, status, data, 'png',
        )
        if status == 200:
            fetched += 1
        await _emit(progress_cb, {
            'source': 'osm_raster',
            'n': skipped + i + 1,
            'total': total,
            'phase': 'fetching',
        })
        if rate_limit_sec > 0:
            await asyncio.sleep(rate_limit_sec)

    await asyncio.to_thread(_upsert_metadata_sync, db_path, 'osm_raster', [
        ('attribution', '© OpenStreetMap contributors (ODbL)'),
        ('license', 'ODbL-1.0'),
        ('format', 'png'),
        ('minzoom', str(zoom)),
        ('maxzoom', str(zoom)),
        ('user_agent_used', user_agent),
        ('fetched_by', 'fujihill.dbinit.fetch_minimap_raster_async'),
    ])

    await _emit(progress_cb, {
        'source': 'osm_raster',
        'n': total,
        'total': total,
        'phase': 'done',
    })

    return {
        'fetched': fetched,
        'skipped': skipped,
        'errors': errors,
        'total': total,
    }


async def extract_osm_async(
    db_path,
    pmtiles_path,
    course,
    zooms=OSM_VECTOR_ZOOMS,
    corridor_tiles: int = DEFAULT_CORRIDOR_TILES,
    progress_cb: ProgressCb = None,
    reader_factory: Optional[Callable] = None,
) -> dict:
    """Protomaps PMTiles から富士ヒル範囲を抽出して DB に格納 (async).

    Args:
        db_path: 出力先 SQLite.
        pmtiles_path: ローカル PMTiles file path (string or Path).
        course: course list.
        zooms: 抽出 zoom 整数 list (中央定数 OSM_VECTOR_ZOOMS).
        corridor_tiles: 各点の周辺タイル幅.
        progress_cb: 1 タイル extract ごとに { source, n, total, phase } を渡す.
        reader_factory: test 用に Reader を差し替えるための DI. None 時は
            pmtiles.reader.Reader + MmapSource を使う.

    Returns:
        { extracted: int, skipped: int, total: int }

    Raises:
        FileNotFoundError: pmtiles_path 不在.
    """
    db_path = Path(db_path)
    pmtiles_p = Path(pmtiles_path).resolve()
    if not pmtiles_p.exists():
        raise FileNotFoundError(f'pmtiles file not found: {pmtiles_p}')

    wanted = sorted(enumerate_coverage_tiles(course, zooms, corridor_tiles))
    existing = await asyncio.to_thread(_existing_tiles_sync, db_path, 'osm')
    to_extract = [t for t in wanted if t not in existing]
    total = len(wanted)
    skipped = len(existing & set(wanted))
    extracted = 0
    out_of_range = 0

    await _emit(progress_cb, {
        'source': 'osm', 'n': skipped, 'total': total, 'phase': 'extracting',
    })

    def _open_reader():
        if reader_factory is not None:
            return reader_factory(pmtiles_p)
        from pmtiles.reader import MmapSource, Reader  # noqa: WPS433
        f = open(pmtiles_p, 'rb')
        return (Reader(MmapSource(f)), f)

    opened = await asyncio.to_thread(_open_reader)
    if isinstance(opened, tuple):
        reader, _fh = opened
    else:
        reader, _fh = opened, None

    try:
        for i, (z, x, y) in enumerate(to_extract):
            data = await asyncio.to_thread(reader.get, z, x, y)
            if data is None:
                await asyncio.to_thread(
                    _insert_tile_sync, db_path, 'osm', z, x, y, 404, None, 'pbf',
                )
                out_of_range += 1
            else:
                await asyncio.to_thread(
                    _insert_tile_sync, db_path, 'osm', z, x, y, 200, data, 'pbf',
                )
                extracted += 1
            await _emit(progress_cb, {
                'source': 'osm',
                'n': skipped + i + 1,
                'total': total,
                'phase': 'extracting',
            })
    finally:
        if _fh is not None:
            with _suppress():
                _fh.close()

    await asyncio.to_thread(_upsert_metadata_sync, db_path, 'osm', [
        ('attribution', '© OpenStreetMap contributors (ODbL)'),
        ('license', 'ODbL-1.0'),
        ('format', 'pbf'),
        ('minzoom', str(min(zooms))),
        ('maxzoom', str(max(zooms))),
        ('source_pmtiles_basename', pmtiles_p.name),
        ('fetched_by', 'fujihill.dbinit.extract_osm_async'),
    ])

    await _emit(progress_cb, {
        'source': 'osm', 'n': total, 'total': total, 'phase': 'done',
    })

    return {
        'extracted': extracted,
        'skipped': skipped,
        'out_of_range': out_of_range,
        'total': total,
    }


def load_course_json(course_path) -> list:
    """CLI wrapper / bridge 側 helper. course.json を読んで list を返す."""
    return json.loads(Path(course_path).read_text(encoding='utf-8'))


# ---------- internal helpers ----------

class _suppress:
    """contextlib.suppress(Exception) の minimal 版 (= import 軽量化)."""
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return exc_type is not None
