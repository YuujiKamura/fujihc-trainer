# FROZEN: Cesium 版 viewer (2026-05-15)

このディレクトリの内容は **凍結済**。 編集禁止、 復活させるな。

## 凍結理由

- Cesium は OSS にできない (= user 判断、 2026-05-14)
- viewer.js は OSM / GSI を runtime 直叩きで第三者 ToS 違反 (= Rule 11 C1)、 brief 13/17b で停止していない
- 本流は `../viewer-maplibre.js` (= ローカル DB + `${location.origin}/tiles/...` 経由)、 `web/index.html` がそれを load する

## 復活させたい場合

別 brief を起草、 OSS 化判断 + ToS 違反停止 + 物理 gate 化を全て解決してから。 安易な復活禁止。
