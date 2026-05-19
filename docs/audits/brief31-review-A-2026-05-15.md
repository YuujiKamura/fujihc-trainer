# brief 31 起動 wiring audit (reviewer A, 2026-05-15)

## 1. register (= viewer/bridge/static 責務境界) — **LOAD-BEARING**
viewer module が「mode 確定」「URL 組立」「fetch hot path」「dbinit UI」を全部抱えてる。`checkSetupStatus` が「bridge 健全性 probe」と「DB 充足度 probe」を 1 fetch で兼任、責務が 2 つ混じってる。**fix**: probe を `probeBridge() → boolean` と `fetchDbStatus() → {overall,sources}` に二分割、`bootCheckSetupStatus` が順次呼ぶ。失敗 mode が独立化し、誤接合 (= 今回の 404 → bridge:true) が構造的に起きなくなる。

## 2. 語彙 — **LOAD-BEARING**
`TILE_BASE_URL = BRIDGE_TILE_BASE_URL` alias は完全な誤読 trap。line 971 の `${TILE_BASE_URL}/osm_raster/...` は static mode でも bridge URL を生成 = 静的サイトで 404 量産確定。「audit gate 後方互換」目的で残してるが、gate 側を直す方が安い。**fix**: alias 削除、`viewer_url_audit` の `TILE_BASE_URL` grep を `BRIDGE_TILE_BASE_URL` に書き換える。`_bridgeReachable` も `mapMode: 'bridge'|'static'` の enum 化推奨 (= mutable bool は negation の方向で誤読される)。

## 3. 抽象段差 — **BLOCK**
URL 組立が散らばってる箇所: `buildMapStyle` 内 2 source × 2 mode、`loadCourse` (line 832)、`loadOsmTile` (line 971、bug 本体)、`startGsiFetch`/`startOsmExtract` (bridge 専用 POST)、`buildMinimapTopBase` (line 1005, bridge 専用 POST)。各々が独立 if 分岐 or 直叩き、grep gate なしで 1 source 追加すれば漏れる。**現に line 971 が漏れた**。**fix**: `lib/tile_urls.js` を新設し `tileUrl(kind, {z,x,y}, mode)` の単一抽象に集約。bridge 専用 POST endpoint (`_fetch_gsi` 等) は `if (mode==='bridge')` で wrap、static mode では即 return。

## 4. test (= 「bug を温存する gate」) — **BLOCK**
`static_mode.test.js` line 60 `bridgeReachable: true の出現を **きっかり 2** 要求` は実装の bug 形状を pin する典型的 anti-pattern。元実装 (404→true) が 3 出現で grep が「3 → reduce to 2」しか許さない設計なら、bug を温存する方向に書き手を誘導する。さらに **動作 test がゼロ** — 全部 source-grep。「fetch が timeout したら static に倒れる」「`/static/tiles/...` 形 URL が実際生成される」は msw or stub で behavioral に書ける。**fix**: (a) grep の「出現回数 == N」を「特定 branch の return 値が期待形」に置換、(b) `buildMapStyle({bridgeReachable:false})` の output object snapshot test を 1 本足す、(c) `checkSetupStatus` の behavioral test (fetch stub で 200/503/404/timeout 4 経路)。

## 5. 設計境界 (race + 単一判定軸) — **LOAD-BEARING**
`_bridgeReachable` は module-scope mutable、初期値 `true`。`bootMap()` が `_bridgeReachable = bridgeReachable` で同期更新するため `bootMap → loadCourse` 線では race なし。**但し `MAP_MODE`/`TEST_MODE` 経路で `ensureMapBooted().then(initMapMode)` は async、その間に `loadOsmTile` 呼出が `buildMinimapTopBase` から走ると初期値 `true` を読む可能性**。実害は line 971 の `TILE_BASE_URL` 直叩き (alias 削除すれば消える)。判定軸が 1 fetch に集中している点は #1 で分離すれば解決。**fix**: 初期値を `null` (= 未確定) にして null check 強制、または `bootMap` を Promise 化して全 caller が await。

## 6. マイグレ可逆 (= alias 撤去) — **MINOR**
`TILE_BASE_URL` alias は test gate 1 箇所 (`viewer_url_audit.test.js` line 36, 51) と viewer line 971 でしか使われてない。撤去は grep を `BRIDGE_TILE_BASE_URL` に rename + 971 を `${BRIDGE_TILE_BASE_URL}/...` (bridge mode 時) / static fallback (e.g. blank fill) に分岐するだけ、1 commit で可逆。むしろ残す方が dangerous。

## 7. security (= ToS / 外部 fetch) — **MINOR**
static mode で `loadOsmTile` が line 964 `https://tile.openstreetmap.org/...` に fallback する経路は brief 29 で明示許可、ToS 範囲内 1-shot。CSP `connect-src` には strava のみ列挙、OSM tile.openstreetmap.org が抜けてる → static mode で fallback が CSP block される疑い。**確認**: `img-src` は `'self' data: https://*.strava.com` なので OSM tile (`https://tile.openstreetmap.org/...`) は **block される**。bridge mode では `/tiles/...` (same-origin) なので問題なし、static mode で発火する。**fix**: `img-src` に `https://tile.openstreetmap.org` 追加、または static mode では OSM 直叩き fallback を切る (= bridge_raster 経路を諦める)。

## 全体判定: **構造修正 NEED**

1 行 fix (line 339 `true→false`) は症状を消すが、(a) #3 の URL 散在 5 箇所のうち line 971 alias 経路が残ったまま (static mode で `/tiles/osm_raster/` を叩いて 404 → OSM fallback → CSP block の連鎖)、(b) #4 の grep gate が次の bug を温存する形のまま、(c) #2 alias 由来の誤読 trap が残る。

**最小限の構造修正 (= 3 commit)**:
1. `TILE_BASE_URL` alias 撤去 + audit gate を `BRIDGE_TILE_BASE_URL` に rename + line 971 を mode 分岐
2. `tile_urls.js` 抽出 + 全 URL 組立を集約 + behavioral test (`buildMapStyle` snapshot + `checkSetupStatus` fetch stub) 追加
3. `static_mode.test.js` の 「出現回数 == N」 grep を「branch return 形」assertion に置換

`_bridgeReachable` の enum 化 / probe 分割は次 sprint で可、即 BLOCK ではない。
