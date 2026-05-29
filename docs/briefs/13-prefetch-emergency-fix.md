---
brief: 13-prefetch-emergency-fix
title: prefetchTilesAlongCourse の OSM / GSI policy 違反を即時停止
parent_project: ~/fujihc-trainer/
created: 2026-05-14
revised: 2026-05-14 (Round 2: 第二段封印、 brief 18 を dependency に昇格)
depends_on: [18-js-test-infra]
blocks: []
severity: LOAD-BEARING
---

# Brief 13: prefetch 即時 fix

## はじめに

7 軸 audit Round 1 でセキュリティ境界軸の **LOAD-BEARING** 違反 (= `prefetchTilesAlongCourse` が OSM 最大 2700 タイル + GSI 最大 450 タイルを rate limit なし / User-Agent なしで並列 fetch、 Rule 11 C1 該当) が flag された。 Round 2 audit で「grey な復活経路を残すな / test 規律 を明示しろ」が追加指摘。

本 brief は **関数を呼出側で完全に殺す + 削除を test で担保**。 復活経路 (Round 1 ドラフトの「第二段の縮小版」) は完全削除。 brief 14-17 でローカル DB が landed したら viewer 経路ごと書き換わるので、 中途半端な縮小版を残す価値はない。

brief 18 (JS test 基盤) を **dependency に昇格**。 prefetch 呼出を消すという load-bearing 変更を test 無しで landing するのは NG-R1-8 再演、 順序を入れ替えて先に test 基盤を入れる。

## 何を実際の数字で言ってるか (Round 1 NG-R1-15/16 の根拠)

現状 (修正前) コードから実計算:
- `prefetchTilesAlongCourse`: `course.length / 50` step ≈ 40 sample 点
- 各 sample で `dx, dy ∈ [-1,1]` の 3x3 = 9 タイル
- zoom レベル 14-19 の 6 段
- 合計 OSM タイル数 = 40 × 9 × 6 = **2160** (重複除いて約 1500-2000)
- GSI dem zoom 14 のみ = 40 × 9 = **360** (重複除いて約 200)
- これを `new Image()` で並列投入 = ブラウザ次第で同時 6-100 並列

OSM Tile Usage Policy の "Limit to 2 download threads" "No bulk downloading" を 1000 倍規模で超える。 brief 14 で算出した「正規 1185 OSM タイル / 36 GSI タイル」の総量見積もりとも整合 (= corridor 3x3 で同範囲を覆うのが正解、 ただしそれを policy 内に収めるのが brief 14-17 の役割)。

## 修正方針

`web/viewer-map3d.js` で 2 ステップ:

1. **prefetch 呼出の完全 comment out** (1 行修正):
   ```js
   // FROZEN brief 13: bulk fetch violates OSM/GSI policy.
   // Local tile DB (brief 14-17) will replace this entirely.
   // prefetchTilesAlongCourse();  // <- comment out
   ```
2. **関数本体は残すが test で「pairing 中の外部 fetch ゼロ」を保証**:
   関数定義は viewer-map3d.js 内に残置、 ただし呼出は無い。 brief 17 で viewer 経路ごと書き換わる時に関数定義も削除される。 「第二段の縮小版」「環境変数で復活」は削除 (= Round 2 で grey 経路と flag された)。
3. **status message 文言修正**: 既存 "裏読み中..." 表示が無意味になるため、 「ペアリング中 (タイルは表示時に取得)」に変更

## なぜ第二段を捨てるか

Round 2 audit (セキュリティ軸):
> 「並列度 2 / 500ms delay」を許可する設計は OSM policy 「2 download threads」境界張り付き + Tile Usage Policy の "No automated/bulk downloading even at low rate" 解釈で grey、 復活経路自体が NG-R1-15 再演リスク

= 「policy 内に収まるかどうかを script 側で守る」より「prefetch 概念ごと削除する」方が clean。 brief 14-17 で 60 MB を 1 回 DL するという根本解があるので、 暫定 fix で grey 帯を残す価値ゼロ。

## やらないこと

- ローカル tile DB の準備 (= brief 14-17)
- bridge.py に tile server を生やす (= brief 17a)
- viewer の経路変更 (= brief 17b)
- 関数本体の削除 (= brief 17b で実施)
- 過去の試走で既に届いた違反 fetch の事後対応 (= ログ上 47 ride 分の bulk fetch が landed 済、 公式に通報する義務はない、 ただし今後再演させない)

## 完了条件

1. `web/viewer-map3d.js` の `prefetchTilesAlongCourse()` 呼出が comment out されている
2. status 表示文言が「ペアリング中 (タイルは表示時に取得)」に変更
3. **JS test 追加** (= brief 18 完了後): `web/tests/no_external_fetch_on_load.test.js`
   - 内容: viewer を JSDOM 等で load した時、 `prefetchTilesAlongCourse` の呼出が走らないことを assertion
   - もしくは spy で `window.Image` / `fetch` 経由の外部 host への request が 0 件であることを確認
4. browser で実走確認: pairing 画面表示時 → DevTools Network panel で外部ドメインへの request が 0 件、 viewport 内タイルは MapLibre の lazy load で正常表示
5. ride 1 周走行: タイル表示 / camera / WebSocket / HUD すべて壊れていない
6. ローカル commit、 push しない

## テスト (Rule 1 順守)

- `npm test` (brief 18 完了後): no_external_fetch_on_load.test.js が pass、 既存 vitest test 全 green
- `pytest tests/test_ws_smoke.py`: backend 既存 6 test green
- 実走 1 ride (5-10 分): browser で目視 + DevTools Network 録画、 外部 fetch ゼロを確認、 報告に passed/failed 数 + 録画したリクエスト総数を書く

## ハマる罠

- prefetch 関数定義を消すと未使用変数 (`lastJumpToT`, `seenOsm` 等) が ESLint で warning、 ただし関数自体は残すので影響なし
- `index-maplibre.html` の status message DOM 要素 ID が brief 12 で `index.html` に rename される、 brief 12 完了前なら旧 ID を更新
- JSDOM で MapLibre は完全には動かない、 test は viewer の `<script>` 評価時に prefetch が呼ばれないことだけを assert (= 描画は test 範囲外)

## まとめ

完了条件: prefetch 呼出が comment out / status 文言変更 / JS test 1 件追加 / 外部 fetch ゼロ確認 / 既存機能不変 / 全 test green。

ship される: policy 違反の即時停止、 brief 14-17 着手の時間的猶予、 「grey な復活経路ゼロ」の clean state。
ship されない: ride 中のタイル先読み (= brief 17b で根本解として復活、 prefetch 概念ではなくローカル DB)、 関数定義の削除 (= brief 17b)。

次の atom: brief 13 完了後、 brief 14 と並列で brief 18 残作業 (4 lib 切り出し本体) を進める。
