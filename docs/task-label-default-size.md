# タスク: 距離ラベルのデフォルトサイズを実画面で詰める

## 目的

fujihc-trainer の viewer で、コース沿いに立つ距離表示の看板（距離ラベル）が「まだ大きい」と指摘が出ている。b13 でラベル高さがスライダー化されたので、その初期値を実画面で見ながら適正なサイズに直す。

## リポジトリ

- `C:\Users\yuuji\fujihc-trainer`、ブランチ `b11-phase5-tile-cache`
- このリポで直接作業してよい（worktree 不要、worker は1本だけ）。
- ローカル commit まで。`git push` は禁止。

## 現状（grep 済みの起点。網羅性は自分で確認しろ）

- `web/viewer-maplibre.js` の 2258 行目あたり、`CONTROL_DEFS` の `labelHeight` エントリ。初期値 `value:4`、範囲 1〜20m、ステップ 1。スライダー操作で `mapRenderer.setLabelHeight(raw)` を呼ぶ。
- `web/lib/map3d/labels3d.js` 44 行目、`export const LABEL_BASE_HEIGHT_M = 4;`。看板の基準高さ（m）。スケール 1.0 のとき高さ＝この値、幅＝その 4 倍。
- `web/tests/labels3d.test.js`：145 行目あたりが `LABEL_BASE_HEIGHT_M` を 0 より大きく 24 未満に固定（巨大文字への回帰検出）。134〜135 行で高さ・幅、169・175 行で Y 位置にこの定数を使う。

`labelHeight` の初期値 `4` と `LABEL_BASE_HEIGHT_M` の `4` は同じ「ラベルのデフォルト高さ」を指している。両方を新しい値に揃えること（片方だけ直すと不整合）。

## 手順

1. `verify-fujihc-screen` スキルで viewer を実際に観る。bridge は `:8000` で `--dummy` 起動済み。`?consent=dev` で intro を飛ばす。riding 状態で距離ラベルを見て、現状 4m がコース幅（約 10m）に対してどれくらい大きいかを具体的に批評する。
2. 読めるが道幅を超えない適正な看板高さを決める。値の当たりを付けるには `LABEL_BASE_HEIGHT_M` を何通りか変えて viewer を撮り直し見比べてよい（スライダーのマウス操作は verify スキルで禁止のため、コード側の値を変えて確認する）。
3. 決めた値で `LABEL_BASE_HEIGHT_M`（labels3d.js）と `labelHeight` CONTROL_DEF の `value`（viewer-maplibre.js）を更新。他にデフォルトを焼き込んでいる箇所がないか grep で確認し、あれば揃える。
4. `labels3d.test.js` の期待値が新しい定数で通るか確認。ハードコードした期待値があれば追従改訂。145 行の「24 未満」レンジは残す。
5. `npm test`（vitest）と `python -m pytest` を両方走らせ、全て green を確認。落ちたら直す。
6. ローカル commit。コミットメッセージに決めた値と理由を 1 行。
7. もう一度 `verify-fujihc-screen` で実画面を観て、修正前後でラベルがどう変わったかを批評する。

## 制約

- `web/lib/terrain3d.js` は配布元配慮で無改造。1 文字も触るな。`labels3d.js` / `viewer-maplibre.js` / `labels3d.test.js` は変更してよい。
- `chrome --headless` の直叩き禁止。viewer の撮影は `verify-fujihc-screen` スキルの手順（desk_capture か headless-shot.ps1）に従う。
- bridge とブラウザは起動済み。勝手に再起動するな。

## 完了報告

決めた値、変更したファイル、`npm test` と `pytest` の passed / failed 数、修正前後のスクショで距離ラベルがどう変わったかの批評。
