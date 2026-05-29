# brief 21 Round 2 audit — 地形メッシュ補完

target: `750b600..HEAD` (= `d5c35cf` brief 12 物理化 + `e65bc6a` brief 21)、 +705 / -354 across 9 files。 Round 1 で flag した 3 件 (二重実装 / cache 根拠 / test 境界) はすべて landed 修正で **RESOLVED**、 viewer-map3d.js は ES module 化されて `lib/terrain_mesh.js` の純関数を import する thin adapter (= 37 行から 1 行呼出) に縮減、 source-grep gate `viewer_url_audit.test.js` に「inline 数式禁止」「lib import 必須」の 2 件が機械化されて再演を物理 block。

frontend 49 tests (terrain_mesh 11 / viewer_url_audit 6 / tile_math 6 / terrarium 9 / heading 5 / tile_coverage 12) 全 pass を確認 (vitest 1.6.1、 web 配下で `npm install` → `npx vitest run` 実行)。 `maxTileCacheSize: 50` は viewer-map3d.js:98-100 に「1024×1024 RGBA = 4 MB/tile × 50 = 200 MB 上限、 ride viewport 9 タイルに十分」と根拠 inline、 NG-R1-1 (load-bearing 数字に根拠) の再演はない。 archived/cesium に viewer.js を move + README.md で凍結宣言、 brief 12 物理化も同 PR で landed (= NG-R1-2 解消)。

残課題は軽微: (a) brief 21 task 文書 (= AI brief) と実装の test 件数 mismatch (= brief は 12 件謳い、 実装は 11 件、 4 隅平均の test は 1 件で実装され brief の「8 件」内訳と微差)、 ship blocker ではない、 docstring 修正で吸収可。 (b) index.html line 189 が `<script type="module" src="viewer-map3d.js?v=29">` で localhost の Python http.server が `.js` を `application/javascript` で送るので MIME 問題は実害ゼロ、 ただし将来 nginx 等で deploy する時は `.js` MIME 設定要確認 (= ship 後の運用 note 化で十分)。

| 軸 | verdict | severity | category | 一行 |
|---|---|---|---|---|
| register/構造 | PASS | — | RESOLVED | `lib/terrain_mesh.js` 1 source、 viewer は 1 行呼出 thin adapter (= NG-R1-1, NG-R1-7 解消) |
| 語彙の規律 | PASS | — | RESOLVED | `bilinearUpsample` / `gsiToTerrariumUpsampled` の 2 名で固定、 `TERRAIN_UPSAMPLE_FACTOR=4` 命名済 (= NG-R1-3 解消) |
| 抽象段差 | PASS | — | RESOLVED | docstring に「6m grid → 1.5m grid 等価」「VRAM 200 MB 上限」「block-center sampling」の中段戦略明記 (= NG-R1-6 解消) |
| テスト網羅性 | PASS | low | RESOLVED | 11 件 (factor=1 identity / factor=4 size / 中央平均 / alpha=255 / 0m / 富士山 3776m / 無効ピクセル / 1024×1024 / factor=1 全変換 / 中央 2x2 平均 / alpha 出力)、 全 pass、 brief 謳いは 12 件で 1 件 off-by-one (docstring 訂正で吸収) |
| 設計境界 | PASS | — | RESOLVED | `lib/` 切出し + addProtocol が thin adapter、 純関数は test 単独で固定 (= NG-R1-10 解消) |
| マイグレ可逆性 | PASS | — | RESOLVED | viewer 二重実装が消えた、 upsample 倍率を `TERRAIN_UPSAMPLE_FACTOR` 1 定数に集約 (= 将来 GPU 化や WASM 移植時の差替点が単一) |
| セキュリティ境界 | PASS | — | STABLE | brief 21 範囲では新規外部 fetch ゼロ、 `gsidem://` は `${location.origin}/tiles` 経由のまま、 NG-R1-15/16 系の再演なし (= brief 17b の gate 6 件全 pass で物理化) |

## 残課題

- **docstring 訂正** (low、 ship blocker 外): brief 21 task 文書では「12 件 test」と謳ったが実装は 11 件、 brief 側または terrain_mesh.test.js header の件数を実態に揃える。 次 commit ついでで OK。
- **MIME 運用 note** (low、 ship blocker 外): `type="module"` 化で deploy 先が `.js` を `text/plain` 等で送ると ES module load が黙って失敗する。 localhost 動作は OK だが、 別 brief で deploy doc に「`.js` を `application/javascript` で送ること」を 1 行追加。

## 総合判定

**CONVERGED** ── Round 1 の 3 NG すべて RESOLVED、 NEW NG ゼロ、 残課題は docstring の off-by-one と将来 deploy note の 2 件で ship blocker 不在。 49 tests green が test harness の物理 substrate。 brief 21 は ship 可、 ただし brief 12 物理化 (= Cesium 凍結) は同 PR に同梱されているので brief 12 側の独立 audit が必要なら別 round で。

DONE: brief 21 round 2 CONVERGED
