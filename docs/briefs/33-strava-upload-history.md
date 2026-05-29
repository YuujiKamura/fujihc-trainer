---
brief: 33-strava-upload-history
title: GitHub Pages 配信 Phase 3: Strava upload + IndexedDB ride 履歴 (= ブラウザ完結)
parent_project: ~/fujihc-trainer/
created: 2026-05-15
depends_on: [31-github-pages-static, 32-web-bluetooth-trainer, 19-viewer-integration-layer]
blocks: []
---

# Brief 33: Strava upload + IndexedDB ride 履歴

## はじめに

GitHub Pages 配信 Phase 1 (= brief 31、 静的化) と Phase 2 (= brief 32、 Web Bluetooth で trainer 直結) で bridge.py 不要の純 browser 動作が成立。 残った穴は ride **データの保存と提出**: 現状 `src/fujihc/gpx_export.py` は CSV を読んで Strava 互換 GPX を吐くが、 bridge.py が CSV を書く前提で browser 完結しない。 本 brief は ride 終了時に (a) GPX を browser download (b) Strava へ OAuth + uploads API で直送 (c) IndexedDB に過去 ride を永続化、 の 3 分岐を browser 内に閉じる。 結果として user は GitHub Pages を開くだけで ride → 提出 → 履歴閲覧の loop が回る。

## 何が今足りないか (= 現状)

- `web/lib/ride_state.js` (= brief 19 で landed) は idx / distance / paused / active の状態だけ持ち、 trkpts (= ride 中の lat/lon/ele/time/power/cad/hr の時系列) を蓄積していない。 advance(dt, speedMps) 呼ばれても通過点は捨てている (L54-61)
- GPX 生成は Python のみ。 `src/fujihc/gpx_export.py` は L24 `csv_to_gpx(csv_path, gpx_path, ...)` で disk I/O 前提、 JS 移植なし
- IndexedDB wrapper / schema なし。 `web/lib/` に DB 系 module 不在
- Strava OAuth client なし。 `localStorage` への token 保存 logic も unauth scope の `fetch` も不在
- Strava uploads endpoint 叩く client なし。 multipart form-data + upload_id status polling の logic 不在
- `web/index.html` の overlay 群 (= setup-overlay / postride-overlay / confirm-overlay / dbinit-overlay) に history-overlay なし。 `setAppState` の state 種 (= checking / dbinit / pairing / riding) に `history` 不在
- OAuth callback page なし (= GitHub Pages の static path 上で `?code=...` を受け取って token 交換する HTML が要る)

## あるべき構造

```
ride 中
  │ advance(dt, speedMps) ごとに ride_state.appendTrkpt({t, lat, lon, ele, power, cad, hr}) を呼ぶ
  ▼
ride 終了 (= setAppState('postride'))
  │
  ├─ postride-overlay の 3 button:
  │   ┌─ [GPX download]    → buildGpxXml(trkpts, summary) → Blob → <a download>
  │   ├─ [Strava upload]   → ensureAccessToken() → postUpload(blob) → pollStatus(upload_id)
  │   └─ [履歴に保存]       → rideDb.add({id, date, summary, trkpts}) → autoPrune()
  │
  └─ [履歴を見る] → setAppState('history') → history-overlay
                                                │
                                                ├─ rideDb.list() で一覧
                                                └─ 各 ride に [GPX] [Strava] [削除] button
```

Strava OAuth (= PKCE flow、 public client、 secret 不要):

```
1. user [Strava 連携] click
2. code_verifier = randomBase64Url(32 bytes)、 code_challenge = sha256(code_verifier) base64url
3. window.location = https://www.strava.com/oauth/authorize
                      ?client_id=<public>&redirect_uri=<github-pages>/oauth-callback.html
                      &response_type=code&scope=activity:write
                      &code_challenge=<...>&code_challenge_method=S256
4. user 認可 → Strava が ?code=... 付きで redirect_uri に戻す
5. oauth-callback.html: POST https://www.strava.com/oauth/token
                         {client_id, code, code_verifier, grant_type=authorization_code}
6. 返ってきた {access_token, refresh_token, expires_at} を localStorage に保存
7. opener window に postMessage で完了通知 → 元 viewer に戻る
```

IndexedDB schema v1 (= db name `fujihc-trainer`、 object store `rides`):

```
rides
  keyPath: "id" (= ISO8601 + random suffix、 ex: "2026-05-15T07:30:00.000Z-a3f")
  indexes: by_date (= "date" 降順)
  record: {
    id: string,
    date: string (= ISO8601),
    summary: {
      distance_m: number,
      duration_s: number,
      elevation_gain_m: number,
      avg_power_w: number | null,
      course_name: string,
    },
    trkpts: Array<{t: string, lat: number, lon: number, ele: number,
                   power: number|null, cad: number|null, hr: number|null}>
  }
```

## Strava ToS の本人データ取扱 (= Rule 11 C2 適合性)

Strava API Agreement の制約は本ファイル冒頭の Rule 11 で class C2 として明示 (= 本人が OAuth で取得した自分のデータはローカル DB 保存 + 本人 UI 表示まで許可、 第三者再配布禁止)。 本 brief の動作は全て C2 範囲内:

- **upload** は `POST /api/v3/uploads` (= Strava への送信)、 user 自身の activity を user 自身の Strava アカウントに登録する write 動作。 redistribution ではなく user 起点の self-publish、 Strava 側の保存先は user 自身のアカウント。 §5.1 が本人 OAuth で許可している範囲
- **IndexedDB の trkpts 保存先**は user の browser local 内のみ。 cross-device sync / server upload なし (= brief やらないこと §2 で明示)
- **history-overlay の表示**は本人 UI の中での本人 ride 一覧、 §2.10 の publicly viewable 制約から外 (= 公開していない、 本人にしか見えない)
- **公開 redistribution は一切しない**: GitHub Pages から fetch される public asset は course.json + 静的 tile のみで、 ride trkpts はそこに含めない、 git push もしない (= Rule 9 物理層 deny の対象外、 そもそも repo に置かない)

これにより本 brief は Strava API Agreement §2.9 / §2.10 / §2.14 / §2.15 (= 第三者への disclose / redistribute / sublicense 禁止) に抵触せず、 §5.1 の「自分のデータを本人 UI で扱う」例外内に収まる。 過去 NG-R1-15/16 (= 第三者 ToS 違反) と同型再演しない。

### token 漏洩境界 (= localStorage + XSS の attack surface)

`access_token` / `refresh_token` を `localStorage` に置く設計は **XSS で任意 script に読み取られる** という前提で gate を 3 重に張る。 token = `activity:write` scope、 漏洩すると **本人の Strava アカウントに第三者が自由に upload できる** (= user 自身への harm + Strava 側 ecosystem 汚染)、 Rule 5 「失敗したら誰が払うか」観点でも user 偏荷。

物理層 gate:

1. **CSP 必須**: `web/index.html` + `web/oauth-callback.html` の両方に `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' https://www.strava.com https://*.strava.com; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.strava.com; object-src 'none'; base-uri 'self'">` を埋める。 third-party script の inject を物理 block (= XSS 経由の token exfiltration の前提を崩す)
2. **third-party script 禁止**: GitHub Pages 配信物に外部 CDN / analytics / font CDN を一切含めない。 既存 `web/lib/` 群はすべて same-origin、 MapLibre 等の library も `web/vendor/` に self-host 済 (= brief 31 で確定)。 本 brief で新規追加する asset も same-origin 強制
3. **CSP grep gate**: 完了条件 §11 に「`web/index.html` / `web/oauth-callback.html` 両方に `Content-Security-Policy` meta が存在」+「`<script src="https://...">` または `<link href="https://...">` の外部参照ゼロ」を追加

連携解除 / token revoke flow:

- `web/index.html` の setup-overlay (= 既存) に「Strava 連携を解除」 button (`#btnStravaDisconnect`) を追加、 click で:
  1. `localStorage.removeItem(STRAVA_TOKEN_LS_KEY)` (= ローカル token 即削除)
  2. user に Strava 側の app revoke 案内表示 (= `https://www.strava.com/settings/apps` への外部リンク + 「ローカル削除のみでは Strava 側 app は登録残ったまま、 完全に絶つには Strava 側で revoke してください」と明文)
- `strava_oauth.js` に `revokeLocalToken()` 関数を export、 `web/tests/strava_oauth.test.js` に「revokeLocalToken 後 ensureAccessToken が null を返す」test 1 件追加

token 暴露時の影響範囲:

- access_token 漏洩 → 6 時間以内に **本人の Strava アカウントに任意 activity を upload 可能** (scope=activity:write の権能)、 read は不可 (= 本 brief で `read` scope 取らない)
- refresh_token 漏洩 → user が Strava 側で revoke するまで永続的に access_token を再発行可能、 連携解除手順を README + UI で明示
- mitigation: PKCE は authorization code 段階の MITM 防御であって localStorage XSS 防御ではない、 CSP + same-origin + 第三者 script ゼロが攻撃面遮断の本筋

なぜ localStorage に置くか:

- `httpOnly` cookie + サーバサイド proxy が理想だが、 本 brief は GitHub Pages 完結 (= サーバ無し) を制約として持つ、 backend 立てると brief 31/32 の static 配信原則が崩れる
- `sessionStorage` だと tab 閉じる度に再認可、 6 時間 access_token と 永続 refresh_token の旨味が消える
- `IndexedDB` 上 token 保存も XSS に対する防御強度は localStorage と同じ (= 同 origin 内 script から読める)、 storage の選択ではなく **CSP + 第三者 script ゼロ + 連携解除 UI** で対処する判断

過去 incident と関連:

- Rule 11 C2 範囲内 (= 本人データ本人扱い) は崩していない、 ただし token 漏洩は user 自身の Strava アカウントが攻撃面になるため Rule 3 (per-action 認可) と Rule 9 (物理層 gate) の境界に乗る class。 「localStorage に置けば user 責任」で逃げず、 CSP を物理層 gate として brief 完了条件に含める

## 実装設計

### A. `web/lib/gpx_builder.js` (= 新規、 pure function module)

既存 `src/fujihc/gpx_export.py` L40-91 の XML 構造を JS 移植。 入力は `trkpts` 配列 + summary、 出力は GPX 1.1 文字列 (= xmlns / TrackPointExtension / PowerExtension / Strava 独自 `<power>` 併記の構造を Python 版と同一に保つ)。

```js
/**
 * trkpts と summary から Strava 互換 GPX 1.1 XML 文字列を作る.
 * pure function、 DOM / browser global 依存ゼロ.
 *
 * @param {Array<TrkPt>} trkpts
 * @param {{name?: string, activity_type?: string}} opts
 * @returns {string} GPX XML
 */
export function buildGpxXml(trkpts, opts = {}) { /* ... */ }

/** XML attr escape (= gpx_export.py L17-22 と同一仕様) */
export function escXml(s) { /* ... */ }
```

- 名前空間 / `<trk>` / `<trkseg>` / `<trkpt lat lon>` / `<ele>` / `<time>` / `<extensions>` の出力順は gpx_export.py L40-89 と完全一致
- `gpxpx:PowerInWatts` + 独自 `<power>` の併記 (= L82-85 のコメント根拠、 Strava power グラフが NaN にならない実測対応) を JS 側でも維持
- activity_type default は `"Virtual Ride"` (= gpx_export.py L28 と同値、 Virtual Trainer Activities マッチ用)

### B. `web/lib/ride_db.js` (= 新規、 IndexedDB wrapper)

IndexedDB の low-level API (= openRequest / transaction / objectStore.put) を Promise wrapper にして CRUD + auto-prune を提供。 schema version は const `RIDE_DB_VERSION = 1`、 store 名 / index 名は module top で named export (= magic 化禁止、 NG-R3-3 同型予防)。

```js
export const RIDE_DB_NAME = 'fujihc-trainer';
export const RIDE_DB_VERSION = 1;
export const RIDE_STORE = 'rides';
export const RIDE_INDEX_DATE = 'by_date';
export const RIDE_DB_AUTO_PRUNE_BYTES = 500 * 1024 * 1024;  // 500MB threshold
export const RIDE_DB_KEEP_MIN = 20;  // 容量超でも最低 20 件は残す

/** open / 自動 migrate */
export async function openRideDb() { /* ... */ }

/** ride 追加 + auto-prune (= 容量超過時 LRU で削除) */
export async function addRide(db, rec) { /* ... */ }

/** 一覧 (= by_date 降順) */
export async function listRides(db) { /* ... */ }
export async function getRide(db, id) { /* ... */ }
export async function deleteRide(db, id) { /* ... */ }

/** 容量推定 (= navigator.storage.estimate ベース、 fallback で trkpts JSON 長 sum) */
export async function estimateRideDbBytes(db) { /* ... */ }
```

- auto-prune は `addRide` 内で `estimateRideDbBytes` > `RIDE_DB_AUTO_PRUNE_BYTES` なら `by_date` 昇順 (= 古い順) に削除、 ただし残数が `RIDE_DB_KEEP_MIN` を割らない
- migration: version=1 でゼロから作る場合のみ、 store + index を新規作成。 version 2 以降の migration は本 brief 範囲外、 ただし `onupgradeneeded` 内で `oldVersion` switch にしておき将来追加可能な構造を残す

### C. `web/lib/strava_oauth.js` (= 新規、 PKCE flow)

```js
export const STRAVA_AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize';
export const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
export const STRAVA_SCOPE = 'activity:write';
export const STRAVA_TOKEN_LS_KEY = 'fujihc.strava.token';

/** code_verifier 生成 (= 32 bytes random → base64url、 RFC 7636 §4.1) */
export function makeCodeVerifier() { /* ... */ }

/** code_challenge = SHA256(verifier) base64url (= RFC 7636 §4.2) */
export async function makeCodeChallenge(verifier) { /* ... */ }

/** authorize URL 構築 → window.location 遷移用 */
export function buildAuthorizeUrl({clientId, redirectUri, codeChallenge}) { /* ... */ }

/** authorization_code → token 交換 (= callback page 側で呼ぶ) */
export async function exchangeCodeForToken({clientId, code, codeVerifier}) { /* ... */ }

/** refresh_token → access_token 更新 */
export async function refreshAccessToken({clientId, refreshToken}) { /* ... */ }

/** 現在 token を読み、 expired なら refresh、 valid な access_token を返す.
 *  return null = 未連携、 user に再認可導線を出すべき */
export async function ensureAccessToken(clientId) { /* ... */ }
```

- token の localStorage 保存形式: `{access_token, refresh_token, expires_at, athlete_id}` JSON 化
- expires_at は epoch sec、 `ensureAccessToken` は `expires_at - now < 300` (= 5 分マージン) で refresh 発火
- client_id は GitHub Pages で hard-code 可 (= 公開情報、 Strava の各 app は client_id を redirect_uri と pair で識別、 secret は本 flow で不要)
- redirect_uri は `web/index.html` と同 origin の `oauth-callback.html` (= 詳細は G 節)

### D. `web/lib/strava_upload.js` (= 新規、 uploads API client)

```js
export const STRAVA_UPLOADS_URL = 'https://www.strava.com/api/v3/uploads';
export const STRAVA_UPLOAD_POLL_INTERVAL_MS = 2000;
export const STRAVA_UPLOAD_POLL_TIMEOUT_MS = 60_000;

/** GPX 文字列 + access_token で upload を発火、 upload_id を返す.
 *  multipart/form-data with file (= GPX Blob)、 data_type=gpx、 activity_type=VirtualRide */
export async function postUpload({accessToken, gpxXml, name, activityType}) { /* ... */ }

/** upload status を poll (= GET /uploads/{id})、
 *  status が "Your activity is ready." or error になるまで待つ.
 *  return: {status: 'ready'|'error', activity_id?: number, error?: string} */
export async function pollUploadStatus({accessToken, uploadId, signal}) { /* ... */ }
```

- multipart は `FormData` に `file: new Blob([gpxXml], {type: 'application/gpx+xml'})` + `data_type: 'gpx'` + `name` + `activity_type: 'VirtualRide'` を append、 `fetch(STRAVA_UPLOADS_URL, {method: 'POST', headers: {Authorization: 'Bearer ' + token}, body: form})`
- poll は `STRAVA_UPLOAD_POLL_INTERVAL_MS` 間隔で最大 `STRAVA_UPLOAD_POLL_TIMEOUT_MS` まで、 `error` field が空でなければ即終了 (= Strava の API 仕様、 公式 docs §Uploads)
- rate limit (= 100 req / 15min) は個人 use なら触れない、 ただし poll 中の連続 GET も同 quota 消費するので interval 2 秒は余裕側

### E. `web/lib/ride_state.js` 拡張 (= trkpts 蓄積)

既存 module に副作用を追加。 既存 `advance(dt, speedMps)` の signature は不変、 内部で trkpts に追加。

- `start()` 内で `this._trkpts = []` を初期化
- `advance(dt, speedMps)` の末尾 (L60-61 直後) で、 現在 idx / curDist から `course[curIdx]` の lat/lon/ele を読み、 さらに引数として `extras = {power, cad, hr}` を受け取れる overload (= advance(dt, speedMps, extras = {})) を追加
- `appendTrkpt(extras)` を別途 export しても良い (= 引数追加で既存 caller を壊すリスクが大きければ split)
- snapshot() に `trkptCount: this._trkpts.length` を追加
- 新規 `getTrkpts()` export (= 終了時に GPX builder / DB 保存に渡す)
- 既存 `reset()` で trkpts もクリア

scope 細部 (= 既存 viewer 呼び出し L? との衝突回避) は impl team 判断、 ただし signature 変更時は既存 vitest 26 件 (= brief 19 で landed) を全 green 維持。

### F. post-ride overlay の button bind

`web/index.html` の `postride-overlay` (= 既存) に 4 button 追加 (= 既存に [新しい ride] 等あれば横並び):

- `#btnGpxDownload` → `buildGpxXml(rideState.getTrkpts(), {...summary})` → Blob → `URL.createObjectURL` → `<a download="ride-<date>.gpx">` 自動 click
- `#btnStravaUpload` → `ensureAccessToken()` が null なら OAuth 認可 popup、 token 取得後 `postUpload + pollUploadStatus`、 進捗 + 完了 ID を表示
- `#btnSaveHistory` → `addRide(db, {id, date, summary, trkpts})` → snackbar 通知
- `#btnViewHistory` → `setAppState('history')`

button イベント結線は viewer-map3d.js の `bindPostRideButtons()` 関数 1 個に閉じ込め、 NG-R1-7 (= 1 関数 multi-層) 同型予防。

### G. `web/oauth-callback.html` 新規 (= 単独ページ)

GitHub Pages 上の `/oauth-callback.html` (= 同 origin、 同 client_id 登録) を redirect_uri にする。 内容は最小:

```html
<!doctype html>
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' https://www.strava.com https://*.strava.com; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'self'">
<title>fujihc-trainer Strava OAuth</title>
<script type="module" src="./lib/oauth_callback_main.js"></script>
```

`web/lib/oauth_callback_main.js` (= 同 file 新規、 inline script を externalize、 CSP `script-src 'self'` を維持):

```js
import { exchangeCodeForToken, STRAVA_TOKEN_LS_KEY } from './strava_oauth.js';
const params = new URLSearchParams(location.search);
const code = params.get('code');
const verifier = sessionStorage.getItem('fujihc.pkce.verifier');
const clientId = sessionStorage.getItem('fujihc.pkce.client_id');
if (code && verifier && clientId) {
  const token = await exchangeCodeForToken({clientId, code, codeVerifier: verifier});
  localStorage.setItem(STRAVA_TOKEN_LS_KEY, JSON.stringify(token));
  sessionStorage.removeItem('fujihc.pkce.verifier');
  if (window.opener) { window.opener.postMessage({type: 'strava-oauth-done'}, location.origin); window.close(); }
  else { location.replace('./'); }
}
```

- 認可 popup 方式 (= `window.open` で別 tab) と 同タブ redirect 方式の両対応 (= opener あれば close、 なければ root に戻る)
- code_verifier は authorize URL 遷移直前に `sessionStorage` に格納 (= localStorage は使わない、 PKCE の verifier は session 限定、 RFC 7636 推奨)
- inline script を `web/lib/oauth_callback_main.js` に externalize した理由は CSP `script-src 'self'` を守るため (= `unsafe-inline` 不要)、 token 取扱コードに対する XSS 攻撃面遮断の柱

### H. history-overlay 新規 + state 拡張

- `web/index.html` に `<div id="history-overlay">` 追加、 内部に ride 一覧 `<ul id="history-list">` + 各 ride に [GPX] [Strava] [削除] button
- `setAppState` の state 種に `'history'` 追加、 CSS で `body.state-history #history-overlay { display: flex }`
- `#btnViewHistory` を postride-overlay + setup-overlay の両方に置く (= ride 前 / 後どちらからも開ける)
- history-overlay の閉じる button → 直前 state (= postride / pairing) に戻す

## test 戦略

frontend (vitest、 既存 `web/tests/` に追加):

1. `web/tests/gpx_builder.test.js` 7-9 件
   - 空 trkpts → `<trkseg>` 空の有効 GPX
   - 1 件 trkpt happy → lat/lon/ele/time 全部出力、 namespace 揃う
   - power + cad + hr 全部 → gpxtpx + gpxpx + 独自 `<power>` 3 系統並ぶ
   - power のみ / cad のみ / 全 null の境界
   - `escXml` happy (= `<`, `>`, `&`, `"` 全 escape)
   - activity_type default = `"Virtual Ride"` (= Python 版同値)
   - Python 版 (= `src/fujihc/gpx_export.py`) の出力 fixture と byte-level 一致 1 件 (= 同じ trkpts を両側で生成、 diff ゼロ確認)

2. `web/tests/ride_db.test.js` 6-8 件 (= `fake-indexeddb` で in-memory IDB)
   - openRideDb 初回で store + index 作成
   - addRide → listRides で 1 件取得、 by_date 降順
   - getRide / deleteRide 往復
   - addRide 連続 25 件 + 容量超で auto-prune 発火、 `RIDE_DB_KEEP_MIN`=20 を割らない
   - 容量未超では prune 発火しない (= idempotent)
   - migration: version=1 から開いて store 構造が schema 通り (= keyPath / index 名)

3. `web/tests/strava_oauth.test.js` 6-8 件
   - makeCodeVerifier 長さ + charset (= base64url、 RFC 7636 §4.1 の 43-128 文字)
   - makeCodeChallenge happy (= 既知 verifier に対して S256 既知出力、 RFC 7636 Appendix B fixture)
   - buildAuthorizeUrl query 完全一致 (= client_id / redirect_uri / scope / code_challenge / response_type)
   - exchangeCodeForToken happy (= fetch mock で 200、 localStorage 書き込まない pure 関数として export)
   - refreshAccessToken happy / refresh_token 無効時の reject
   - ensureAccessToken: token 不在 → null / valid → そのまま / expired → refresh 経由
   - revokeLocalToken 後 ensureAccessToken が null を返す (= 連携解除導線 unit test)

4. `web/tests/strava_upload.test.js` 4-5 件 (= 全 fetch mock)
   - postUpload happy → upload_id 返る、 FormData に file/data_type/name/activity_type 入る
   - pollUploadStatus happy → status='Your activity is ready.' で activity_id 返る
   - pollUploadStatus error → status.error 非空で reject
   - pollUploadStatus タイムアウト → `STRAVA_UPLOAD_POLL_TIMEOUT_MS` 超で reject
   - Authorization header に `Bearer <token>` 入る

5. `web/tests/ride_state_trkpts.test.js` 3-4 件 (= 既存 ride_state.test.js と独立 file、 拡張部のみ)
   - start() で _trkpts 初期化
   - advance(dt, speed, {power, cad, hr}) で trkpt 1 件 push
   - reset() で trkpts もクリア
   - getTrkpts() は immutable copy 返す

6. `web/tests/postride_buttons.test.js` 2-3 件 (= jsdom)
   - bindPostRideButtons が #btnGpxDownload / #btnStravaUpload / #btnSaveHistory / #btnViewHistory の 4 click を bind
   - GPX download click で `<a download>` の click が 1 回発火 (= jsdom 上で Blob URL を spy)

合計 約 27-36 件。 既存 vitest 192 件 + 本 brief 約 30 件 = 約 222 件想定。

backend (pytest): 本 brief は browser 完結なので pytest 追加ゼロ。 既存 `src/fujihc/gpx_export.py` の Python 版は維持 (= ローカル ride 環境で bridge.py 経由 CSV→GPX フローが残る、 §やらないこと §5 参照)、 regression なし。

## やらないこと

1. 他サービス連携 (= Ride with GPS / Komoot / TrainingPeaks)、 別 brief
2. Strava からの read API (= segment / leaderboard / activity 一覧)、 別 brief、 scope=`read` が要るので OAuth flow が別件
3. cloud sync (= IndexedDB を cross-device で同期、 server backend が必要、 GitHub Pages 完結原則から外れる)
4. GPX 以外の format (= TCX / FIT、 Strava は受けるが本 brief では GPX 1.1 のみ)
5. `src/fujihc/gpx_export.py` (= Python 版) の廃止。 bridge.py 経由 ride では引き続き使う、 browser ride の追加 path として js 版が並走
6. Strava 以外の OAuth provider (= Google Fitness / Garmin Connect 等)、 別 brief
7. private rides の visibility 細制御 (= upload 時の `private` flag、 Strava 側 default で OK、 user 制御は別 brief)
8. ride の **編集** (= IndexedDB 内の trkpts を後から書き換える UI)、 別 brief、 immutability 前提で進める
9. Web Worker / OPFS への移行 (= IndexedDB で十分、 後追い最適化は別 brief)
10. multi-user (= 同 browser で複数 Strava アカウント切替、 別 brief)

## 数値見積もり

- 1 trkpt = JSON でおよそ 130 bytes (= `{t, lat, lon, ele, power, cad, hr}` の数値桁 + key)
- 90 分 ride で 1Hz サンプル = 5400 trkpts × 130 = **約 700 KB / ride**
- 100 ride 履歴 = 100 × 700 KB = **約 70 MB**、 IndexedDB の数 GB 制限から余裕
- auto-prune threshold (= 500 MB) ÷ 700 KB ≒ **約 700 ride 相当**、 user の 1 日 1 ride 想定で 2 年弱保持
- GPX XML サイズ = 1 trkpt 約 250 bytes (= XML タグ overhead) × 5400 = **約 1.35 MB / ride**、 Strava uploads は 25 MB 制限なので余裕
- OAuth flow latency: authorize redirect (= 数百 ms) + token 交換 fetch (= 数百 ms) = **合計 1-2 秒**
- upload latency: POST /uploads (= 数百 ms) + poll 1-3 回 × 2 秒 interval = **合計 3-7 秒** (Strava 経験上、 processed まで平均 4 秒)
- access_token 有効期間: 6 時間 (= Strava docs)、 refresh_token 失効なし (= user revoke まで)

## ハマる罠

- **PKCE code_verifier**: base64url charset (= `A-Za-z0-9-_`、 padding なし)、 長さ 43-128 文字 (RFC 7636 §4.1)、 32 bytes random → 43 文字 base64url が標準。 ランダム源は `crypto.getRandomValues`、 `Math.random` は不可
- **Strava API rate limit**: 100 req / 15min + 1000 req / day per app、 個人 use なら触れないが poll が暴走すると一発で 100/15min を食う、 interval ≥ 2 秒 + timeout 60 秒で固める
- **IndexedDB schema migration**: version=2 で何か追加する将来があれば `onupgradeneeded` の `oldVersion` switch で対応、 本 brief は v1 fresh-create のみ、 ただし version 数を `RIDE_DB_VERSION` const 経由にして magic 化禁止
- **OAuth redirect_uri の確定**: GitHub Pages の URL は `https://<user>.github.io/fujihc-trainer/oauth-callback.html` 形式 (= user / organization で URL 構造が違う、 brief 31 で確定した base URL に合わせる)、 Strava app 側の登録と完全一致が必要 (= 末尾 `/` 含めて文字列一致)
- **access_token 自動 refresh**: `ensureAccessToken` を upload 直前に毎回呼ぶ、 expires_at - now < 5 分で refresh。 refresh も失敗するなら token 全削除 → 再認可導線
- **upload は async**: POST /uploads は 200 を即返すが activity の processed は数秒後、 poll で `status: "Your activity is ready."` を待つ。 `error` field が非空 (= "There was an error processing your activity." 等) なら即終了
- **private rides の visibility**: Strava 側 default で activity は `visibility=everyone`、 user が private にしたければ Strava UI 側で切り替え。 本 brief では visibility パラメータを送らない (= Strava 側 default 尊重、 過剰制御回避)
- **HTTPS 必須**: Strava OAuth + Web Crypto (= sha256 for code_challenge) は HTTPS context 必須。 GitHub Pages は HTTPS 自動、 localhost 開発時は `127.0.0.1` で secure context 扱い (= Chrome / Firefox 共通)、 LAN IP 直接は要 self-signed cert
- **NG-R1-3 再演予防**: 「ride 履歴」「ride DB」「rides store」「history」「rideDb」 が混在しやすい。 用語統一: **データ単位 = "ride"**、 **保存先 = `rideDb` (= IndexedDB wrapper)**、 **UI 名 = "履歴"**、 **state 名 = `history`**、 **store 名 = `rides`** で固定、 他 qualifier 禁止
- **NG-R1-7 再演予防**: GPX 生成 / IDB CRUD / OAuth / upload を 1 file に詰め込まない、 4 module 分離 (= A/B/C/D) を厳守、 viewer-map3d.js に inline で書かない
- **NG-R1-8 再演予防**: 「実走で確認」「OAuth は手動で叩いた」は test 規律違反、 fetch mock + fake-indexeddb で全部 unit test 化
- **NG-R1-12 再演予防**: Strava API endpoint 文字列が複数 file に散在しないこと、 `STRAVA_*_URL` const を 1 file (= strava_oauth.js / strava_upload.js) でのみ宣言、 viewer / postride bind 側からは import のみ
- **NG-R3-3 再演予防**: `RIDE_DB_VERSION` / `RIDE_STORE` / `STRAVA_SCOPE` / poll interval などの load-bearing 数字 / 文字列をローカル再定義禁止、 module top 1 箇所のみ宣言
- **client_id の repo commit**: client_id は公開情報、 secret ではない (= PKCE 採用の根拠)、 ただし repo に貼る時は `web/config.js` 等で `STRAVA_CLIENT_ID` を 1 箇所に集約、 user 各自が自分の Strava app を作って差し替える運用 (= README 記述)。 fujihc-trainer 本体 repo に上流の固定 client_id を埋め込むと user 間で activity が混線する可能性、 各自 app 作成が安全側
- **localStorage XSS 攻撃面**: access_token / refresh_token を localStorage に置くと同 origin 内の任意 script から読める。 攻撃面遮断は (a) CSP `default-src 'self'` + `connect-src` を strava.com に絞る (b) third-party CDN / analytics / font CDN を一切使わない (c) `web/lib/*` の `eval` / `Function(...)` / `innerHTML` で untrusted 文字列を扱わない の 3 重 gate。 PKCE は authorization code の MITM 防御で localStorage XSS 防御ではない、 混同するな
- **token 漏洩時の影響範囲**: access_token (6h 有効) は activity:write 単体スコープ、 read 不可。 refresh_token は user revoke まで永続、 漏洩したら Strava 側で revoke しないと止まらない。 連携解除 UI (`#btnStravaDisconnect`) で localStorage は消えるが Strava 側 app 登録は残る、 README + UI で完全 revoke 手順を明示
- **CSP の `unsafe-inline` 誘惑**: 既存 inline `<style>` / `<script>` があると CSP が `unsafe-inline` 必要、 これを許すと XSS 防御強度が大幅低下。 inline script は本 brief で oauth-callback.html の 1 箇所のみ、 これを external `web/lib/oauth_callback_main.js` に分離して `script-src 'self'` を維持できるなら維持する。 style は `'unsafe-inline'` 残しを許容 (= 既存 overlay 群が inline style 多用、 全外出しは別 brief)、 ただし `script-src` だけは `'self'` 厳守

## 完了条件

1. `web/lib/gpx_builder.js` 新規 (+80 行)、 `buildGpxXml` + `escXml` の 2 関数 export
2. `web/lib/ride_db.js` 新規 (+150 行)、 6 関数 + 5 const export、 schema v1 + auto-prune logic
3. `web/lib/strava_oauth.js` 新規 (+130 行)、 7 関数 + 4 const export、 PKCE flow + token 管理
4. `web/lib/strava_upload.js` 新規 (+80 行)、 2 関数 + 3 const export、 POST + poll
5. `web/lib/ride_state.js` 拡張 (+30 行)、 trkpts 蓄積 + `getTrkpts` 追加、 既存 26 件 test 全 green 維持
6. `web/oauth-callback.html` 新規 (+15 行、 CSP meta + 外部 module 参照のみ、 inline script ゼロ) + `web/lib/oauth_callback_main.js` 新規 (+20 行、 token 交換 logic) の 2 file 構成 (= CSP `script-src 'self'` 維持)
7. `web/index.html` に `<div id="history-overlay">` 追加 (+40 行)、 postride-overlay に 4 button 追加 (+15 行)
8. `web/viewer-map3d.js` に `bindPostRideButtons` + `setAppState('history')` 拡張 (+60 行)、 既存 `setAppState` API は不変
9. vitest 約 27-36 件 全 green (= 既存 192 件 + 新規 約 30 件)
10. `pytest` regression なし (= 既存 149 件維持、 本 brief は backend 触らず)
11. 物理 grep gate:
    - `STRAVA_*_URL` const が `web/lib/strava_*.js` の 2 file でのみ宣言 (= 散在ゼロ)
    - `web/viewer-map3d.js` に `strava.com` 直リテラル ゼロ
    - `RIDE_DB_VERSION` ローカル再定義ゼロ (= NG-R3-3 同型予防)
    - `web/lib/gpx_builder.js` と `src/fujihc/gpx_export.py` の出力 byte 一致 fixture 1 件
    - `web/index.html` + `web/oauth-callback.html` 両方に `<meta http-equiv="Content-Security-Policy"` が存在 (= XSS 経由 token exfiltration 物理 gate)
    - `web/index.html` / `web/oauth-callback.html` / `web/lib/*.js` 全体で `<script src="https://` および `<link[^>]*href="https://` の外部参照ゼロ (= same-origin 強制)
    - `#btnStravaDisconnect` element が setup-overlay 内に存在 (= 連携解除導線必須)
12. Strava ToS 適合性記述 (= 本 brief §「Strava ToS の本人データ取扱」+ §「token 漏洩境界」) を impl PR description に転記
13. README に Strava 連携解除手順を追記 (= localStorage 削除 + Strava 側 app revoke ページへのリンク + 「ローカル削除だけでは Strava 側 app 登録が残る」の明文)
14. ローカル commit のみ、 push しない (= Rule 3 per-action 認可待ち、 Rule 9 物理 hook 経由)

## まとめ

ship される: ride 終了時に browser だけで GPX download / Strava 直送 / IndexedDB 履歴保存の 3 分岐、 過去 ride 一覧 UI、 PKCE OAuth flow、 auto-prune 容量管理、 Strava ToS C2 範囲内の本人データ取扱。 bridge.py 不要、 GitHub Pages 配信で完結。
ship されない: 他サービス連携、 Strava read API、 cloud sync、 GPX 以外 format、 Python 版 gpx_export 廃止、 ride 編集 UI、 multi-user、 Web Worker / OPFS 移行。

## 次の atom

- brief 34 候補: Strava read API (= scope=read で activity 一覧取得、 本 brief の upload 後にそのまま履歴と突き合わせる)
- brief 35 候補: cloud sync (= GitHub Pages 外の minimum server で IndexedDB の cross-device 同期、 Rule 10/11 gate を class C2 で再確認、 self-host 前提)
- brief 36 候補: ride history の analytics overlay (= PMC / CTL / ATL 計算、 strava-pmc-viewer と同型 logic を IndexedDB データで)
- brief 37 候補: Web Worker / OPFS 化 (= trkpts が増えた時の main thread 圧迫回避)
