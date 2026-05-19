# タスク（確定版）: テストモード切替ボタンの追加

## はじめに

これは `task-testmode-toggle.md`（初版）を multi-axis-draft-audit の 7 軸並列監査にかけた結果の確定版。
初版は **7 軸すべてが LOAD-BEARING NG**（判定 = REDRAFT 必須）だった。主な欠陥は
(1) `## 参照` 欠落、(2)「本番モード」の指す経路が未定義、(3) reload 方式採用の論拠が実コードと食い違う、
(4) 既存テスト未名指し + CI で BLE 経路をどう観測するか無指示、(5) URL 引数の保持・consent 短絡の穴が未記述、
(6) 走行中切替の進捗消失リスク + 真正性確認の戻し漏れガード欠落、(7) タイル配布元配慮・consent gate・プライバシー境界が無評価。
本確定版はこれを実コードの裏取り（`viewer-maplibre.js` / `consent.js` / `sw.js` / 既存テスト群を Read 済）で全て埋めた。
実装者はこの確定版どおりに実装すること。

## 用語定義（初版の語彙曖昧さ = LOAD-BEARING を解消）

- **テストモード**: URL に `?test` がある起動。`viewer-maplibre.js` の起動時定数 `TEST_MODE` が true。
  `dispatchAfterIntro()` が `initTestMode()` に分岐 → fake state を 1Hz で流す demo、トレーナー / bridge / DB 不要。
- **本番モード**: このタスクでは **`initBleMode()`（Web Bluetooth による実機トレーナー直接接続、`dispatchAfterIntro` の default 分岐）** を指す。
  以後この 1 経路を「本番モード」と呼ぶ。`?bridge=1` の python bridge 経路（`bootCheckSetupStatus()`）は yuuji 自宅実環境専用の別経路で、**本タスクのスコープ外**（切替ボタンは `?bridge` を変更しない、保持するだけ）。
- **切替ボタン**: 今回追加する UI。テストモード ⇄ 本番モードを切り替える。初版の「トグル UI」「トグル」「切り替えるボタン」は全て「切替ボタン」に統一。
- **トレーナースキャン経路**: 本番モードで `initBleMode()` が `#ble-section` を表示し BLE 接続ボタン（`#btn-ble-trainer` / `#btn-ble-hrm`）を配線した状態。実機スキャン自体は Web Bluetooth 仕様によりユーザーのボタン click からのみ起動する。

## 目的

viewer を `?test=1` で開くとテストモードに入り、画面から本番モード（実機トレーナーの BLE 接続）へ移る手段が無い。
今は URL を手で書き換えて再読込するしかない。viewer の画面に **テストモード ⇄ 本番モードの切替ボタン**を足し、
本番モードに切り替えれば `initBleMode()` 経由で実機トレーナーの BLE 接続 UI が立ち上がるようにする。

## 確認済みの実機構（コードで裏取り済 — 推測ではない）

初版は「TEST_MODE が本番ハンドシェイクを阻んでいる」と断定したが、正確には「阻む」のではなく「画面内に経路切替の入口が無い」。
以下は `web/viewer-maplibre.js` を Read して確認した事実（行番号は確認時点、実装者も現物で再確認すること）:

- `TEST_MODE`（431 行）: `new URLSearchParams(location.search).has('test')` で起動時に確定する定数。`TEST_MODE` の実コード参照は 431 行の宣言と 1162 行の dispatch 分岐の実質 2 箇所のみ（他は comment）。
- `initTestMode()`（785 行）: fake state client を立て、500ms 後に `startRideConfirmed()` を呼んで自動で `state-riding` に遷移する。
- `initBleMode()`（728 行）: `setAppState('pairing')` → `setup-overlay` を visible 化 → `#ble-section` を `hidden=false`、`#bridge-scan-section` を `hidden=true`。`isWebBluetoothSupported()` が false（= CI / 非対応ブラウザ）なら `.ble-support-msg` を表示し BLE ボタンを `disabled` 化 + fake client に fallback。true なら `createBleClient()` + BLE ボタン配線 + `tryAutoReconnect()`。
- `dispatchAfterIntro()`（1151-1169 行）— 起動分岐:
  ```js
  const ic = CONSENT_DEV_BYPASS ? null : getIntroConsent();
  if (ic && ic.mode === 'view') { initViewMode(); return; }   // ★ TEST_MODE 判定より前に効く
  if (MAP_MODE) initMapMode();
  else if (TEST_MODE) initTestMode();
  else if (BRIDGE_MODE) bootCheckSetupStatus();
  else initBleMode();                                          // ★ 本番モード
  ```
- `consent.js`: `getIntroConsent()` は `{hash, accepted_at, mode}` か `null`。`mode` は `'ride'` か `'view'`。`setIntroConsent({mode})` は `'view'` 以外を全て `'ride'` に倒す。`clearIntroConsent()` で削除。intro の mode に `'test'` は存在しない。
- `sw.js`: `isAppShell()` が `.html|.js|.css` を **network-first** で配信。`viewer-maplibre.js` / `index.html` / 新規 `.js` lib は network-first → コード変更は online なら常に最新が届く。**NG-R2-1（stale cache door）は非該当、`CACHE_NAME` bump 不要**。

## 採る切替方式（確定 — 初版の flat な断定を実コードで補正）

**reload 方式に固定。ランタイム切替はスコープ外（採らない）。**

理由（初版は「TEST_MODE の参照箇所が広い」と書いたが、参照は実質 2 箇所で事実と食い違う。正しい論拠は下記）:
`initTestMode()` / `initBleMode()` はいずれも起動時に完走し、`client` グローバル生成・`setAppState`・overlay DOM 書換・
fake state の `setInterval`（1Hz）を確定させる。起動後にモードを反転するには、走り終えた init の副作用
（旧 `client` の interval 停止、`bootMap` の再実行回避、rAF 多重防止）を全部 teardown する必要があり侵襲的。
reload 方式なら viewer がまっさらな起動時定数から再構成されるため、この teardown 問題が構造的に消える。
ランタイム切替は本タスクでは採らない（「安全なら採れ」の曖昧条件は実装者への丸投げになるため確定で閉じる）。

ただし reload 方式には **intro consent 層を経由する**特性がある（初版が見落とした中段）:
`dispatchAfterIntro()` は `?consent=dev` でない限り `getIntroConsent()` の結果を見て、`mode==='view'` なら
`TEST_MODE` 判定より**前に** `initViewMode()` へ短絡する。よって「`?test` を外して reload」しただけでは、
localStorage に `mode:'view'` が残っていると本番モード（`initBleMode`）に**到達しない**。これを下記「やること 3」で塞ぐ。

## やること

### 1. 切替ボタンの DOM（`web/index.html`、静的 HTML）

- `web/index.html` に静的要素 `#mode-toggle` を新設する（`#attrib` と同じく静的 HTML。JS の `innerHTML` 注入は使わない＝セキュリティ規律）。構成:
  - コンテナ `<div id="mode-toggle">`
  - 現在モード表示 `<span id="mode-toggle-label">`（起動時に viewer が `textContent` で設定）
  - 切替ボタン `<button id="mode-toggle-btn">`（同じく `textContent` で設定）
- CSS: `position: fixed; left: 50%; bottom: 2.5rem; transform: translateX(-50%); z-index: 2001;`（画面下端中央 ── `#hud` 左下 / `#controls` 右下 / `#attrib` 右下隅 / `#minimap-container` 左上 / `#status` 右上 が全部埋まっており、空いているのは下端中央帯のみ。z-index 2001 は `#attrib` と同じ「全 overlay より上」帯）。全 app-state で常時可視。viewer の暗色・monospace スタイルに合わせる。desk_capture で両モードの実画面を観て占有・可読性を確認すること。
- ボタン文言・ラベル文言は `web/lib/mode_toggle.js`（後述）の定数を唯一の正本（SoT）とし、viewer はそれを `textContent` 代入する。

### 2. URL 変換の純関数（`web/lib/mode_toggle.js`、新規）

`viewer-maplibre.js` は maplibre/three を要求する巨大 module で unit import 不可。URL 引数の保持（軸5 の LOAD-BEARING）は
**grep テストでは検証できない**ため、純関数を独立 lib に切り出して実テストで pin する。新規ファイルを作るのはこの理由（テスト可能な SoT が他に無い）。

```js
// web/lib/mode_toggle.js
export const MODE_LABEL_TEST = 'テストモード';
export const MODE_LABEL_PROD = '本番モード';
export const SWITCH_BTN_TO_PROD = '本番モードに切替';
export const SWITCH_BTN_TO_TEST = 'テストモードに切替';

// 現在の location.search を受け、enableTest に応じて test 引数だけを付け外しした
// 新しい search 文字列を返す。test 以外の全引数 (consent / debug / bridge / map / nosw 等) は保持する。
export function buildToggledSearch(currentSearch, enableTest) {
  const params = new URLSearchParams(currentSearch);
  if (enableTest) params.set('test', '1');
  else params.delete('test');
  return params.toString();
}
```

`viewer-maplibre.js` はこの 1 関数 + 4 定数を import して使う。`test` 以外の引数を素朴な文字列置換で落とすと
`consent=dev`（開発者 bypass 消失）/ `bridge`（python bridge 経路喪失）/ `debug` を壊す ── それを `URLSearchParams` 複製で防ぐ。

### 3. 切替ボタンの配線（`web/viewer-maplibre.js`）

- 起動時に `#mode-toggle-label` / `#mode-toggle-btn` の `textContent` を `TEST_MODE` に応じて設定（テストモードなら label=「テストモード」/ btn=「本番モードに切替」、本番なら逆）。
- `#mode-toggle-btn` の click handler:
  1. **走行中ガード（軸6）**: `!TEST_MODE && document.body.classList.contains('state-riding')` のとき（= 本番モードで実走中、未保存 trkpt がありうる）、`confirm('走行中です。モードを切り替えると現在の走行内容は失われます。続けますか？')` を出し、false なら何もせず return。テストモードの「走行」は fake で失う実データが無いため confirm しない（非対称ガード）。
  2. **view consent 短絡を塞ぐ（軸5）**: `getIntroConsent()` の結果の `mode` が `'view'` のときだけ `setIntroConsent({ mode: 'ride' })` を呼ぶ。これで reload 後 `dispatchAfterIntro` の `if (ic && ic.mode === 'view')` 短絡を回避し、本番モード・テストモードのどちらにも確実に到達する。consent が null（`?consent=dev` 等）や既に `'ride'` のときは何もしない（= intro gate ロジックは変更しない、後述プライバシー境界参照）。
  3. `buildToggledSearch(location.search, !TEST_MODE)` で新 search を作り、`location.search = '?' + newSearch`（newSearch が空なら `location.search = ''`）で reload。
- 配線は `viewer-maplibre.js` 末尾の既存「`if (typeof document !== 'undefined') { ... }`」ブロック内（`btnIntroStart` 等を bind している箇所）に足す。新規ファイルは `mode_toggle.js` の 1 つだけ。

### 4. 本番モード到達の確認

本番モードに切り替えて reload → `dispatchAfterIntro` が `initBleMode()` に到達し、`#ble-section` が可視・`#bridge-scan-section` が hidden になることをもって「トレーナースキャン経路に到達」とする。実機トレーナーの BLE スキャン・ハンドシェイク自体は Web Bluetooth 仕様によりユーザー click 起点（`#btn-ble-trainer`）であり、実機ハードウェアのある環境（yuuji の Chrome + 実トレーナー）でのみ完走する。CI には実 BLE が無く `isWebBluetoothSupported()===false` 分岐に落ちる ── その場合も `#ble-section` 可視・`#bridge-scan-section` hidden は成立する（観測点として有効）。

## プライバシー境界（軸7 — task-history D4 再演防止）

- この切替はモードを **テスト（fake state、トレーナー/DB 不要）⇄ 本番（実機トレーナーの power / heart rate を扱い、走行ログ trkpt = lat/lon/power/hr の個人データを生成する経路）** で行き来させる。
- 切替ボタンは **URL の `?test` 付け外し + reload** が本体で、`introConsented()` gate（intro 未通過なら fetch 一切させない物理 gate）のロジックは**変更しない**。reload 後も `getIntroConsent()` は localStorage 永続なので、intro 未通過なら reload しても intro overlay が出る（gate は素通りしない）。
- 「やること 3-2」の `setIntroConsent({mode:'ride'})` は、**既に存在する consent の `view`/`ride` サブモードを正規化するだけ**で、consent そのものを新規付与しない（実装上 `mode==='view'` のときのみ呼ぶ）。切替ボタンは consent が無い・`?consent=dev` でない状態では押せる位置に無い（その状態では intro overlay が前面）。ボタンを押す行為自体がユーザーによる「トレーナー経路を使う」明示選択であり、intro gate を弱めるものではない。
- 配布元配慮（GSI / OSM タイル）: 切替ボタンは fetch / network コードを一切追加しない。reload で viewer が再起動しタイルを再要求するが、`sw.js`（タイルは cache-first）+ IndexedDB TileCache（TTL 内）により配布元への再アクセスは発生しない。`web/tests/viewer_url_audit.test.js` の「外部 fetch ゼロ」gate が green のままであることを確認すること。

## 副作用 / 可逆性

- reload 方式は state を URL に持つため可逆。ランタイム切替は採らないため init 二重走の副作用は発生しない。
- 走行中の reload は in-memory `rideState` と IndexedDB 未書込 trkpt を失う ── 「やること 3-1」の confirm ガードで本番実走時のみ防ぐ。
- `sw.js` の `CACHE_NAME` bump 不要（`viewer-maplibre.js` / `index.html` / 新規 `.js` は network-first 配信、NG-R2-1 非該当 — 確認済）。

## テスト

### 既存ファイルの強化（重複新規ファイルを作らない）

- `web/tests/viewer_ble_branch.test.js`（grep 系、起動分岐を pin 済）に grep テストを追加: `viewer-maplibre.js` が `./lib/mode_toggle.js` から `buildToggledSearch` を import している / `#mode-toggle-btn` の click 配線が存在する / `index.html` に静的 `#mode-toggle` 要素が存在する。
- `web/tests/mode_toggle.test.js`（**新規**、`mode_toggle.js` の純関数 unit test）:
  - happy: `buildToggledSearch('test=1', false)` → `test` を含まない / `buildToggledSearch('', true)` → `test=1` を含む。
  - **引数保持（軸5 LOAD-BEARING の核心 assert）**: `buildToggledSearch('test=1&consent=dev&debug=1', false)` → `consent=dev` と `debug=1` を保持し `test` を含まない。
  - edge: `buildToggledSearch('test=1', true)`（既にテスト ON で ON 要求）→ `test=1` のまま / `buildToggledSearch('consent=dev', false)`（既にテスト OFF で OFF 要求）→ `consent=dev` のまま `test` 無し。
  - 文言定数 `MODE_LABEL_TEST` 等が期待値であること。

### E2E（`e2e/mode_toggle.spec.js`、新規 — viewer 内 module-scoped 関数は behavioral に E2E で pin）

`pairing_to_ride.spec.js` と同方式（`channel:'chrome'`, `?test=1&consent=dev` 起動、webServer は `playwright.config.js` 既定）。

1. `goto('http://127.0.0.1:8000/?test=1&consent=dev')` → `body` が `state-riding` になるのを待つ（テストモードは自動 ride）→ `#mode-toggle` 可視、`#mode-toggle-label` が「テストモード」。
2. `#mode-toggle-btn` を click → reload 完了を待つ → `page.url()` に `test` 引数が無いこと + **`consent=dev` が残っていること（引数保持）** を assert → `#ble-section` が可視（`hidden===false`）かつ `#bridge-scan-section` が hidden（`===true`）であることを assert（= `initBleMode` 到達 = 本番モード）→ `#mode-toggle-label` が「本番モード」。
3. 再度 `#mode-toggle-btn` を click → reload → `page.url()` に `test=1` が戻ること → 再びテストモード（`state-riding` / label「テストモード」）。
4. `page.on('dialog', d => d.accept())` を登録しておく（本番モードが `pairing` 止まりなら confirm は発火しないが、防御的に登録）。

「`#mode-toggle` が DOM に在る」だけの assert は misleading test（NG-R5-14）。必ず **URL の `test` 有無 + `#ble-section`/`#bridge-scan-section` の可視性**という挙動を観測点にすること。

## 真正性確認（必須 — NG-RG-9 戻し漏れガード込み）

切替経路を 1 箇所わざと壊し、どのテストが落ちるかを 1:1 で確認する:

- `buildToggledSearch` の `params.delete('test')` を no-op に壊す → `mode_toggle.test.js` の「`test` OFF 要求で `test` が消える」テストが赤になることを確認。
- `viewer-maplibre.js` の `#mode-toggle-btn` click handler の `location.search` 代入行を消す → E2E の「click 後 URL から `test` が外れる」が赤になることを確認。

確認後、**`git diff` で壊した改変が残っていないこと（残存改変ゼロ）を確認してから commit する**。「確認したら戻す」で済ませず、`git diff` を実際に見ること。

## 制約

- `web/lib/terrain3d.js` / `web/lib/map3d/` は配布元配慮・テスト済 SoT で無改造。
- `bridge.py` は `127.0.0.1` bind 固定、無改造。
- `?bridge=1` の python bridge 経路はスコープ外（切替ボタンは `bridge` 引数を保持するだけで変更しない）。
- 画面確認は `desk_capture` のみ。`chrome --headless` 直叩き / `headless-shot.ps1` は使うな（viewer は never-idle ページで headless Chrome が固まる）。viewer を映した通常 Chrome ウィンドウが無ければ自分で 1 回だけ通常タブで `http://127.0.0.1:8000/?test=1&consent=dev` を開いてから `desk_capture` する。
- ローカル commit まで。`git push` 禁止。

## 参照

- Web Bluetooth API — https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API
- URLSearchParams — https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams
- Location.search — https://developer.mozilla.org/en-US/docs/Web/API/Location/search
- Window.confirm() — https://developer.mozilla.org/en-US/docs/Web/API/Window/confirm
- Playwright — テスト記述 https://playwright.dev/docs/writing-tests / dialog 扱い https://playwright.dev/docs/dialogs

## 完了報告（worker はこの全項目を埋めて報告する）

1. TEST_MODE が本番経路をどう塞いでいたか（正確には「画面内に切替入口が無い」こと、`dispatchAfterIntro` の分岐構造）。
2. 採った切替方式（reload 固定 / ランタイム切替不採用）とその理由。
3. view consent 短絡（`mode:'view'` で `initViewMode` に短絡）をどう塞いだか。
4. 追加 / 変更したファイル一覧。
5. 本番モードに切り替えて `initBleMode`（`#ble-section` 可視 / `#bridge-scan-section` hidden）に到達することの確認結果。
6. 追加した unit test（`mode_toggle.test.js`）と E2E（`mode_toggle.spec.js`）の内容。
7. 真正性確認の結果（どこを壊し、どのテストが赤になったか、`git diff` 残存ゼロ確認）。
8. `npm test` / `npm run test:e2e` / `python -m pytest` の passed / failed 数。
9. desk_capture で実画面を観た批評（切替ボタンが両モードで可視・読めるか、押すとモードが変わるか）。
