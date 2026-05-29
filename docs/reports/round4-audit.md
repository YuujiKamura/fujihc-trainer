# Round 4 audit (target: 225cc2a..HEAD = 750b600 brief 17b)

## 総評

brief 17b は Round 3 で LOAD-BEARING flag された NG-R1-15 / NG-R1-16 (= viewer-map3d.js から OSM / GSI への runtime 直叩き) を**物理層で**解消した。 外部 URL の文字列が source から消え、 さらに `web/tests/viewer_url_audit.test.js` (4 件) が source-grep gate として復活防止に CI で常時稼働する。 prefetchTilesAlongCourse 本体 + minimap の `loadOsmTile` (= dead code) も同 commit で削除、 viewer-map3d.js は -46 行で責務が縮小した。 SCHEMA_VERSION の重複定義は `from fujihc.tile_constants import SCHEMA_VERSION` に置換され、 NG-R1-14 系の silent drift リスクが SoT 化で解消。 `estimateTileCount` を JS / Python 両側に追加 + cross-language fixture test も pass、 brief 14 数値表との整合性が機械化された。

test 結果は python 111 passed / 4 skipped、 JS 36 passed (= 5 file: tile_math 6 + heading 5 + terrarium 9 + viewer_url_audit 4 + tile_coverage 12)。 brief 17b で予告された +9 件 (= JS 27 → 36) も完全一致。 viewer-map3d.js の `TILE_BASE_URL = ${location.origin}/tiles` は bridge.py の `/tiles/{source}/...` proxy (brief 17a) を物理的に経由するため、 復活には HTML / source / test の 3 箇所同時改竄が必要 (= memory-only rule ではなく Rule 9 物理層 gate に昇格)。

**残留する MINOR (= scope 外、 brief 17b の責務外)**: (a) `web/viewer.js` (= Cesium 版) が依然 `tile.openstreetmap.org` + `cyberjapandata.gsi.go.jp` を直叩き、 かつ `web/index.html` の default load 対象は viewer.js のまま (= NG-R1-2 / NG-R1-15/16 が「Cesium 版だけ」に転移して残存)。 brief 12 の Cesium 凍結方針が source / README に明文化されていない (= drift catalog 共通 pattern 2 「2 版並走の責務未定義」)。 (b) viewer-map3d.js 689 行は依然 single file (= NG-R1-7 / 設計境界軸の brief 19 未着手案件)。 (c) 503 fallback DOM 未実装。 これらは Round 5 (= brief 19) で処置すべき項目で、 brief 17b の責務外。

## 7 軸 verdict

| 軸 | verdict | severity | category | 一行 |
|---|---|---|---|---|
| 1. register/構造 | PASS | COSMETIC | RESOLVED | コメントが「なぜ削除したか / どこに移したか / どの test が gate か」を明示、 命名整合 (TILE_BASE_URL の単一定数) も良好 |
| 2. 語彙 | PASS | COSMETIC | RESOLVED | `TILE_BASE_URL` で「同一 origin proxy 経由」概念が単一語彙化、 source 識別子 (`osm` / `gsi_dem`) が DB schema (brief 14) と一致して語彙の SoT 化が進行 |
| 3. 抽象段差 | PASS | MINOR | PERSISTENT | viewer の 1 関数 multi-層 残り (loadCourse / tick / buildMinimapBase) は brief 17b scope 外、 brief 19 で module 分離待ち。 17b 自体は dead code 削除で抽象段差を 1 段下げた (改善方向) |
| 4. テスト網羅 | PASS | LOAD-BEARING | RESOLVED | viewer_url_audit (4 件) が source-grep gate として復活防止を物理化、 tile_coverage +5 件 で estimateTileCount を cross-language fixture pin、 36 件全 pass |
| 5. 設計境界 | PASS | MINOR | PARTIAL | SCHEMA_VERSION 重複定義は import に置換で完全 dedupe (SoT 化)、 ただし viewer 統合層 689 行は brief 19 scope (= 持ち越し) |
| 6. マイグレ可逆 | PASS | MINOR | PERSISTENT | viewer の addProtocol inline 維持、 503 fallback DOM 未実装は持ち越し。 brief 17b scope では退行ゼロ、 むしろ TILE_BASE_URL 集約で将来差し替え点が単一化 |
| 7. セキュリティ | PASS | LOAD-BEARING | RESOLVED | NG-R1-15 / NG-R1-16 を viewer-map3d.js 側で完全解消、 物理 gate (viewer_url_audit test) で復活を CI block。 ただし viewer.js (Cesium 版) に同 class 残存 = MINOR 持ち越し |

## 残課題 (= MINOR / 持ち越し、 Round 5 候補)

1. **viewer.js (Cesium 版) の外部 URL 残存**: `web/viewer.js:14` (tile.openstreetmap.org)、 `web/viewer.js:34` (cyberjapandata.gsi.go.jp)、 `web/viewer.js:514` (OSM 直叩き)。 同 source-grep gate を viewer.js にも掛けるか、 brief 12 の凍結方針を物理化 (= viewer.js を削除 / 別 dir に隔離 / index.html の load を index-maplibre.html に統一) すべき。 brief 19 候補。
2. **2 版並走の責務未定義**: `web/index.html` (= viewer.js を load) と `web/index-maplibre.html` (= viewer-map3d.js を load) の関係が README に未明記、 user / 後続 reader がどちらを default に開けばいいか判断できない (= NG-R1-2 再演継続)。
3. **viewer-map3d.js 689 行 single file**: brief 19 で `web/lib/` 配下に WebSocket / minimap / camera / hud を pure module 分離する案件 (= NG-R1-7 / NG-R1-12 系)。
4. **503 fallback DOM 未実装**: bridge.py /tiles/... が 503 を返した時の user 通知 UI が viewer 側にない、 silent failure リスク。

## 検証 checkpoint 結果

| # | check | 結果 |
|---|---|---|
| 1 | `git diff` で viewer の 外部 URL が消えた | OK (-46 行、 OSM/GSI literal 削除) |
| 2 | viewer-map3d.js に外部 host literal | 0 件 |
| 3 | viewer-map3d.js に prefetchTilesAlongCourse | 0 件 (コメント言及のみ) |
| 4 | python -m pytest -q | 111 passed / 4 skipped |
| 5 | npm test | 36 passed |
| 6 | init_tile_db.py で SCHEMA_VERSION import 化 | OK (line 18 で from fujihc.tile_constants import SCHEMA_VERSION) |
| 7 | estimateTileCount export | OK (web/lib/tile_coverage.js:83) |
| 8 | cross-language fixture pass | OK (tile_coverage.test.js 12 件 / +5 件 増) |

## 総合判定

LOAD-BEARING 残存 = 0、 COSMETIC = 0、 MINOR (= scope 外持ち越し) = 4 件 (Round 5 候補)。

**CONVERGED**

brief 17b は scope 内責務を完全遂行、 Round 3 で flag された全 LOAD-BEARING は RESOLVED。 MINOR 持ち越し 4 件は brief 17b の責務外 (= 主に brief 19 / Cesium 版凍結処置 scope)、 ship 可。

DONE: round 4 CONVERGED
