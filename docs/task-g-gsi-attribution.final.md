# タスク (確定版 v3): 国土地理院 / OpenStreetMap 帰属表示の検証・修復と消失検知テストの強化

> **v3 改訂の経緯**: 元ブリーフ `task-g-gsi-attribution.md` を 7 軸 audit にかけ全軸 LOAD-BEARING NG
> で REDRAFT したのが v1。v1 は「production viewer は MapLibre を使う」と誤認していた (audit
> subagent 7 名と main がそろって import 文を辿らず、ファイル名 `viewer-maplibre.js` と
> `.maplibregl-ctrl-attrib` を querySelect する関数から MapLibre と推論)。実コードを ground-truth
> した結果、b12 Phase 4 で描画エンジンは **Three.js** (`web/lib/map3d/`) に差し替え済で、
> MapLibre 実装 (`web/lib/map_renderer.js`) は **import されていない dormant コード**だった。
> 本 v3 は Three.js 実機構に即して全面再訂正したもの。NG 詳細・audit 自体の誤りは
> `~/.agents/state/fujihc-trainer/audit-drift-catalog.md` の "task-g-gsi-attribution Round 1" 参照。

## はじめに

国土地理院 (GSI) の地理院タイルと OpenStreetMap (OSM) のタイルは、いずれも利用条件
(GSI 利用規約 / OSM の ODbL) が**出典明示**を義務付けている。viewer が地図タイルを画面に
表示している以上、その出典が画面に見えていなければコンプライアンス違反になる。harm の向先は
viewer 利用者本人ではなく**第三者である配布元 (GSI / OSMF) とその ecosystem** であり、
「個人の責任で済む」class ではない。

このタスクは「帰属表示が画面から消えた、復活させろ」というもの。**実コードを ground-truth
した結果、帰属表示は実際に消えている (= バグは実在する)** ことが分かった。経緯はこうだ:

- viewer はかつて MapLibre で地図を描き、MapLibre 標準の `AttributionControl` が出典を
  `.maplibregl-ctrl-attrib` という DOM 要素に自動描画していた。
- b12 Phase 4 で描画エンジンが Three.js に差し替えられた。Three.js レンダラ
  (`web/lib/map3d/index.js` が返す 15 メソッドのオブジェクト) は地形メッシュを描くだけで、
  **帰属表示の機構を一切持たない**。MapLibre の `AttributionControl` は engine 差し替えで消えた。
- 一方 `viewer-maplibre.js` の `verifyAttributionVisible()` (帰属表示の消失を監視する関数) は
  依然 `.maplibregl-ctrl-attrib` を探しており、engine 差し替え後はこれが常に不在 → viewer は
  起動のたびに「attribution control が DOM に存在しません」warning を自分で発火している。
- `index.html` に出典を表示する DOM 要素 (`#attrib` 等) は無い。**production viewer の画面に
  GSI / OSM の出典は一文字も出ていない。**

したがって本タスクは (1) 実画面で出典が出ていないことを最終確認し、(2) **Three.js viewer に
即した帰属表示 DOM を新設**して GSI / OSM の出典を常時表示し、(3) `verifyAttributionVisible()`
の監視対象を新 DOM に更新し、(4) 「出典が DOM に実在し可視」を Playwright e2e で固定して
二度と黙って消えないようにする ── という順で進める。

## 対象 viewer の確定

本タスクの「viewer」は **production viewer = `web/index.html`** 1 つに確定する。構成:

- `web/index.html` — DOM / CSS / CSP。`<script type="module" src="viewer-maplibre.js?v=40">` で viewer を load。
- `web/viewer-maplibre.js` — viewer 本体 (ファイル名は歴史的、中身は MapLibre 非依存)。
- `web/lib/map3d/` — Three.js 地図描画モジュール (`index.js` が `createMapRenderer()` を export、
  `viewer-maplibre.js:7` が import)。

対象外 (触らない):

- `web/terrain3d.html` / `web/lib/terrain3d.js` — terrain3d.html はスタンドアロンの別ページで、
  既に独自の `#attrib` 要素 (GSI 出典 + 地理院タイル一覧リンク) を持つ。production viewer は
  terrain3d.html を load せず、terrain3d.js も import しない (= 純データモジュール)。
- `web/lib/map_renderer.js` — MapLibre 実装。`createMapRenderer()` を同じ interface で export
  するが **production viewer は import していない** (= dormant、engine 差し戻し用の代替実装)。

## 帰属表示の実機構 (元ブリーフ・v1 の誤りの訂正)

元ブリーフ・v1 の機構記述はいずれも誤り。正しい実機構は以下:

- **描画エンジン** = Three.js。`viewer-maplibre.js:7` の
  `import { createMapRenderer } from './lib/map3d/index.js';` が SoT。`map3d/index.js` の
  `createMapRenderer()` が返すオブジェクトは地形・コース・ライダー・カメラの 15 メソッドのみで、
  **帰属表示に関わるメソッド・DOM・文字列は一つも無い**。
- **タイル配布元** (= 出典が要る相手) は GSI と OSM の 2 者:
  - GSI 標高 (DEM): `web/lib/map3d/tile_loader3d.js` の `loadDemStitched` が bridge のローカル DB
    (`${origin}/tiles/gsi_dem/{z}/{x}/{y}.png`) から取得。bridge 配信の DEM は GSI dem_png 形式。
  - GSI 航空写真 (seamlessphoto): 同 `tile_loader3d.js` の `loadPhotoCanvas` が GSI online
    (`https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/`) から取得し 3D 地形メッシュに貼る。
  - OSM ラスタ: `viewer-maplibre.js` の `loadOsmTile` が bridge
    (`${BRIDGE_TILE_BASE_URL}/osm_raster/{z}/{x}/{y}.png`) から取得し minimap 上半分
    (`#minimap-top` canvas) に描く。
  → **3D 地形は GSI、minimap は OSM**。両方の出典が画面に要る。
- **現状の帰属表示** = 無い。`index.html` に `#attrib` 等の出典 DOM 要素は存在しない。
  MapLibre `AttributionControl` は engine 差し替えで消失。Three.js 版に出典 DOM は未実装。
- **監視 (壊れている)** = `viewer-maplibre.js` の `verifyAttributionVisible()` (815-835 行)。
  `.maplibregl-ctrl-attrib` を `querySelector` するが、Three.js viewer にこの class は存在しない
  → 常に `showAttributionWarning('attribution control が DOM に存在しません')` を発火し、
  `#status` 要素に「[警告] 帰属表示 (国土地理院 / OSM / MapLibre) が消えています」を出す。
  `verifyAttributionVisible()` は `onMapLoaded()` 内で `requestAnimationFrame` 経由に 1 回呼ばれる。

用語: 本タスクで「帰属表示 (attribution)」は地図タイルの出典クレジット表示を指す。元ブリーフの
「出典クレジット表記 / 出典表記 / クレジット」は同義語、以後「帰属表示」に統一する。`#attrib`
(本タスクで新設する HTML 要素 id、terrain3d.html と同名) と `.maplibregl-ctrl-attrib`
(MapLibre が付与していた DOM class、現 viewer には不在) は別物。

## 既存資産 (実装前に必ず読め)

- **既存テスト**: `web/tests/integration_overlay_z_order.test.js` に attribution 関連テストが
  **5 件**ある。全て vitest の静的 grep で、engine 差し替え前の MapLibre 機構を pin している:
  - (a) `verifyAttributionVisible` 関数が定義済 (76-78 行) — 関数自体は今も存在、有効。
  - (b) 同関数が `.maplibregl-ctrl-attrib` の display/visibility/opacity を check (80-89 行) —
    **stale**。監視対象が dead な class。
  - (c) 違反時 `showAttributionWarning` で warning banner、`#status` を借りる (91-98 行) — 有効。
  - (d) `onMapLoaded` 内で `verifyAttributionVisible` を呼ぶ (100-109 行) — 前半有効。
  - (e) `buildMapStyle` の attribution に「国土地理院 標高タイル」「© OpenStreetMap contributors」
    両方を含む (209-213 行) — **misleading**。grep 対象が dormant な `map_renderer.js`。
    production に効かないコードを assert しており、green でも実画面に出典は出ない。
  → これらの (b)(e) は「現状コードが壊れているのに green」な misleading test。**消すのではなく、
  Three.js 実機構 (= 新設する `#attrib` 要素) を pin する形に書き換える**。重複する別 grep テストを
  新規に作るな。「実描画の可視性」layer は下記 e2e で補う。
- **e2e の場所と起動**: Playwright の `testDir` はリポ root の `e2e/`。`playwright.config.js` の
  `webServer` が `python -m fujihill.bridge --dummy --http-port 8000 --port 8765` を自動起動
  (`reuseExistingServer: true`)。既存 spec は `e2e/pairing_to_ride.spec.js`
  (`?test=1&consent=dev` で起動し `body` が `state-riding` class を得るまで待つ)、
  `e2e/history.spec.js`、`e2e/user_journey.spec.js`。**attribution の e2e は現状 1 本も無い。**
- **Service Worker**: `web/sw.js` は 2026-05-17 改修で「アプリ本体 (html/js/css) は network-first /
  重い静的資産 (tile/pmtiles/json/画像) は cache-first」の資産種別分岐になっている。`index.html` /
  `viewer-maplibre.js` は network-first 経路 → online の限り常に最新版が配られ、cache-first 時代の
  stale door (= 修正がユーザに届かない) は閉じている。

## やること

### step 1 — 実画面で現状を確認する

viewer を起動し実画面を観る。**`chrome --headless` 直叩き禁止、`headless-shot.ps1` も禁止**
(viewer は無限 rAF + Service Worker の never-idle ページで headless Chrome が終わらず、過去に
ホスト Windows をクラッシュさせた)。`verify-fujihc-screen` スキルの安全な起動方法か、通常の
Chrome ウィンドウ + `desk_capture` (既存ウィンドウを撮るだけで Chrome を spawn しない) を使う。
viewer を映した Chrome ウィンドウが無ければ自分で 1 回だけ通常タブで
`http://127.0.0.1:8000/?test=1&consent=dev` を開いてから `desk_capture` する。

確認すること:

- 画面に GSI (`国土地理院`) と OSM (`OpenStreetMap`) の出典がどこかに出ているか。
- viewer 自身の帰属消失 warning (`#status` に「[警告] 帰属表示 ... が消えています」) が出ているか。
- 「出てる / 出てない」で済ませず、**どこに・何の文字で・どう出ているか**を書く。

### step 2 — 観察結果で分岐する

- **分岐 A (帰属表示が読める形で出ている)**: 想定外。実機構の調査結果と矛盾するので、なぜ出て
  いるのか (= 別経路の attribution があるのか) を再特定する。
- **分岐 B (出ていない)**: 実機構の調査どおり。原因は engine 差し替えで MapLibre
  `AttributionControl` が消え、Three.js 版に出典 DOM が未実装なこと。step 3 で修復する。
  → **調査結果は強く分岐 B を示している** (viewer 自身が消失 warning を発火する状態)。
  step 1 はその最終確認。

### step 3 — 帰属表示 DOM を新設し、監視対象を更新する

分岐 B の修復。terrain3d.html の `#attrib` 要素と同型の、静的 HTML による出典表示を新設する。

1. **`index.html` に `#attrib` 要素を追加する** (静的 HTML、`<body>` 内、minimap-container の
   近辺など末尾)。内容は GSI と OSM の両方:
   - GSI: `© ` + `<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank"
     rel="noopener">国土地理院タイル</a>` (CLAUDE.md が「`© 国土地理院タイル` + ichiran.html
     リンクを常時表示」と要求する文言・リンクに一致させる)。
   - OSM: `© ` + `<a href="https://www.openstreetmap.org/copyright" target="_blank"
     rel="noopener">OpenStreetMap contributors</a>` (ODbL の出典表示)。
   - 地形=GSI / 地図=OSM が分かるラベルを添えてよい (例: `地形: © 国土地理院タイル ｜ 地図: ©
     OpenStreetMap contributors`)。
2. **`index.html` に `#attrib` の CSS を追加する**。terrain3d.html の `#attrib` を踏襲しつつ:
   - `position: fixed` で画面右下隅・最下部 (例 `right: 1rem; bottom: 8px`)。`#hud` / `#controls`
     は `bottom: 2.5rem` (= 40px) に持ち上げられており、その下の 0〜40px 帯が出典の定位置
     (index.html の既存 CSS コメントが「画面下端の attribution に重ならないよう UI を上に逃がす」
     と書いている設計意図そのまま)。
   - 暗い地形の上でも読めるよう明色テキスト + 不透明背景 + 枠でコントラスト確保。
   - `z-index` は全 overlay (intro 1450 / setup 1500 / 〜 loading-indicator 2000) より上
     (例 2001)。理由: intro / setup / dbinit overlay は半透明 (`rgba(0,0,0,0.55)`) で、その間も
     背後の 3D 地形タイルは画面に見えている (overlay を半透明にしたのは「何のアプリか地図で
     伝える」ため = index.html の既存コメント)。タイルが見えている=出典が要る。全 state
     (checking / dbinit / pairing / riding) で常時・読める形で見せるには overlay より上に置く。
3. **`viewer-maplibre.js` の `verifyAttributionVisible()` の監視対象を `#attrib` に更新する**
   (815-835 行)。`.maplibregl-ctrl-attrib` の `querySelector` を `#attrib` の取得
   (`getElementById('attrib')`) に置き換える。display/visibility/opacity を check して隠れて
   いたら `showAttributionWarning()` を呼ぶロジックは維持。warning 文言の「MapLibre」表記は
   実態に合わせて整理してよい (例: 「国土地理院 / OSM」)。
4. **stale なコメントを正す**。`index.html` の `#hud` / `#controls` CSS の「MapLibre attribution」
   を指すコメント (55-56 / 78 行付近) を、新設の `#attrib` 要素を指す記述に直す。
   `viewer-maplibre.js` の `verifyAttributionVisible` / `showAttributionWarning` 周辺コメントの
   「MapLibre」表記も実態に合わせる。コメント修正のみ、挙動は変えない。
5. **既存テスト 5 件を Three.js 実機構に合わせて書き換える** (`integration_overlay_z_order.test.js`):
   - (b) の `.maplibregl-ctrl-attrib` を `#attrib` (= `getElementById('attrib')`) に。
   - (e) の dormant な `map_renderer.js` grep を、`index.html` の `#attrib` 要素が `国土地理院`
     と `OpenStreetMap` の両方を含むことの grep に repoint する (= 帰属文字列の SoT は
     新設の静的 `#attrib` HTML)。
   - `index.html` に `#attrib` 要素が存在し、GSI 一覧リンク (ichiran.html) を含むことの grep を
     1 件足してよい。
   - (a)(c)(d) は有効なので維持。テストを消すな。

### step 3' — 消失検知テストを e2e で強化する

vitest の静的 grep は「文字列・関数がソースに存在する」ことしか pin できない。「DOM に実在し
可視」は実ブラウザでないと固定できない。`e2e/` に `e2e/attribution.spec.js` を 1 本足す。
`e2e/pairing_to_ride.spec.js` の起動パターンを踏襲し、最低限 pin すること:

- `?test=1&consent=dev` で viewer を起動し `body` が `state-riding` class を得るまで待つ
  (timeout 20s)。
- `#attrib` が Playwright の `toBeVisible()`。
- `#attrib` のテキストに `国土地理院` と `OpenStreetMap` の**両方**を含む。
- `getComputedStyle` で display ≠ `none` / visibility ≠ `hidden` / opacity ≠ `0`。
- 他要素に覆われていないこと: `#attrib` 中心点を `document.elementFromPoint` で引いたとき、
  返る要素が `#attrib` 自身またはその子孫であること (= z-index で他 overlay に覆われたら落ちる)。

地図が描画される state でのみ帰属表示は意味を持つ。riding は `?test=1&consent=dev` で確実に
到達できるのでここを e2e で pin する。`#attrib` は state 非依存で常時表示する設計なので、
checking / dbinit / pairing でも DOM に存在し可視であることは step 1 の実画面観察で確認し、
完了報告に書く。

### step 4 — 真正性確認 (必須)

step 3' で足した e2e と、step 3-5 で書き換えた vitest grep テストが、いずれも真正
(虚構を assert していない) であることを手元で 1 回確認する。書き換えた grep テストも対象に
含める理由: 本タスクが直そうとしている既存 (b)(e) はまさに「壊れているのに green」な
misleading grep テスト (catalog NG-RG-5)。書き換えた後のテストが同じ罠に落ちていないことを、
書き換え後のテスト自身で確認する。

1. 改変前に `git diff` がクリーンな状態から始める。
2. `index.html` の `#attrib` 要素を一時的に壊す ── `#attrib` 要素そのものを削除する
   (または中身のテキストを空にする)。これで e2e の可視性/テキスト check も、grep テストの
   要素存在/文字列 check も同時に落ちるはず。
3. `npm run test:e2e` と `npm test` を走らせ、**step 3' の新規 e2e と step 3-5 で書き換えた
   grep テストの両方が落ちる**ことを確認する。落ちないテストがあればそれは真正でない ──
   書き直し。
4. `index.html` を元に戻す。
5. `git diff web/index.html` で**残存改変ゼロ**を確認してから次へ進む。
   **帰属表示を壊した状態を絶対に commit するな。**

## 検証

- `npm test` (vitest)、`npm run test:e2e` (Playwright)、`python -m pytest` を全て走らせ、
  全て green。各々の passed / failed 数を完了報告に書く。
- `desk_capture` で実画面を観て、GSI と OSM の帰属表示が画面に見えることを批評する。
  「出てる」で済ませず、**どこに何の文字で出ているか**を書く。`#status` の消失 warning が
  解消したことも確認する。
- step 4 の真正性確認の結果 (わざと壊して e2e が落ちたか、戻して `git diff` ゼロを確認したか)。

## 制約

- `web/terrain3d.html` / `web/lib/terrain3d.js` / `web/lib/map_renderer.js` は本タスク対象外。
  触らない (map_renderer.js は dormant、attribution 文字列も engine 差し戻し用に残置)。
- GSI / OSM タイル配布元配慮ルール (GSI 取得上限 200・同時接続 6・`seamlessphoto` 固定・
  Python 側 1 req/s、`bridge.py` の `127.0.0.1` bind 固定、`tile.openstreetmap.org` 直叩き禁止)
  を破るな。帰属表示の改修はタイル取得経路に一切触らない。
- `index.html` の CSP (`default-src 'self'`; `script-src 'self' 'sha256-...'` 等) を壊すな。
  `#attrib` は静的 HTML (`<a href>` 含む) のみで、新規インライン `<script>` / インライン
  イベントハンドラを足さない。外部サイトへの `<a href>` 遷移は CSP の resource-loading 制約
  (`connect-src` / `default-src`) の対象外なので問題ない。
- **Service Worker の `CACHE_NAME` / `?v=` は bump しない**。`sw.js` は 2026-05-17 改修で
  app shell (html/js/css) を network-first にしており、`index.html` / `viewer-maplibre.js` を
  変えても online ユーザには常に最新が届く (= cache-first 時代の stale door は閉じている)。
  catalog の「app shell 変更で CACHE_NAME bump 必須 (NG-R2-1)」は cache-first 時代のルール。
  `web/tests/sw_cache_version.test.js` は index.html と sw.js の `?v=` 一致のみを判定するため、
  両方 `v=40` のまま据え置けば green を維持する。`?v=` を片方だけ動かす半 bump はするな。
- 消失検知は **warning 止まり** (既存 `verifyAttributionVisible` / `showAttributionWarning` の
  設計)。block / 描画停止に格上げするな。理由: サイト運営者が ToS 違反主体になるのは出典が
  「最初から出ていない」場合 (= 本タスクが直す対象)。訪問者が DevTools で出典を `display:none`
  にした場合の harm は inject した本人にしか及ばず第三者に影響しない ── block するほどの
  harm class ではない。
- ローカル commit まで。`git push` は絶対禁止。commit は触ったファイルのみ明示パスで
  `git add`、`git add -A` 禁止。

## 完了報告 (すべて埋めること)

1. step 1 の実画面観察結果 ── どの state で何が出て、GSI / OSM の出典が出ているか、`#status` の
   消失 warning が出ているか。
2. 分岐 A / B のどちらだったか。
3. 修復内容 ── 直したファイルと該当箇所 (`index.html` の `#attrib` 要素・CSS、
   `viewer-maplibre.js` の `verifyAttributionVisible` 監視対象、stale コメント)。
4. 追加 / 書き換えたテスト ── ファイル名、テスト名、各テストが何を pin するか。書き換えた
   既存 5 件と新規 e2e を区別して書く。
5. step 4 の真正性確認の結果 ── わざと壊したら新規 e2e が落ちたか、戻して `git diff` ゼロを
   確認したか。
6. `npm test` / `npm run test:e2e` / `python -m pytest` の passed / failed 数。
7. リポジトリ `CLAUDE.md` の記述 (「`© 国土地理院タイル` + ichiran.html リンクを常時表示する
   `#attrib` 要素を消さない」) との整合 ── 本タスクの修復はまさにその `#attrib` 要素を新設する
   ものなので、修復後は CLAUDE.md の記述と実装が一致する。CLAUDE.md の変更は不要。

## まとめ

本タスクは「帰属表示が消えた」バグの修復。原因は b12 Phase 4 の描画エンジン差し替え
(MapLibre → Three.js) で、MapLibre が自動描画していた `AttributionControl` が消え、Three.js 版に
出典 DOM が引き継がれなかったこと。修復は terrain3d.html と同型の静的 `#attrib` 要素を
`index.html` に新設し (GSI + OSM 両方の出典、GSI 一覧リンク付き、全 overlay より上の z-index で
常時可視)、`viewer-maplibre.js` の消失監視 `verifyAttributionVisible()` の対象を `#attrib` に
更新する。既存 5 件の grep テストは dead な MapLibre 機構を pin して「壊れているのに green」な
misleading test になっているので Three.js 実機構を pin する形に書き換え、実ブラウザでの可視性は
新規 e2e (`e2e/attribution.spec.js`) で固定する。タイル取得経路・CSP・SW・配布元配慮ルールには
一切触れない。完了条件は npm test / test:e2e / pytest 全 green + 実画面で GSI / OSM 出典が
読める形で見えること + 真正性確認 (わざと壊すと新 e2e が落ちる)。

## 参照

- 国土地理院 地理院タイル一覧・利用規約: <https://maps.gsi.go.jp/development/ichiran.html>
  ── 地理院タイルの一覧と利用条件。出典明示が利用の条件。
- OpenStreetMap 著作権とライセンス: <https://www.openstreetmap.org/copyright>
  ── OSM データは ODbL。`© OpenStreetMap contributors` の出典表示義務の根拠。
- OSMF Tile Usage Policy: <https://operations.osmfoundation.org/policies/tiles/>
  ── 本リポは OSM ラスタを bridge 経由で配るため公式タイルサーバに直接負荷はかけないが、
  出典表示の趣旨は共通。
- Playwright `toBeVisible` / locator assertions:
  <https://playwright.dev/docs/api/class-locatorassertions>
  ── e2e の可視性 assert の API。
- 監査記録: `~/.agents/state/fujihc-trainer/audit-drift-catalog.md` の
  "brief task-g-gsi-attribution Round 1" 節 ── 7 軸 audit の NG 詳細、audit 自体が
  MapLibre と誤認した経緯、訂正後の正しい実機構。
