# 観るモード遷移後の地図描画失敗 (2026-05-15 12:30 頃 chrome 目視)

## 症状

intro overlay の「コースを観る」ボタン押下 → 観るモード遷移 → status「VIEW MODE: 観るモード (= trainer 不要、 区間勾配を眺める)」表示 → でも地図エリアが灰色のまま描画されない。

DevTools console:
1. `Creating a worker from 'blob:http://127.0.0.1:8765/...' violates the following Content Security Policy directive: "script-src 'self'". Note that 'worker-src' was not explicitly set, so 'script-src' is used as a fallback.` → MapLibre/pmtiles の blob worker が CSP で block されてる
2. `maplibre error: Server returned no content-length header or content-length exceeding request. Check that your storage backend supports HTTP Byte Serving. at FetchSource.<anonymous> (pmtiles.js:1188:17)` → pmtiles の Range request が python http.server で動かない

## fix 方向性 (= 候補)

### CSP worker-src
- 案 A: `worker-src 'self' blob:` を CSP に追加 (= 既存 vendored pmtiles.js が blob worker 必要)
- 案 B: pmtiles を blob worker 使わない build に切り替え (= upstream の non-worker build を vendoring)
- 案 A が現実的、 ただし `blob:` 許可は XSS surface 拡大、 検討必要

### pmtiles HTTP Byte Serving
- 案 A: python http.server を捨てて Range 対応サーバ (= `python -m RangeHTTPServer`、 `npx serve`、 caddy) を使う
- 案 B: GitHub Pages は Range 対応してる、 pages.yml で本番 deploy では OK、 ローカル開発のみ問題
- 案 C: pmtiles を「Range なしで全 file 取得」に倒す (= 4MB の一括 DL、 帯域問題は小)
- 案 D: pmtiles 経由をやめて static PNG タイル ツリーに置き換え (= 大改修)

## 7 軸 audit 観点

1. register: viewer module の CSP / fetch / map source 構築の責務境界
2. 語彙: 「Byte Serving」「pmtiles」「worker-src」等の命名整合
3. 抽象段差: CSP 設定が index.html メタタグ + vendor file の挙動 + viewer の addProtocol の 3 層に分散、 single source ?
4. test: blob worker / Range request の動作を物理 test できるか (= test 環境では発火しないので grep のみが現実か)
5. 設計境界: CSP `worker-src` 緩和の XSS surface、 もしくは pmtiles vendor の差し替えのリスク
6. マイグレ可逆: CSP 緩和 / Range serving 変更を revert できるか、 既存 ε-1〜ε-9 不変条件への影響
7. security: blob: 許可で XSS payload 経由の任意 worker 起動が可能になるか、 mitigation 案

各軸 50-150 字、 BLOCK / LOAD-BEARING / MINOR、 全体 1000 字以内。 BLOCK 以上で fix 方向性 1 案以上。 reviewer A は CSP / セキュリティ重点、 reviewer B は pmtiles serving / インフラ重点。

## 参照 file

- `~/fujihc-trainer/web/index.html` (= CSP meta tag、 line 7 付近)
- `~/fujihc-trainer/web/lib/vendor/pmtiles.js` (= v3.0.6 vendored)
- `~/fujihc-trainer/web/lib/pmtiles_loader.js` (= addProtocol 登録)
- `~/fujihc-trainer/web/viewer-map3d.js` の `buildMapStyle` 周辺 (= map source の pmtiles:// URL)
- `~/.agents/scratch/fujihc-trainer-project/phase-design-2026-05-15.md` (= v3 設計図、 既存ガードレール参照)

report は `~/.agents/scratch/fujihc-trainer-project/audits/map-rendering-review-A-2026-05-15.md` (or B) に Write、 main へは「BLOCK 件数 / LOAD-BEARING 件数 / 推奨 fix 案」を 3 行で返せ。
