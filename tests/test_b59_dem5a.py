"""b59: 地形 DEM を dem5a (5mメッシュ) zoom 15 に切替えた定数群の pin。

このファイルは b59 で変えた Python 側中央定数を 1 箇所で pin する:
- GSI_URL が dem5a_png endpoint
- GSI_DEM_ZOOMS == [15]
- FUJI_TERRAIN_BBOX が新値 (= コース外接 ∪ 富士山頂 + 500m)
- FUJI_TERRAIN_BBOX ⊇ JS 側 demBounds (= cross-language の二重定義 drift を物理検出)
- FUJI_TERRAIN_BBOX を z15 で覆うタイル数が MAX_TILES (200) 以下

cross-language pin の相手 (JS 側 demBounds) は web/courses/fujihill.js の demBounds 定数。
Python から JS は import できないので 4 数値を下記 _JS_DEM_BOUNDS に literal で写し、
「ずれたら同期せよ」とする。 対になる vitest 側 pin は web/tests/zoom_bounds.test.js。
"""
from fujihill import dbinit
from fujihill.tile_constants import FUJI_TERRAIN_BBOX, GSI_DEM_ZOOMS
from fujihill.tile_coverage import enumerate_bbox_tiles

# web/courses/fujihill.js の demBounds 定数の写し [W, S, E, N]。
# 片方を動かしたら必ず両方を同期しろ ── ずれたら下の ⊇ test が赤になる。
_JS_DEM_BOUNDS = (138.6845, 35.3561, 138.7642, 35.4566)

# web/lib/map3d/tile_loader3d.js の MAX_TILES の写し (= loadDemStitched の上限 gate)。
_JS_MAX_TILES = 200


def test_gsi_url_is_dem5a_png():
    """GSI_URL は dem5a_png (= 5mメッシュ標高タイル) の endpoint。"""
    assert 'dem5a_png' in dbinit.GSI_URL
    assert 'dem_png/' not in dbinit.GSI_URL  # 旧 dem_png に戻っていないこと
    assert dbinit.GSI_URL == (
        'https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/{z}/{x}/{y}.png'
    )


def test_gsi_dem_zooms_is_z15():
    """dem5a は z15 が native 上限 ── 中央定数も [15]。"""
    assert GSI_DEM_ZOOMS == [15]


def test_fuji_terrain_bbox_value():
    """FUJI_TERRAIN_BBOX は b59 で course 外接 ∪ 富士山頂 + 500m に縮小済。"""
    assert FUJI_TERRAIN_BBOX == (138.6845, 35.3561, 138.7642, 35.4566)


def test_fuji_terrain_bbox_contains_js_dem_bounds():
    """FUJI_TERRAIN_BBOX ⊇ JS 側 demBounds ── bridge DB が JS 要求タイルを必ず内包する。

    Python prefetch 範囲 (FUJI_TERRAIN_BBOX) が JS request 範囲 (demBounds) を
    覆っていないと、 bridge mode で DB に無いタイルを viewer が要求して地形が欠ける。
    """
    pw, ps, pe, pn = FUJI_TERRAIN_BBOX
    jw, js, je, jn = _JS_DEM_BOUNDS
    assert pw <= jw and ps <= js and pe >= je and pn >= jn, (
        f'FUJI_TERRAIN_BBOX {FUJI_TERRAIN_BBOX} が JS demBounds '
        f'{_JS_DEM_BOUNDS} を内包していない ── 両者を同期せよ'
    )


def test_fuji_terrain_bbox_z15_within_max_tiles():
    """FUJI_TERRAIN_BBOX を z15 で覆うタイル数は MAX_TILES (200) 以下。

    z15 化でタイル数が 4 倍になるので、 範囲を course 外接に絞って 200 内に収める
    のが b59 の肝 (= dbBounds 全域だと 437 枚で MAX_TILES 超過)。
    """
    tiles = enumerate_bbox_tiles(FUJI_TERRAIN_BBOX, 15)
    assert 0 < len(tiles) <= _JS_MAX_TILES, (
        f'FUJI_TERRAIN_BBOX の z15 タイル数 {len(tiles)} が MAX_TILES '
        f'{_JS_MAX_TILES} を超過'
    )
