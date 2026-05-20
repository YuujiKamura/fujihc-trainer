# fixtures/ ── unit / e2e の固定 input

ここに置く file は git 追跡対象 (= `.gitignore` 対象外)。 既存 `.gitignore` の `data/*.sqlite` / PMTiles 大型 binary 規律 (= 数百 MB 以上禁止) とは別扱いで、 数百 KB 程度の test 固定 input は同梱する。

## gsi_dem_v1_sample.png

GSI 地理院標高タイル (= PNG 形式) のサンプル。 b36 (= 配布元境界規律) の物理 gate test (= `terrain_loader_decode_fixture.test.js`) が decode 純関数の互換を verify する固定 input。

- **取得元**: `https://cyberjapandata.gsi.go.jp/xyz/dem_png/14/14506/6418.png`
- **取得日**: 2026-05-21
- **タイル座標**: z=14, x=14506, y=6418 (= 富士山頂周辺、 b35 で確認済の 200 OK タイル)
- **出典**: © 国土地理院 (= GSI 利用規約に従い出典明示、 `https://maps.gsi.go.jp/development/ichiran.html`)
- **size**: 約 109 KB (= 数百 MB 規律内、 git track 対象)
- **SHA-256**: `gsi_dem_v1_sample.png.sha256` で別 file 管理 (= `web/tests/terrain_loader_decode_fixture.test.js` が test 実行前に hash verify、 改竄 catch)

更新 trigger: 月 1 配布元 watch (= `docs/distributor-watch.md`) で decode 経路の変更告知を発見した時のみ。 author 1 人が新 fixture + SHA を再生成、 別 brief (= b36-fixture-refresh) で track。

## CODEOWNERS

`web/tests/fixtures/**` は `.github/CODEOWNERS` で author review 必須に gate されている (= fork PR で fixture 差し替えされた時、 merge 前に author / backup reviewer のレビュー必須)。 fixture 改竄 PR を SHA mismatch だけでなく社会的にも block する 2 重層。
