---
last_reviewed_at: 2026-05-21
next_review_at: 2026-06-21
last_reviewer: yuujikamura
---

# 配布元 announcement 月 1 watch リスト

b36 (= 配布元境界規律) の L6 物理化。 配布元 (= 国土地理院 / OpenStreetMap / Protomaps) の announcement / changelog を月 1 で人間が読み、 URL pattern / 規約 / endpoint の変更を catch する運用文書。

cron 自動 scraping はしない (= 配布元への余計な fetch を作らない規律)、 開発者が手で開いて読む。

## 確認対象

### 国土地理院 (= GSI)

- 新着情報: https://www.gsi.go.jp/announce.html
- ニュース一覧: https://www.gsi.go.jp/news.html
- 地理院タイル一覧 (= endpoint 形式の SoT): https://maps.gsi.go.jp/development/ichiran.html
- 利用規約: https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html

### OpenStreetMap (= OSM)

- OSM Blog (= 公式 changelog): https://blog.openstreetmap.org/
- OSMF Tile Usage Policy: https://operations.osmfoundation.org/policies/tiles/
- ODbL ライセンス本文: https://opendatacommons.org/licenses/odbl/

### Protomaps

- Protomaps Blog: https://protomaps.com/blog
- pmtiles GitHub: https://github.com/protomaps/PMTiles

## 確認手順

1. 上記 URL を全部 browser で開く (= 月 1、 配布元への 1 round 訪問)
2. 前回 watch 日 (= `last_reviewed_at`) 以降の新着項目を読む
3. URL pattern / endpoint / 規約 / ライセンス / Tile Usage Policy に変更があれば brief 化 (= 別 brief を起票して 7 軸 audit に掛ける)
4. 本 file の frontmatter `last_reviewed_at` を今日の日付に更新、 `next_review_at` を 1 ヶ月後、 `last_reviewer` を担当者に更新
5. 自動 open された GitHub Issue (= `monthly-watch-reminder.yml` 経由) を close する PR の中で本 file 更新を同時に行う (= pre-commit hook が commit message `closes #N` + 本 file 更新 の AND を物理 gate)

## 月 1 と決めた根拠

- GSI 公式 announcement の更新頻度 ≒ 月数件 (= 過去 12 ヶ月の `announce.html` 観察)
- 週 1: 開発者の attention budget 過剰
- 四半期 1: drift detect 遅延が 1-3 ヶ月、 配布元規約変更を察知できないリスク大
- 月 1: drift catch / 注意散漫のバランス点

## 月 1 watch を忘れた時の物理代替

`.github/workflows/monthly-watch-reminder.yml` が毎月 1 日 00:00 UTC に発火、 本 file の全文を body に持つ GitHub Issue を `distributor-watch` label 付きで auto-open する。 `next_review_at` が 30 日以上経過していたら Issue title prefix を `[⚠ distributor-watch]` にして visual 警告。

90 日以上 open のままの `distributor-watch` Issue は同 cron で auto-close (= 12 ヶ月で 12 件累積を防ぐ)、 ただし「Issue が close される ≠ watch が実施された」 を区別するため、 Issue close は本 file の `last_reviewed_at` 更新 commit と同 PR で行う規律 (= pre-commit hook で物理化)。

## 関連 brief

- b36-tile-distributor-courtesy: 本 watch list の親 brief、 6 層物理 gate (= L1 source / L2 test config / L3 workflow yaml / L4 input parameter / L5 fork 防衛 / L6 月 1 人間 watch) の L6 を本 file が担う
- b37-distributor-courtesy-monitoring (= 未起票、 b36 § Scope 外 で委譲): cron 自体停止検知 / branch protection post-landing drift / `vars.AUTHOR_HANDLE` 削除 drift / 組織人事 SPoF / GitHub プラットフォーム制約 等の repo 外 attack surface
