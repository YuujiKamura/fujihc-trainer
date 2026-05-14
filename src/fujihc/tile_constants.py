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

# OSM は zoom 17 1 段に固定 (2026-05-15 user 判断).
# MapLibre が ride 視点 zoom 23 を表示する時は overzoom (= ベクトル拡大、
# 粗くならない) で対応.
# 効果: DB 1185 タイル/59 MB -> 300 タイル/15 MB、 ride 中 GPU texture
# upload 頻度激減.
OSM_VECTOR_ZOOMS = [17]

# レート制限 (GSI のみ、 OSM PMTiles 抽出は適用外)
GSI_RATE_LIMIT_SEC = 1.0  # 地理院規約「大量アクセス自粛」の安全側、 1 req/s

# DL 上限警告 (これを超えたら user 確認を求める)
TILE_FETCH_WARN_THRESHOLD = 1000

# DB schema version (migration 用、 PRAGMA user_version と同期)
SCHEMA_VERSION = 1
