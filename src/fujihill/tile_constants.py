"""ローカル tile DB の中央定数. brief 14 で確定, brief 15/16/17 が参照.

このモジュールが単一の真実源 (single source of truth) である:
- corridor 値, zoom 範囲, rate limit, DL 上限警告, schema version
brief 15/16/17 はこの値を import して使い, CLI 引数で override 可能だが
default はここの値を変えない限り動かない.
"""

# corridor: コース sample 点周辺の何タイル分を取るか
# 3 = 3x3 (= 中央 + 周辺 8 タイル), 1 = 中央のみ
DEFAULT_CORRIDOR_TILES = 3

# 余白 (corridor とは別、 外接矩形に対する余白)
DEFAULT_BUFFER_M = 1000  # 1 km

# ────────────────────────────────────────────────────────────────────────────
# TERRAIN_CONFIG: 地形タイル取得の単一設定 (= SoT、 ここを変えれば全部追随する)
# ────────────────────────────────────────────────────────────────────────────
#
# JS 側 `web/courses/fujihill.js:TERRAIN_CONFIG` と同値に保つ (= cross-language drift
# 防止、 test_b59_dem5a.py で同値性 pin)。 zoom や bbox_km を変えたい場合は本 dict と
# JS 側の両方を同じ値に揃える ── 各 1 箇所、 計 2 箇所変更で全部追随する設計。
#
#   zoom    : GSI dem5a_png 取得 zoom (= z9-15 配信範囲内)
#   bbox_km : demBounds 正方形 1 辺 (km)
#   center_lon / center_lat : demBounds 中央点
TERRAIN_CONFIG = {
    'zoom': 15,
    'bbox_km': 12.0,
    'center_lon': 138.7244,
    'center_lat': 35.4063,
}


def _compute_terrain_bbox(config):
    """TERRAIN_CONFIG から FUJI_TERRAIN_BBOX (lon_min, lat_min, lon_max, lat_max) を算出。

    緯度 1 度 ≒ 111.32 km、 経度 1 度は cos(lat) 倍率。 ±(bbox_km / 2) km を度に変換。
    JS の `web/courses/fujihill.js:computeDemBounds` と同じ式で再現可能 (= cross-language
    pin の前提)。
    """
    import math
    half_km = config['bbox_km'] / 2
    d_lat = half_km / 111.32
    d_lon = half_km / (111.32 * math.cos(math.radians(config['center_lat'])))
    return (
        config['center_lon'] - d_lon,
        config['center_lat'] - d_lat,
        config['center_lon'] + d_lon,
        config['center_lat'] + d_lat,
    )


# zoom 範囲 (= TERRAIN_CONFIG から派生)。 brief 15/16 で source 別に override 可。
# b71: 外周ストリップ / 高精細 2 段構成は廃止、 全 mesh を単一 zoom (TERRAIN_CONFIG.zoom)
# で作る ── ring topology 関連は撤去。 dem5a_png z9-15 配信範囲内に保つこと。
GSI_DEM_ZOOMS = [TERRAIN_CONFIG['zoom']]

# DEM タイル事前取得 (bridge SQLite DB 用) の bbox = TERRAIN_CONFIG から算出。
# JS 側の `fujihill.demBounds` (= computeDemBounds(TERRAIN_CONFIG)) と同値に保つ
# (= cross-language drift 防止、 bridge DB が JS 要求タイルを hit する前提)。
FUJI_TERRAIN_BBOX = _compute_terrain_bbox(TERRAIN_CONFIG)

# OSM は zoom 13/14/15 の 3 段持つ (2026-05-15 再改).
# 理由: viewer は minzoom=13/maxzoom=15 で OSM source を declare、 ride 開始前の
# 俯瞰 (z=13 周辺) でも z=13 タイルが必要、 ride 視点 (z=23) は z=15 を overzoom 拡大.
# Protomaps planet build の上限 z=15、 z=16/17 は存在しない (= maxzoom: 15 で固定).
# 数値: 富士スバルライン 24km, corridor 3 で z=13: ~6 / z=14: ~20 / z=15: ~70 = 計 ~100 タイル.
OSM_VECTOR_ZOOMS = [13, 14, 15]

# レート制限 (GSI のみ、 OSM PMTiles 抽出は適用外)
GSI_RATE_LIMIT_SEC = 1.0  # 地理院規約「大量アクセス自粛」の安全側、 1 req/s

# DL 上限警告 (これを超えたら user 確認を求める)
TILE_FETCH_WARN_THRESHOLD = 1000

# DB schema version (migration 用、 PRAGMA user_version と同期)
SCHEMA_VERSION = 1

# brief 30: minimap raster (= 上半分 #minimap-top の OSM タイル) の DB cache 用.
# 起動時 1 回だけ OSM タイルサーバから fetch して tiles table に
# source='osm_raster' で保存、 2 回目以降は DB から hit (= OSM 再 fetch ゼロ).
# brief 29 で確定した z=11 + 富士山周辺 bbox を中央定数化.
MINIMAP_OSM_ZOOM = 11
# (lon_min, lat_min, lon_max, lat_max). 富士スバルライン 24 km + 周辺余裕、
# z=11 で 16 タイルに収まる範囲. 個人小規模 1-shot, OSM Tile Usage Policy
# 「cache aggressively」推奨に積極準拠.
#
# 2026-05-15 修正: viewer 側 (buildMinimapTopBase in viewer-maplibre.js) が
# course bbox + 20% margin + buffer=1 で z=11 タイル x=[1811..1814] y=[806..809]
# = 16 タイルを要求するのに対し、 旧 bbox (138.65/35.30/138.85/35.50) は
# x=[1812..1813] y=[807..809] = 6 タイルしかカバーせず、 viewer 起動時に
# 10 タイル 404 が console に並んでいた (= 上半分の minimap の周辺が透明欠け).
# 新 bbox は viewer の要求 16 タイルを過不足なく覆う (= enumerate_bbox_tiles で
# 同じ 16 タイル set を返す). OSM Tile Usage Policy 上は「個人小規模 + cache
# aggressively」枠内で 16 タイル × 1 device × init 1 回のみ.
#
# 注意 1: この bbox は **富士スバルライン専用 hardcode**. 他コース (= 自分の GPX)
# で運用する場合は course.json の lat/lon から bbox を導出して上書きすること.
# 将来的に enumerate_bbox_tiles(course, MINIMAP_OSM_ZOOM, margin) で動的算出に
# 切替予定 (= brief 候補)、 現状は明示性優先で固定値.
#
# 注意 2: viewer-maplibre.js の FUJIHILL_DB_BOUNDS (= (138.65, 35.30, 138.85, 35.50))
# とは概念的に分離. FUJIHILL_DB_BOUNDS は MapLibre の vector/DEM source の bounds
# (z>=13 で課程付近のみ要求させる coarse hint)、 MINIMAP_BBOX は z=11 raster
# pre-fetch 範囲 (minimap canvas 用の 1-shot 9-16 タイル). 旧版では同値だったが、
# minimap の viewer 要求が広い (= +margin/+buffer) 分だけ MINIMAP_BBOX が大きく.
MINIMAP_BBOX = (138.40, 35.20, 138.95, 35.65)
