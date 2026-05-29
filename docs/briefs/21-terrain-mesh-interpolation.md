---
brief: 21-terrain-mesh-interpolation
title: GSI 標高タイルのメッシュ補完で ride 視点の地形を滑らかに
parent_project: ~/fujihc-trainer/
created: 2026-05-15
depends_on: [17b-viewer-tile-endpoint]
blocks: []
---

# Brief 21: 地形メッシュ補完

## はじめに

GSI 地理院標高タイル (= `dem_png` zoom 14) は富士山周辺で 1 タイル = 約 1.5 km 四方、 256×256 ピクセル、 ピクセル解像度約 **6 m grid**。 ride 視点 (= `userZoom=23.95`、 道路 1 車線想定) で見ると 6 m grid がそのまま「階段状の標高段差」として目に見える、 滑らかな道路 / 斜面に乗ってる体験を損なう。

本 brief は GSI dem PNG を viewer 内でメッシュ補完 (= bilinear / bicubic) で細分化、 例えば 256×256 → 1024×1024 (= 1.5 m grid) に upsample してから terrarium 形式に変換し MapLibre に渡す。 同じソースデータ + ローカル DB のままで体感の滑らかさを段違いに上げる。

## 何が今足りないか (= 現状)

`web/viewer-map3d.js` の `addProtocol('gsidem', ...)` は GSI PNG を読んで 1 ピクセル単位で:
1. (R, G, B) → 標高 m に decode
2. 標高 m → terrarium (R, G, B) に re-encode
3. 同サイズの PNG を MapLibre に返す

これだと 256×256 そのまま、 6 m grid のままで滑らかさは raster の限界。 MapLibre 側の `interpolate-color` で色補間しても、 標高 mesh 自体は粗いまま (= terrain 3D の hill shading や exaggeration がカクつく)。

## 補完戦略

### 採用: Bilinear 4x upsample

256×256 → **1024×1024 (= 16 倍ピクセル数、 1.5 m grid 等価)**。 bilinear (= 周辺 4 ピクセルの線形補間) を pure function で実装、 GPU 負荷は terrarium PNG が大きくなる分だけ。

### 採用しない選択肢

- **8x (= 2048×2048)**: PNG サイズ 4 倍、 GPU memory pressure 大、 ride 視点で 0.75 m grid は過剰
- **Bicubic**: 計算量 4 倍、 視覚効果は bilinear と大差なし (= GSI 元データの精度が 6 m なので、 補間しても新情報は出ない、 滑らかさだけが目的)
- **Lanczos**: 計算量大、 オーバーキル
- **MapLibre の interpolate**: raster-dem 内部処理、 viewer で制御不可

## 実装設計

### `web/lib/terrain_mesh.js` (= 新規、 pure function module)

```js
/**
 * Bilinear upsample for raster height grid.
 *
 * @param {Uint8ClampedArray} src - RGBA pixel array of size srcW * srcH * 4
 * @param {number} srcW - source width
 * @param {number} srcH - source height
 * @param {number} factor - upsample factor (= 2, 4, ...)
 * @returns {{ data: Uint8ClampedArray, width: number, height: number }}
 *   - data: RGBA array of size dstW * dstH * 4
 *   - dstW = srcW * factor, dstH = srcH * factor
 *
 * 標高 RGB ピクセルだけを補間、 alpha は 255 固定. RGB 各 channel を線形補間.
 */
export function bilinearUpsample(src, srcW, srcH, factor) {
  // ...実装は brief 内で完結、 test も同時 land
}

/**
 * Decode + bilinear + re-encode の合成関数.
 * GSI dem PNG (= R*65536+G*256+B encoding, R=128 で無効) を読んで、
 * 標高値の grid を作って、 bilinear 補間してから terrarium に再エンコード.
 *
 * @param {Uint8ClampedArray} gsiRgba - GSI PNG の RGBA array
 * @param {number} w, h - GSI 画像サイズ (= 256)
 * @param {number} factor - upsample factor (= 4)
 * @returns {{ data: Uint8ClampedArray, width: number, height: number }}
 */
export function gsiToTerrariumUpsampled(gsiRgba, w, h, factor) {
  // GSI decode → 標高 grid → bilinear → terrarium encode を 1 関数で
}
```

### viewer-map3d.js 側

`addProtocol('gsidem', ...)` の callback 内で、 現状 inline で書いている decode + re-encode loop を `gsiToTerrariumUpsampled(src.data, W, H, 4)` の呼出に置き換え。 canvas サイズも 256 → 1024 に拡大して `toBlob` で出力。

ES modules 化 は brief 17b 時点で「やらないこと」と決めた、 本 brief でも同じ判断 → `web/lib/terrain_mesh.js` を `<script>` で先に読む形にする (= 既存 `terrarium.js` も同様の扱い、 viewer 側で `window.terrainMesh = { bilinearUpsample, gsiToTerrariumUpsampled }` の global expose pattern が無難)。

または: viewer-map3d.js 内で関数を **inline 実装** (= module 化しない、 ただし test は別 module で同 logic を pure に export)。 ride 視点の挙動が viewer 内に閉じる、 ES modules 化と独立。

→ **inline 実装 + pure module で test** を採用 (= viewer は 1 関数追加で済む、 module の本実装は `web/lib/terrain_mesh.js` で test 駆動)。

## 数値見積もり

- GSI タイル 36 件 × 256² ピクセル × bilinear 4x = 1024² ピクセル × 36 件 = 約 38 M ピクセル / ride
- 1 ピクセル bilinear = 4 multiply + 4 add = 単純計算で 152 M FLOP / ride
- 90 分 ride で 平均 viewport 内 4-9 タイル表示、 1 タイル 1 回 decode (= MapLibre cache あり) なら 38 M ピクセル × 1 回 = 1 ride 全体で 38 M、 GPU 不要 (= CPU で 数 100 ms 以内)
- PNG bytes 約 4 倍 (= 1024² RGBA): MapLibre 内部 tile cache 200 タイル × 4 MB = 800 MB の VRAM 圧迫、 ただし実際は viewport 内のみ常駐で 9 タイル × 4 MB = 36 MB

→ **GPU 負荷 は raster サイズ起因の VRAM 圧迫が主**、 ride 視点の zoom 23 で 9 タイル分の 1024² PNG が常駐すれば実用範囲。 4x upsample が limit、 8x は VRAM 4 倍で危険。

## やらないこと

- Bicubic / Lanczos 補完 (= bilinear で十分、 過剰実装回避)
- 8x 以上の upsample (= VRAM 圧迫)
- MapLibre 自体の補間設定 (= 制御不可、 raster-dem 標準)
- 等高線 vector データの追加 (= 別 source、 別 brief)
- ride 中の動的 factor 切替 (= zoom レベル別に 1x/2x/4x を切替、 別 brief)
- ES modules 化 (= 別 brief、 viewer 全体 refactor)

## 完了条件

1. `web/lib/terrain_mesh.js` 新規、 `bilinearUpsample` + `gsiToTerrariumUpsampled` の 2 関数 export
2. `web/tests/terrain_mesh.test.js` 新規、 全関数 mandate で 8-12 件:
   - `bilinearUpsample` happy: 2×2 → 4×4 で中央ピクセルが角ピクセルの平均
   - `bilinearUpsample` factor=1 で identity
   - `bilinearUpsample` factor=4 で出力サイズ 4x
   - `bilinearUpsample` alpha は 255 固定
   - `gsiToTerrariumUpsampled` happy: 標高 0m → terrarium (128, 0, 0) 相当、 富士山頂 3776m → 正しい terrarium
   - `gsiToTerrariumUpsampled` 無効 GSI ピクセル (= 128, 0, 0) → 0m として補間に参加
   - `gsiToTerrariumUpsampled` 1024×1024 出力サイズ
3. `web/viewer-map3d.js` の `addProtocol('gsidem', ...)` 内で 4x upsample を有効化:
   - canvas を 256 → 1024 に
   - inline loop を `gsiToTerrariumUpsampled` 同等 logic に置換 (= inline 実装 + lib 側 export で test)
4. `npm test` 全 green (= 36 + 6-8 = 42-44 件)
5. `pytest` regression なし (= 111 件維持)
6. ローカル commit、 push しない

## ハマる罠

- 256×256 PNG → 1024×1024 PNG で `toBlob` の serialize 時間が 4 倍、 MapLibre の初回 tile load が体感で遅くなる可能性、 ride 開始直後の表示遅延を許容するか別 brief で先読みするか判断
- bilinear で「無効ピクセル (= GSI R=128 標高ゼロ印)」の扱い: 補間時に有効ピクセルとして使うか skip するか、 海面下を含まない富士山周辺なら有効として 0m 扱いで OK
- Uint8ClampedArray の値域 [0, 255]、 terrarium encode 結果は `Math.max(0, Math.min(...))` で clamp 必要
- ride 視点 (= zoom 23) で 4x upsample しても、 zoom 14 タイルが overzoom で 64 倍拡大される時に MapLibre が独自に再 sample する、 補間効果は中倍率 (= zoom 17-20) で最も見える、 zoom 23 ではどうせ overzoom で再粗化
- 補間効果の **目視確認は user 必須** (= AI 不能)、 brief 20 の FPS 計測で「滑らかになったが FPS 下がってないか」だけは数字で見える

## まとめ

完了条件: terrain_mesh.js + 6-8 件 test + viewer 統合 + `npm test` 全 green + `pytest` regression なし。

ship される: GSI dem の 6 m grid を bilinear 4x で 1.5 m grid 等価に upsample、 ride 視点の地形カクつき改善、 同じローカル DB データで体感品質向上。
ship されない: bicubic / Lanczos / 8x 以上、 ES modules 化、 zoom 別 factor 動的切替。

次の atom: brief 22 (= 動的 factor、 ride 視点 zoom レベルに応じて 1x/2x/4x 切替) or brief 19 (= viewer 統合層切り出し) のどちらか、 user 判断。
