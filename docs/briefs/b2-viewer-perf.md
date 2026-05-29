# ブリーフ 2 ── viewer 描画性能の改善 (per-frame コスト削減)

## はじめに

fujihc-trainer viewer (`C:\Users\yuuji\fujihc-trainer\web\viewer-map3d.js` ほか) の
描画が低 VRAM GPU (AMD Radeon RX 6400) で重い。`chrome://gpu` で WebGL は
"Hardware accelerated" 確認済 ── ドライバ問題ではなく**コードの per-frame コスト**が
原因。性能監査 (3 agent 並列) の確定結果を直す。

## 既に対応済 (= やらなくてよい)

- 地形 DEM upsample 倍率 4→2 (commit `8a9e355`)。VRAM 1/4。

## 直す対象 (= 性能監査の確定結果、 severity 順)

### Critical-1: rider GeoJSON を毎フレーム再構築 + GPU 再アップロード
`viewer-map3d.js` の `tick()` (rAF ループ、60fps) が毎フレーム
`buildRiderFeatures(...)` で新規 FeatureCollection を生成し `ridSrc.setData()` で
MapLibre に再アップロード。`setData` は source 全体を再パース・再 tessellate・再 buffer
する。低 VRAM GPU で持続的 stall。
→ 直す: rider 位置 / heading が前フレームと変化した時だけ `setData`。停止中は skip。

### Critical-2: DEM タイルの upsample が毎セッション再計算 (キャッシュ未使用)
`gsidem://` protocol が tile ごとに Canvas decode → `gsiToTerrariumUpsampled` を実行。
`web/lib/mesh_cache.js` (IndexedDB) は polygon にしか使われておらず、terrain は毎回
87 タイル分を再計算 (= 重い CPU 処理が毎起動)。
→ 直す: terrarium 変換結果を `mesh_cache` に `kind:'terrain'` (key = z/x/y) で persist、
2 回目以降は decode/upsample を bypass。`mesh_cache.js` は既に terrain kind を
保存できる設計、 DEM 経路が使っていないだけ。

### High-3: 帯ポリゴン (1968 点) を zoom 変化のたびに全再生成
`viewer-map3d.js` の `_rebuildRoute` が `map.on('zoom')` で
`buildGradeColoredRoadPolygons(course, …)` を再実行 (1968 セグメント全展開 + 全頂点
再アップロード)。0.25 step throttle はあるが zoom 操作中は連発、1 回 31〜63ms。
→ 直す: meter 幅の zoom 連動をやめ起動時 1 回固定幅で生成、太さ可変が要るなら
`line-width` の zoom 式で。または zoom 終了時のみ再生成。

### High-4: tick で setText を毎フレーム 30 回超
debug 系ラベル (`d-rider-lat` 等) を平時も毎フレーム書いている。各 `setText` が
`getElementById` + `textContent` で layout 無効化を誘発。
→ 直す: `?debug=1` (body.debug-on) の時だけ debug 系を出す。値が変わらないフレームは
書き込み skip。

### High-5: updateMinimap が毎フレーム 2 canvas を全 clear+drawImage
2D canvas の毎フレーム全描画は GPU 描画と競合。
→ 直す: rider 位置が pixel 単位で動いた時だけ再描画。`getContext` は loop 外でキャッシュ。

## やること

各項目を直す。可能なら headless で frame time を計測し before/after を数値で出す。
「変化した時だけ更新する」 が共通原則 ── 現状の主犯は無条件 per-frame 再構築。

## 検証

- `cd web && npm test` 全テスト green、 既存テストを壊さない。
- 起動確認は raw `chrome --headless` を直接叩くな (= ホストクラッシュ事故あり)。
  `pwsh C:\Users\yuuji\.agents\skills\verify-fujihc-screen\headless-shot.ps1` を使う。
  Range 対応 server (`range_server.py 8020 web`) 経由。

## 制約

- push 禁止 (commit は OK)。物理計算 (bike_physics.js) には触らない。
- 既存テストを 1 件も壊さない。silent execution。

## まとめ

ゴール = viewer の per-frame コストを下げ、低 VRAM GPU でも軽く動くこと。
主犯は「毎フレーム無条件の再構築・再アップロード」と「キャッシュ可能なのに毎回再計算」。
Critical-1 (rider 毎フレーム setData) と Critical-2 (DEM 未キャッシュ) が最優先、
次に zoom 連動ポリゴン再生成・setText・minimap。「変化検出して必要な時だけ」 に直す。
