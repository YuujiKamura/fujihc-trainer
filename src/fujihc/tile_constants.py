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

# zoom 範囲 (brief 15/16 で source 別に override 可)
GSI_DEM_ZOOMS = [14]  # 標高は 14 で十分 (= MapLibre terrain 要求最大)

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
# z=11 で 9-16 タイルに収まる範囲. 個人小規模 1-shot, OSM Tile Usage Policy
# 「cache aggressively」推奨に積極準拠.
#
# 注意: この bbox は **富士スバルライン専用 hardcode**. 他コース (= 自分の GPX)
# で運用する場合は course.json の lat/lon から bbox を導出して上書きすること.
# 将来的に enumerate_bbox_tiles(course, MINIMAP_OSM_ZOOM, margin) で動的算出に
# 切替予定 (= brief 候補)、 現状は明示性優先で固定値.
MINIMAP_BBOX = (138.65, 35.30, 138.85, 35.50)
