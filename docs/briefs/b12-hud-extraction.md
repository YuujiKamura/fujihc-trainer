# ブリーフ b12 ── HUD を hud.js モジュールに抽出する (Path B Phase 0)

## はじめに

Path B 移行計画 (b11) の Phase 0。viewer-map3d.js (2946 行) は HUD の表示更新を
本体のフレーム処理と WebSocket ハンドラに setText でべた書きしている。専用モジュール
が無いので、Three.js 版 viewer が HUD をそのまま使えない。

本ブリーフは、ライド HUD の表示更新を web/lib/hud.js に括り出す。HUD は値を整形して
DOM に書くだけで MapLibre にも Three.js にも依存しない ── 抽出すれば両 viewer から
import できる。これが移行の下ごしらえ。

## ゴール

ライド HUD (時間・距離・標高・勾配・速度・パワー・ケイデンス・心拍・trainer 応答)
の表示更新を web/lib/hud.js に集約する。viewer-map3d.js は hud.js を呼ぶ形に
変える。**画面の出方は一切変えない** ── 既存ユーザーには見た目の変化ゼロ。

## 背景・既存資産 (= 作り直すな、再利用しろ)

- setText は既に web/lib/frame_diff.js の createTextWriter で作られている
  (= 値が変わった時だけ DOM を触る writer)。hud.js もこの createTextWriter を使う。
- HUD の DOM 構造は index.html の #hud (time/dist/total/ele/ack) と #rider-hud
  (r-slope/r-speed/r-power/r-cadence/r-hr)。要素 id は変えない。
- HUD 更新の現在地: viewer-map3d.js のフレーム処理 (elapsed/dist/ele/r-slope/
  speed)、trainer データの WebSocket ハンドラ (power/cadence/hr/r-*/ack)、
  total の初期化 1 箇所。

## やること (この石だけ)

1. web/lib/hud.js を新規作成する。
   - 純関数の整形を export: formatElapsed (秒→HH:MM:SS)、formatSpeed
     (速度→「N km/h (bridge)」/「待機中」等の条件付き文字列)、trainer 値の整形
     (パワー/ケイデンス/心拍/速度、欠損は「--」)。
   - createHud(getEl) ファクトリ ── getEl は id→要素を返す関数。戻り値は HUD の
     更新メソッド束 (ride / total / speed / trainer / ack / riderHudAt)。
     内部で createTextWriter を使い、値を整形して span に書く。MapLibre にも
     Three.js にも触らない。値の計算と rider-hud の画面座標は呼び出し側の責務。
2. viewer-map3d.js を hud.js を使う形に変える。HUD の inline setText の塊を
   hud のメソッド 1 呼び出しに置き換える。整形ロジックは hud.js へ移し、viewer
   からは消す。HUD 以外の setText (BLE 状態・ペアリングパネル p-*・スライダー値・
   debug-hud の d-*) はこの石では触らない ── ペアリングパネルが trainer 整形を
   共有する分だけ hud.js の export した整形関数を使う。
3. cd web して npm test 全緑。hud.js の整形関数のデータ経路の単体テストを足す
   (happy / 欠損値 / 境界)。既存テストを 1 件も壊さない。

## やらないこと (この石の対象外)

debug-hud (#debug-hud の d-*、?debug=1 専用の開発者用パネル)、cam-zoom/cam-pitch
の表示、BLE setup-status、ペアリングパネル p-* の更新ロジック、スライダー値ラベル。
これらは別 setText 群で HUD 本体ではない。ライド HUD の抽出だけ。

## 検証

- cd web && npm test 全テスト green、既存テスト無破壊。hud.js の整形関数を単体で
  pin (HH:MM:SS 変換、速度文字列の条件分岐、欠損値「--」)。
- 実画面: 本体 repo を range 対応サーバで起動し ?test=1&consent=dev で開き、
  desk_capture で実 Chrome を目視。HUD (time/dist/ele/slope/speed/power/cadence/
  hr/ack) が抽出前と同じ位置・同じ文字で出ていることを確認。raw chrome
  --headless 直叩き厳禁。

## 制約

- 画面の出方を変えない。要素 id を変えない。
- 本体 repo C:\Users\yuuji\fujihc-trainer の master で直接作業してよい。
- push 禁止 (commit は OK)。silent execution。
- 調査メモは repo 外。

## 参照

- 既存 lib: web/lib/frame_diff.js (createTextWriter)、web/viewer-map3d.js
- b11 移行計画 (Phase 0): ~/.agents/scratch/fujihc-trainer-project/briefs/b11-maplibre-to-threejs-migration.md
- MDN textContent: https://developer.mozilla.org/docs/Web/API/Node/textContent

## まとめ

ゴール = ライド HUD の表示更新を hud.js に集約し、viewer-map3d.js はそれを呼ぶ
だけにする。画面は一切変えない。整形は純関数で hud.js に置きテストで pin。debug-hud
やペアリングパネルは対象外。これで Three.js 版 viewer が同じ hud.js を import できる、
Path B 移行の Phase 0。
