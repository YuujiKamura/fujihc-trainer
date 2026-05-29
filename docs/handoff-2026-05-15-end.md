---
session_handoff
date: 2026-05-15
status: brief 12-25 全 landed、 viewer 統合 (brief 23/24/25) 完了、 brief 19 lib 切出のみ済 (viewer 統合は brief 19b で)
test: pytest 125 / 4 skipped + npm 159 = 284 件 green
---

# fujihc-trainer 2026-05-15 session end handoff

## 何を達成したか (= 今 session で landed した brief)

| brief | 内容 | viewer 統合 |
|---|---|---|
| 12 | Cesium 版を web/archived/cesium/ に物理隔離 | 済 (= index.html 統一) |
| 13 | prefetchTilesAlongCourse 呼出を comment out | 済 |
| 14 | ローカル tile DB schema_v1、 tile_constants 中央定数 | 済 |
| 15 | scripts/fetch_gsi_dem.py | 実 DL は user 手動 |
| 16 | scripts/fetch_osm_pmtiles.py | 実 DL は user 手動 |
| 17a | src/fujihc/tile_server.py + http_app.py | 済 (= bridge.py から呼出) |
| 17b | viewer の OSM/GSI 直叩きを localhost endpoint に切替 + dead code 削除 | 済 |
| 18 setup | vitest + 4 pure lib (tile_math / terrarium / tile_coverage / heading) | 済 |
| 19 lib のみ | ws_client / ride_state / camera_controller の 3 lib 切出 | **未** (= 次 session の brief 19b で) |
| 20 | GPU polling + measurement diff substrate | 済 |
| 21 | GSI bilinear 4x upsample (= 地形メッシュ補完) | 済 |
| 22 | ?test=1 で trainer/bridge 不要モード | 済 |
| 23 | GPS ジッター除去 (window=5、 短距離ジグザグのみ) | 済 |
| 24 | Zwift 風 6 段階勾配色分け | 済 |
| 25 | 道路 5m 幅 polygon | 済 |

## commit 15 個 (= `1b3442c..HEAD`)

```
e9931f6 brief 19 + 23 + 24 + 25: viewer 統合層 lib 切出 + GPX smoothing + 勾配色分け道路 polygon
7a71bea round 3 設計境界 NG fix: bridge.py から HTTP app を切出 (982 -> 933 行)
31e06f0 brief 22: trainer / bridge 不要の画面操作確認モード (?test=1)
e65bc6a brief 21: GSI 標高タイルを bilinear 4x で滑らかに
d5c35cf brief 12 物理化: Cesium 版を web/archived/cesium/ に凍結
750b600 brief 17b + estimate + SoT: viewer 経路書換 / dead code 削除 / API 対称
225cc2a round 3 audit fix: bind / schema_version / encoding / dep pin / OSS notice
a4b8e15 brief 17a: tile_server.py module + bridge.py aiohttp 統合
ef13a67 brief 14 / 15 / 16: tile DB init + GSI DL + OSM PMTiles 抽出 scripts
fac958e brief 20 (続): measurement_diff.py で ride 前後 jsonl の比較
a70a859 brief 14 + 18: tile_coverage Python/JS cross-language + JS test 基盤
281e65b brief 13: freeze prefetchTilesAlongCourse (OSM/GSI policy 違反停止)
1f0c16e brief 20: GPU polling substrate (scripts/gpu_poll.py + tests)
2c1e116 phase 1 follow-up: GPX export, MapLibre viewer variant, test suite
1b3442c phase 1: trainer-bridge + viewer WebSocket + CSV ride log (= 起点)
```

## audit history (= drift catalog にも記録済)

- Round 1 (= 現状コード audit、 brief 12-25 起草前) → REDRAFT、 LOAD-BEARING 2 + CRITICAL 1
- Round 2 (= brief 12-19 redraft draft 群) → 全 7 軸 NG → fix
- Round 3 (= impl 7 commit) → REDRAFT、 viewer 直叩き + 設計境界 NG + 細かい load-bearing 数件
- Round 4 (= 全 fix 後) → **CONVERGED**
- brief 21 Round 2 → CONVERGED

drift catalog: `~/.agents/state/fujihc-trainer/audit-drift-catalog.md` (Round 1-4 + brief 21 Round 2 で更新済)

## GPU baseline (= 物理点検前後)

- 2026-05-14 23:30 idle (fan 点検前): 47℃ / fan 40% / util 17% / 1317 MiB / 12.17W
- 2026-05-15 朝 idle (fan 点検後): **41℃ / fan 35% / util 22% / 856 MiB / 7.35W**

差分: 温度 -6℃ / fan -5% / power -4.8W、 物理点検の効果あり。 brief 21 (= bilinear 4x upsample) の効果は ride 中の比較が必要、 まだ未測定。

## 残作業 (= 次 session、 自然な atom 順)

### 1. brief 19b: viewer 統合層を viewer に組み込む

ws_client / ride_state / camera_controller の 3 lib は既に landed (= test 44 件 全 pass)、 ただし viewer-map3d.js は依然 inline で WebSocket / ride state / camera を持つ。 NG-R1-12 (= ws.send 7+ 箇所散在) は未解消。

具体:
- viewer-map3d.js 冒頭で 3 lib を import
- `connectBridge()` を `createBridgeClient(WS_URL, wsHandlers)` 呼出に置換、 `client.sendRideStart()` 等で send 集約
- `initTestMode()` を `createTestModeClient(wsHandlers, options)` に置換 (= fake ws オブジェクトの inline 廃止)
- ride 進行関連の global state (= `curIdx`, `curDist`, `paused`, `rideActive` 等) を `rideState = createRideState(course)` で管理、 tick 内で `rideState.advance(dt, playSpeed)` 呼出
- `map.jumpTo()` の引数を `computeCameraParams(course, rideState.snapshot(), { userZoom, userPitch, lookAhead: 5 })` で計算
- viewer_url_audit.test.js に「ws.send が viewer 内 0 件」「createBridgeClient import」「rideState 使用」を pin

注意: 既存挙動を変えない、 source-grep gate + 全 52+ 件 JS test pass + 全 125 件 Python test pass を維持。 viewer-map3d.js は約 700 行から 400 行程度に縮む見込み。

### 2. baseline ride 計測 (= user 手動)

brief 17b 完了後 (= 外部 fetch ゼロ + zoom 17 単一化) + brief 21 (= bilinear 4x) の効果を数字で見る:

```bash
# 端末 1: GPU polling
python scripts/gpu_poll.py --output data/measurements/2026-05-15-ride-baseline.jsonl --label ride-baseline

# 端末 2: bridge dummy (= trainer 不要、 tile 配信 + WebSocket + dummy ride loop)
python -m fujihc.bridge --dummy

# browser
http://127.0.0.1:8000/
# - 道路が滑らかな polygon で 6 段階色分けされて見える (brief 23/24/25)
# - GSI 標高は 4x upsample で zoom 23 でも段差感が減る (brief 21)
# - ride 1 周 (= dummy 20km/h で 1.2 時間、 早送りで 5-10 分)

# 端末 1 を Ctrl+C で停止
# jsonl が baseline、 次回 brief 19b 完了後の jsonl と比較する
python scripts/measurement_diff.py --before <baseline> --after <after-19b>
```

簡易確認だけなら trainer / bridge 不要モード:
```bash
python -m http.server -d web/ 8000
# browser で http://localhost:8000/?test=1
```

### 3. ローカル DB 構築 (= user 手動、 まだ未実施)

```bash
python scripts/init_tile_db.py
python scripts/fetch_gsi_dem.py  # 36 タイル / 約 36 秒
# OSM PMTiles 元ファイルを DL (= README 手順、 Protomaps から数 GB)
python scripts/fetch_osm_pmtiles.py --pmtiles ~/Downloads/japan.pmtiles
```

DB 構築前は viewer の tile 経路が 503 (= setup 未完了 signal、 bridge.py が返す)、 灰色背景になる。

### 4. Phase 2 候補 (= 後回し OK)

- Strava .fit export (= ride 終了時に GPX + .fit 出力、 Strava アップロード可能)
- Garmin Connect 連携
- ride 履歴の dashboard
- 503 fallback DOM 改善 (= viewer 側で「DB 未整備、 セットアップ手順は README」表示)
- bridge.py の更なる責務分離 (= BLE 部分を別 module へ)

### 5. OSS 公開準備 (= 慎重判断)

- license 整理 (= ODbL タイル + GSI 規約 + コード本体 license の整合)
- DB ファイル / PMTiles 元 / Strava token 等が `.gitignore` 済か再確認
- README の OSS 公開注意 section は既に書いた (= UA 書換 / 127.0.0.1 限定 / 規約再確認)
- 公開リポは別 path 推奨 (= sensitive 履歴を残さない fresh repo)、 user 判断

## 次 session で拾う時の最短復帰手順

1. `cd ~/fujihc-trainer && git log --oneline 1b3442c..HEAD` で 15 commit 確認
2. `python -m pytest -q` で 125 passed / 4 skipped 確認
3. `npm test` で 159 passed 確認
4. `cat ~/.agents/scratch/fujihc-trainer-project/handoff-2026-05-15-end.md` でこのファイル
5. `cat ~/.agents/state/fujihc-trainer/audit-drift-catalog.md` で過去 NG pattern (= 再演 LOAD-BEARING 昇格対象)
6. brief 19b に着手するなら `~/.agents/scratch/fujihc-trainer-project/briefs/19-viewer-integration-layer.md` を読む

## ハマる罠 (= 次 session が拾う時)

- viewer-map3d.js は ES modules 化済 (= `<script type="module">`)、 import / export 可能だが、 globalThis 経由の MapLibre / localStorage / document アクセスは module scope でも動く
- web/lib/* は test では vitest、 viewer から使う時は browser の native ES modules、 両環境で同 file が動く前提を維持
- cross-language fixture (= `web/tests/fixtures/py_*.json`) は Python test 実行で生成、 JS test が `existsSync` skip で fixture 不在を許容、 ただし peer B (= brief 14 Python) が先に走ってないと cross-language test は skip 扱い
- bridge.py の bind は `127.0.0.1` 厳守、 `0.0.0.0` への変更は `test_bind_is_127_0_0_1_in_source` test が fail させる物理 gate
- viewer-map3d.js の `prefetchTilesAlongCourse` 関数定義は brief 17b で完全削除済、 復活させると `test_viewer_url_audit` が fail
- `SCHEMA_VERSION` は `tile_constants.py` が唯一の真実源、 各 script で再定義禁止 (= init_tile_db.py の重複定義は SoT 統合済)
- `.omc/` は AI session state、 `.gitignore` 追加済、 commit しないこと

## このセッションの session_id

(= 最新 jsonl in `~/.claude/projects/C--Users-yuuji/`、 vault には session-to-vault hook 経由で `~/user-context-vault/voice/sessions/` に landed 済)

---

session 完了、 /compact 推奨。
