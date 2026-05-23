"""b71: 地形 DEM 設定 (= TERRAIN_CONFIG) の cross-language drift 検出。

b59 で「dem5a_png z15 で 96 tiles」 に切り替えた定数群を、 b71 で「terrainConfig
SoT、 zoom と bbox は 1 箇所で定義、 全部派生」 に再設計した。 本 file は Python 側
SoT (= tile_constants.py:TERRAIN_CONFIG) と JS 側 SoT (= courses/fujihill.js:TERRAIN_CONFIG)
の同値性 + 派生関係を pin する。

- GSI_URL は dem5a_png endpoint (= z9-15 配信、 zoom 値は TERRAIN_CONFIG.zoom 由来で範囲内)
- GSI_DEM_ZOOMS == [TERRAIN_CONFIG['zoom']]
- FUJI_TERRAIN_BBOX == _compute_terrain_bbox(TERRAIN_CONFIG)
- Python TERRAIN_CONFIG と JS TERRAIN_CONFIG が同値 (= 2 SoT 同期 pin、 ずれたら fail)
- FUJI_TERRAIN_BBOX を TERRAIN_CONFIG.zoom で覆うタイル数が MAX_TILES (200) 以下

cross-language pin の相手 (JS 側 TERRAIN_CONFIG) は web/courses/fujihill.js の TERRAIN_CONFIG。
Python から JS は import できないので literal で写し、 「ずれたら同期せよ」 とする。
対になる vitest 側 pin は web/tests/zoom_bounds.test.js。
"""
import re
from pathlib import Path

from fujihill import dbinit
from fujihill.tile_constants import (
    FUJI_TERRAIN_BBOX, GSI_DEM_ZOOMS, TERRAIN_CONFIG, _compute_terrain_bbox,
)
from fujihill.tile_coverage import enumerate_bbox_tiles

# web/lib/map3d/tile_loader3d.js の MAX_TILES の写し (= loadDemStitched の上限 gate)。
_JS_MAX_TILES = 200

# web/courses/fujihill.js の path (= JS 側 TERRAIN_CONFIG を文字列で読む)。
_JS_FUJIHILL_JS = Path(__file__).resolve().parent.parent / 'web' / 'courses' / 'fujihill.js'


def _parse_js_terrain_config():
    """fujihill.js から TERRAIN_CONFIG の 4 値を正規表現で抽出 ── JS の import を避けて
    純文字列パースで同値性を pin する (= 「ずれたら fail」 が最重要、 厳密な JS 評価は不要)。
    """
    src = _JS_FUJIHILL_JS.read_text(encoding='utf-8')
    m = re.search(
        r'const\s+TERRAIN_CONFIG\s*=\s*\{[^}]*'
        r'zoom:\s*(\d+)[^}]*'
        r'bboxKm:\s*([\d.]+)[^}]*'
        r'centerLon:\s*([\d.]+)[^}]*'
        r'centerLat:\s*([\d.]+)',
        src, re.DOTALL,
    )
    assert m, f'fujihill.js の TERRAIN_CONFIG を parse できなかった: {_JS_FUJIHILL_JS}'
    return {
        'zoom': int(m.group(1)),
        'bbox_km': float(m.group(2)),
        'center_lon': float(m.group(3)),
        'center_lat': float(m.group(4)),
    }


def test_gsi_url_is_dem5a_png():
    """GSI_URL は dem5a_png (= 5mメッシュ標高タイル) の endpoint、 zoom は TERRAIN_CONFIG 由来。

    b71: zoom 値は terrainConfig.zoom 派生なので URL に zoom リテラルは含まれない、
    endpoint は dem5a_png のまま (= z9-15 配信範囲なら zoom を変えても endpoint は同じ)。
    """
    assert 'dem5a_png' in dbinit.GSI_URL
    assert dbinit.GSI_URL == (
        'https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/{z}/{x}/{y}.png'
    )


def test_gsi_dem_zooms_derives_from_terrain_config():
    """GSI_DEM_ZOOMS は TERRAIN_CONFIG.zoom からの派生 (= 「設定 1 箇所」 SoT)。"""
    assert GSI_DEM_ZOOMS == [TERRAIN_CONFIG['zoom']]


def test_terrain_config_zoom_in_dem5a_range():
    """TERRAIN_CONFIG.zoom は dem5a_png 配信範囲 (z9-15) 内。"""
    assert 9 <= TERRAIN_CONFIG['zoom'] <= 15


def test_fuji_terrain_bbox_derives_from_terrain_config():
    """FUJI_TERRAIN_BBOX は _compute_terrain_bbox(TERRAIN_CONFIG) と一致 (= 派生関係)。"""
    assert FUJI_TERRAIN_BBOX == _compute_terrain_bbox(TERRAIN_CONFIG)


def test_python_and_js_terrain_config_match():
    """Python TERRAIN_CONFIG と JS TERRAIN_CONFIG が同値 (= cross-language drift 検出)。

    zoom や bboxKm を変えたい時、 2 SoT を同値で書き換えるのが本 brief の規律。 片方
    だけ変えたらこの test が即赤になる。
    """
    js = _parse_js_terrain_config()
    assert js['zoom'] == TERRAIN_CONFIG['zoom'], (
        f"zoom 不一致: JS={js['zoom']} / Python={TERRAIN_CONFIG['zoom']} ── 両 SoT を同期せよ"
    )
    assert js['bbox_km'] == TERRAIN_CONFIG['bbox_km'], (
        f"bbox_km 不一致: JS={js['bbox_km']} / Python={TERRAIN_CONFIG['bbox_km']} ── 両 SoT を同期せよ"
    )
    assert js['center_lon'] == TERRAIN_CONFIG['center_lon'], (
        f"center_lon 不一致: JS={js['center_lon']} / Python={TERRAIN_CONFIG['center_lon']} ── 両 SoT を同期せよ"
    )
    assert js['center_lat'] == TERRAIN_CONFIG['center_lat'], (
        f"center_lat 不一致: JS={js['center_lat']} / Python={TERRAIN_CONFIG['center_lat']} ── 両 SoT を同期せよ"
    )


def test_fuji_terrain_bbox_zoom_within_max_tiles():
    """FUJI_TERRAIN_BBOX を TERRAIN_CONFIG.zoom で覆うタイル数は MAX_TILES (200) 以下。"""
    tiles = enumerate_bbox_tiles(FUJI_TERRAIN_BBOX, TERRAIN_CONFIG['zoom'])
    assert 0 < len(tiles) <= _JS_MAX_TILES, (
        f'FUJI_TERRAIN_BBOX の z={TERRAIN_CONFIG["zoom"]} タイル数 {len(tiles)} が '
        f'MAX_TILES {_JS_MAX_TILES} を超過'
    )
