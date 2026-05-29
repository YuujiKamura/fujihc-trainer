# ブリーフ 1 ── 中断ライド復元が機能しないバグの修正

## はじめに

fujihc-trainer viewer (`C:\Users\yuuji\fujihc-trainer\web\viewer-map3d.js`) の
「中断したライドを復元する」ダイアログが出るが、「復元」を押しても**何も復元されない**
(user 報告)。root-cause して直す。実装ではなく、まず再現と原因特定が要る作業。

## 背景・現状判明していること

- autosave: ride 中 30 秒毎に IndexedDB へ進行状態を保存 (`web/lib/ride_autosave.js` の
  `saveAutosave`)。ride 終了で `clearAutosave`。
- 起動時 `checkRestoreThenDispatch()` (viewer-map3d.js ~1572) が `hasPendingAutosave()`
  → あれば `showRestoreDialog(rec)` (~1614)。
- 「復元」ボタン → `_pendingRestore = rec` をセットし `defaultDispatch()`。
- `applyPendingRestore()` (~1646) は `loadCourse()` 末尾 (~1805) で呼ばれる。中身:
  `rideState.start()` → `rideState._rider.distanceTraveled = rec.distanceM` →
  `rec.trkpts` を 1 件ずつ `rideState.appendTrkpt`。
- `web/lib/rider.js`: `distanceTraveled` が位置の source (`_position()` =
  `terrain.getPositionAtDistance(distanceTraveled)`)。なので distanceTraveled を
  書けば rider 位置は動く「はず」。だが user は「何も復元されない」と言う。

## 疑うべき仮説 (= hypothesis-log-reproduce-verify で潰せ)

1. **autosave record が空**: `hasPendingAutosave()` は true (= dialog 出る) だが
   `rec.trkpts` 0 件 / `rec.distanceM` undefined。saveAutosave が実データを保存
   できていない、または保存タイミングの問題。dialog 文言が「0 点, 0.00 km」なら確定。
2. **タイミング**: `loadCourse()` が「復元」クリック**前**に既に走り終わっていて、
   `applyPendingRestore()` が `_pendingRestore === null` で空振り。クリック後に
   loadCourse は再実行されない。
3. **start() による上書き**: `rideState.start()` (rider.js は `distanceTraveled = 0`)
   の後に `_rider.distanceTraveled = rec.distanceM` で上書きしているので順序は一見
   OK だが、shim 経路で start が後から効く / 別 instance を触っている可能性。
4. **復元後の上書き**: 復元で distanceTraveled をセットした直後、ride が active に
   なり rider が start 付近から進み始めて復元位置を踏み潰す。
5. `rec.distanceM` が `Number.isFinite` を通らず (undefined / 文字列) 距離がセット
   されない。

## やること

- ride → 中断 (タブ閉じ / reload) → 再起動 → 「復元」 を実際に再現する。
- IndexedDB の autosave record の中身を直接確認 (trkpts 件数 / distanceM / rideStartedAt)。
- `applyPendingRestore()` が実際に効く経路を追い、上の仮説を 1 つずつ潰して root cause を確定。
- root cause を直す (= symptom の 1 行 patch でなく、保存 or 復元のどちらが壊れているかを直す)。
- 回帰テスト: 「autosave record → applyPendingRestore → rider が復元距離に居る」 を pin
  するテストを追加。現状この経路を覆うテストが無い (= だからこのバグが残った)。

## 検証

- 実画面で ride → 中断 → 復元 して rider が復元距離に居ることを目視。
- `python -m http.server` は使うな (Range 非対応)。Range 対応 server
  (`python C:\Users\yuuji\.agents\scratch\fujihc-trainer-project\range_server.py 8020 web`)。
- スクショは raw `chrome --headless` を直接叩くな (= ホストクラッシュ事故あり)。
  `pwsh C:\Users\yuuji\.agents\skills\verify-fujihc-screen\headless-shot.ps1` か
  deskpilot `desk_capture` を使う。

## 制約

- push 禁止 (commit は OK)。既存テストを 1 件も壊さない。silent execution。
- 調査メモは repo 内に置くな、`~/.agents/scratch/fujihc-trainer-project/` へ。

## まとめ

ゴール = viewer の「中断ライド復元」が実際に rider を復元距離・状態に持ち上げること、
実画面で目視確認できること。これは実装より先に**再現と root-cause** が要るバグ修正。
保存 (saveAutosave) と復元 (applyPendingRestore) のどちらが壊れているかを切り分け、
root cause を直し、その経路を pin する回帰テストを残す。
