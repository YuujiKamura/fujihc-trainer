---
session_handoff
date: 2026-05-15 evening (= /compact 直前)
status: brief 26b〜33 全 landed、 GitHub Pages 公開 Phase 1/2/3 全部 impl 完了、 npm 389 + pytest 171 全 green
---

# fujihc-trainer 2026-05-15 evening session end handoff

## 何を達成したか (= session 中 landed した brief / fix)

### 朝の部 (= MAP_MODE / hillshade / minimap / 光源 / rider HUD 系)
| commit | 内容 |
|---|---|
| 5f129e3 | OSM タイル配信の gzip Content-Encoding + OSM zoom 拡張 [13,14,15] |
| 9c15996 | bridge HTTP server に静的 file serve route 追加 |
| 05f7655 | viewer MAP_MODE (?map=1) + OSM 描画 fix (camera hard-set guard / line-width / layer 順) |
| ce10cb3 | minimap MapLibre 2nd instance (brief 28) + polygon miter join + attribution 隠蔽 |
| d25649a | brief 29 minimap 旧 OSM 直叩き方式に rollback |
| 953be56 | 地形 hillshade + 遠景 dem 描画 + polygon 隙間解消 |
| c21994b | brief 30 minimap タイル DB cache |
| 3722354 | rider 豆腐 1m + 追随 HUD (= slope/speed/power/cad/hr) |
| 5513379 | ride 中 start/goal pin hide |
| 0e7ea72 | HUD 大きく + zoom/pitch default 確定 |
| 0cfc957 | MAP_MODE 描画完了待機 + ローディング + hillshade 濃度 up |
| df8da09 | tick jumpTo を ride active 時のみ |
| 60922ec | MAP_MODE ローディング 6 秒 timeout fallback |
| 4f8179f | hillshade に光源方向 (= 南東 135°) |
| a94a523 | 光源 slider 2 本 (方向/強度) + デバッグ表示 + sky グラデ |
| 719c1c7 | course.json untrack (= 公式 GPX 著作権配慮) |
| a1b1e08 | GPX 著作権文言を緩める |
| 13dabe3 | course.json を track に戻す (= GPX 変換派生物として同梱) |

### 夕方の部 (= GitHub Pages 公開 3 phase)
| commit | 内容 |
|---|---|
| **793de49** | **brief 31 GitHub Pages 静的サイト化 (Phase 1)** |
| **e1e9ef1** | **brief 32 Web Bluetooth で FTMS trainer 直接接続 (Phase 2)** |
| **e8a94ff** | **brief 33 Strava upload + IndexedDB ride 履歴 (Phase 3)** |
| **9a86778** | brief 33 audit Round 1 fix (= viewer tick で rideState.appendTrkpt 1Hz 呼出、 trkpts 蓄積 wiring 修正) |

### 数字
- npm test: 起点 168 → **389 全 green** (= +221 件、 27 file)
- pytest: 起点 125 → **171 全 green** (= +46 件、 / 4 skipped 維持)
- commit 数: 22 個
- viewer-maplibre.js: 759 → **約 1700 行** (= 約 1000 行追加)
- 新規 web/lib/: 14 file (= ws_client, ride_state, camera_controller, ftms_parse, ble_client, road_polygon, route_styling, terrain_mesh, gpx_smooth, gpx_builder, ride_db, strava_oauth, strava_upload, postride_buttons, oauth_callback_main, pmtiles_loader)
- web/vendor/: pmtiles.js v3.0.6 (= BSD-3-Clause) + MapLibre CSS / JS (= MIT) 同梱
- 新規 brief: 28 / 29 / 30 / 31 / 32 / 33 (= 全部 redraft + audit + impl 完了)
- web/static/: 182 file / 21 MB (= GSI dem PNG 179 + map.pmtiles + course.json)

## 走行中 / 結果待ち

### brief 33 7軸 audit Round 1 (= sub-agent adfa9b5dbbb8d9c06)
- 完了通知済、 LOAD-BEARING 1 件 (= trkpt wiring) を直前 commit `9a86778` で fix
- 残 MINOR 4 件 (= ship blocker 外):
  1. postride_buttons.js:124 の summary id 体系を 1 箇所集約 (= 弱版 NG-R1-12)
  2. oauth_callback_main.js / viewer の postMessage origin check pair は強み (= 維持)
  3. CSP `img-src` の Strava 許可は将来用 buffer
  4. README に Strava 連携解除手順 landed (= +30 行)

### brief 33 audit Round 2 (= trkpt fix の audit、 dispatch してない)
- 直前 fix が 1 LOAD-BEARING を解消、 Round 2 audit すれば CONVERGED 確認できる
- 次 session で dispatch するか、 visual 検証で済ますか判断

## 残作業 (= 次 session、 自然な atom 順)

### 1. visual 検証 (= GitHub Pages local simulate or actual deploy)
- `python -m fujihc.bridge --dummy` で bridge mode 動作確認
- `python -m http.server -d web/ 8000` + browser で **static mode 動作確認**
  - 起動時 `/tiles/_setup_status` 500ms timeout → bridgeReachable=false に自動切替
  - PMTiles 経由で OSM、 GSI dem 静的 PNG で terrain、 minimap も静的
- `?map=1` で UI 操作なしの自動 ride で trkpt 蓄積 → postride で GPX download 確認
- Strava upload は実 Strava app + client_id 設定 (= localStorage に user 自身が登録) が必要、 user 判断で skip 可

### 2. brief 32 残 MINOR fix (= phase 2 候補、 4 件)
- ble_client.js:150-152 のコメント誤読修正 (= 「response=true 失敗で retry」を「2 opcode 順次 + transport fallback」に書き換え)
- HTTPS 警告未実装 (= viewer 起動 1 行目で `location.protocol !== 'https:' && hostname !== 'localhost'` の warn 追加、 1 行で fix)
- 自動再接続 UI 文言 (= phase 2 で明示済、 後回し OK)
- GATT 接続 retry 指数 backoff (= brief 34 候補)

### 3. brief 33 残課題 (= phase 2 候補)
- auto-prune 大規模ケース test (= 500MB 超の実 prune test)
- elevation_gain_m 計算 (= 別 brief 範囲、 summary に 0 を入れる現状)
- 自分の Strava client_id を user 自身が localStorage に設定する UI (= 設定 panel)

### 4. GitHub Pages 実 deploy (= user 認可必須、 push 前)
- Phase 1/2/3 全 commit が `master` に local landed、 push してない (= Rule 3 per-action 認可待ち)
- push して GitHub Pages workflow が走ると `<user>.github.io/fujihc-trainer/` で公開される
- 公開前のチェックリスト:
  - data/tiles.sqlite が `.gitignore` 済 (= 確認済、 過去 commit にも履歴なし)
  - data/fuji.pmtiles も `.gitignore` 済
  - course.json は repo に track 済 (= user 判断、 GPX 変換派生物として OK 体)
  - web/static/* は build 成果物として `.gitignore` 済、 ただし `.gitkeep` track
  - GitHub Actions が web/static/ を再 build する logic は **未実装** (= 現状 user 手動で `python scripts/export_static.py` 必要、 もしくは workflow に add)

### 5. drift catalog 更新 (= 過去 NG 再演パターン記録)
- brief 33 で発覚した「unit test 全 green + integration 不在で実 caller wiring 漏れ」を NG として記録
- パターン名: 「test と実 caller の wiring 不一致 = AI 大量生成テストの典型 slip」
- 再演判定 trigger: brief 完了条件に「実 caller (= 既存 code を呼ぶ場所) の 1 件以上の grep gate」が無い時
- 場所: `~/.agents/state/fujihc-trainer/audit-drift-catalog.md` に追記

## 次 session で拾う時の最短復帰手順

1. `cd ~/fujihc-trainer && git log --oneline e9931f6..HEAD` で session の 22 commit 確認
2. `python -m pytest -q` で 171 passed / 4 skipped、 `npm test` で 389 passed
3. `cat ~/.agents/scratch/fujihc-trainer-project/handoff-2026-05-15-evening.md` (= このファイル)
4. `cat ~/.agents/state/fujihc-trainer/audit-drift-catalog.md` (= 過去 NG)
5. 残作業 1 (= visual 検証) から拾うのが最自然、 もしくは push 認可待ちで保留

## ハマる罠 (= 次 session 拾う時)

- bridge.py を起動したまま `pytest` 実行すると port conflict (= 8000/8765) で test_ws_smoke / test_fake_trainer 2 件 fail、 必ず `Stop-Process` で kill してから pytest
- `?map=1` 起動時に map.idle が永遠に fire しない場合 (= tick jumpTo が ride active 時のみで対策済、 6 秒 timeout fallback もあり)
- viewer の起動分岐は 5 mode (= MAP / TEST / BLE / bridge / static)、 brief 31/32 で 4 way → 5 way に拡張済
- web/static/* は build 成果物、 `.gitignore` 済だが `.gitkeep` のみ track、 export_static.py で再生成
- pmtiles.js は v3.0.6 vendored (= CDN 経由禁止、 `script-src 'self'` CSP 維持)
- web/vendor/ に MapLibre も同梱 (= CSP `script-src 'self'` のため CDN 経由禁止)
- IndexedDB schema は v1、 migration logic は ride_db.js:42 に `onupgradeneeded` の switch 構造を残してある (= future schema 変更時)
- Strava client_id は user が `localStorage.setItem('fujihc.strava.client_id', '...')` で設定する設計、 repo に埋め込まない
- access_token / refresh_token は localStorage 保存、 XSS 防御は CSP `script-src 'self'` + vendoring + inline script ゼロ + revokeLocalToken UI の 4 重 gate

## このセッションの session_id

(= `~/.claude/projects/C--Users-yuuji/` の最新 jsonl、 vault に session-to-vault hook で `~/user-context-vault/voice/sessions/` に landed 済)

---

session 完了、 /compact 推奨。 次 session は visual 検証 → drift catalog 更新 → push 認可問い (= user 判断) の順で拾える。
