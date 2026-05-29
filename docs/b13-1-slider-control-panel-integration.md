# b13-1: 共通スライダー機構の viewer 統合

- シリーズ: b13 (viewer 調整UIの共通化 + 地形高さ修正)
- 依存: `web/lib/control_panel.js` (作成済・テスト済) を使う。独立して着手可。b13-4 が本ブリーフに依存。
- 状態: draft v2 (Round 1 7軸 audit 反映済)

## 目的

index.html の手書きスライダー9個と、viewer-map3d.js に5系統で散らばった配線を、作成済みの `web/lib/control_panel.js` (定義駆動の共通機構) に一本化する。機器設定パネルを折りたたみ可能にする。

## なぜ

スライダーを1個増やすたびに index.html の `<input type=range>` 行と viewer-map3d.js の配線を両方手書きしていた。control_panel.js は調整項目1個を定義オブジェクト1個で宣言できる。新規調整スライダー (b13-4) を足す前提工事。

## 現状

- index.html L429-445: 手書き `<input type="range">` 9個 (rngDiff/rngSpd/rngInertia/rngMass/rngRr/rngCda/rngLightDir/rngLightStr/rngLabelSize)
- viewer-map3d.js のスライダー配線が5系統に分裂: `bindSlider` 定義 L2250・使用 L2259-2260 / `bindBikeSlider` 定義 L2279・使用 L2293-2298 / 慣性 個別配線 L2263-2275 / 光源 個別関数 applyLightDir/applyLightStr L2302-2316 / ラベルサイズ 個別配線 L2320-2332
- 物理グローバル変数: diffMult(L183) speedMult(L184) inertiaKg(L190) bikeMass(L201) bikeCrr(L202) bikeCda(L203)、labelSizeScale(L256)
- `web/lib/control_panel.js`: 作成済。export = `mountControlPanel` ほか。createSliderRow は input id を `'rng_'+key`、値表示 span id を `key+'Val'` で生成する。テスト control_panel.test.js 25件 green。**worker は control_panel.js を作り直さず、そのまま使う。**
- 既存テスト segment_labels_viewer.test.js が index.html / viewer-map3d.js のスライダー配線を静的 grep で pin している (後述)。
- sw.js: app shell (html/js/css) は network-first。CACHE_NAME='fujihill-v11'。index.html L808 が `<script type="module" src="viewer-map3d.js?v=39"></script>`、sw.js PRECACHE_URLS (L23) にも同じ `viewer-map3d.js?v=39`。

## 変更

### index.html
- L429-445 の9スライダー行を撤去。
- `#controls` 内、ボタン群 (L424-428) と hillshade dbg 表示 (L446-451) の間に `<div id="control-sliders"></div>` を置く。
- `<style>` に `.panel-header` (cursor:pointer・太字) と `.panel-body` のスタイルを追加。既存 `.row`/`.val` (L87-89) はそのまま使う。
- index.html L808 `<script type="module" src="viewer-map3d.js?v=39"></script>` の `?v=39` を `?v=40` に。

### viewer-map3d.js
- import 群に `import { mountControlPanel } from './lib/control_panel.js';`
- L2250-2332 のスライダー配線5系統を撤去。
- 物理グローバル宣言 (L183-203) より後ろで `CONTROL_DEFS` を定義。apply は現行挙動を保つ:

| key | min | max | step | value | unit | format | apply |
|---|---|---|---|---|---|---|---|
| diff | 10 | 200 | 5 | 100 | % | Math.round | `diffMult=raw/100; lastSlopeSent=null;` |
| spd | 50 | 200 | 5 | 100 | x | `(raw/100).toFixed(2)` | `speedMult=raw/100;` |
| inertiaKg | 0 | 3000 | 50 | 800 | kg相当 | Math.round | `inertiaKg=raw;` |
| mass | 60 | 110 | 1 | 88 | kg | Math.round | `bikeMass=raw;` |
| crr | 1 | 25 | 1 | 1 | ‰ | Math.round | `bikeCrr=raw/1000;` |
| cda | 18 | 60 | 1 | 35 | m² | `(raw/100).toFixed(2)` | `bikeCda=raw/100;` |
| lightDir | 0 | 360 | 5 | 135 | ° | Math.round | `mapRenderer.setSunlightDirection(raw); setText('dbgLightDir',String(Math.round(raw)));` |
| lightStr | 0 | 100 | 5 | 100 | % | Math.round | `mapRenderer.setSunlightStrength(raw/100); setText('dbgLightExag',(raw/100).toFixed(2));` |
| labelSize | 40 | 200 | 10 | 100 | x | `(raw/100).toFixed(1)` | `labelSizeScale=raw/100; mapRenderer.setLabelScale(raw/100);` |

- `CONTROL_DEFS` 定義の直前で localStorage 移行処理 (下記) を実行。
- `mountControlPanel(document.getElementById('control-sliders'), CONTROL_DEFS, {collapsible:true, title:'調整'})`

### localStorage 移行 (決め切り)

control_panel.js は localStorage に「スライダー生値」を保存する。旧 viewer の保存形式と照合した結果:

| 旧キー | 旧保存形式 | 新形式 | 措置 |
|---|---|---|---|
| fujihill.diff | pct/100 (例 1.0) | 生値 100 | **removeItem** (形式不一致、旧値は clamp で min に落ち誤値) |
| fujihill.spd | pct/100 | 生値 100 | **removeItem** (同上) |
| fujihill.crr | 係数 (例 0.001) | 生値 1 (‰) | **removeItem** (形式不一致) |
| fujihill.cda | 物理値 (例 0.35) | 生値 35 (×100) | **removeItem** (形式不一致、clamp で 0.18 化) |
| fujihill.labelSize | 倍率 (例 1.0) | 生値 100 (×100) | **removeItem** (形式不一致、clamp で 0.4 化) |
| fujihill.inertiaKg | kg 生値 (例 800) | kg 生値 | **残す** (新旧とも kg 生値、ユーザー設定を保持) |
| fujihill.mass | kg 物理値 (例 88) | kg 生値 | **残す** (新旧とも kg、値が一致) |

→ mountControlPanel 呼び出しの**前**に `['fujihill.diff','fujihill.spd','fujihill.crr','fujihill.cda','fujihill.labelSize'].forEach(k => { try { localStorage.removeItem(k); } catch {} })` を実行。inertiaKg / mass は触らない (ユーザーが調整した慣性・体重を保持)。lightDir / lightStr は旧 viewer に保存コードが無いためキー自体が存在せず、措置不要。

### segment_labels_viewer.test.js 改訂

このテスト L49-61 の2つの it が、撤去する手書きスライダーを静的 grep で pin している。control_panel 方式に合わせて改訂する:
- L49 it「ラベルサイズは slider 連動」: `viewer` の `/function applyLabelSize/` と `/localStorage.setItem('fujihill.labelSize'/` の grep を削除 (両方とも control_panel 移行で viewer から消える)。`viewer` に `CONTROL_DEFS` 内の labelSize 定義があること + apply が `mapRenderer.setLabelScale(` を呼ぶことを pin に変える。
- L58 it「機器設定パネルに ラベルサイズ slider」: `html` の `/id="rngLabelSize"/` `/id="labelSizeVal"/` grep を削除 (control_panel が動的生成するため静的 html に無い)。`html` に `/id="control-sliders"/` があることを pin に変える。
- L19-47 (map_renderer.js を見る it 群) は本ブリーフのスコープ外、触らない。

### sw.js
- CACHE_NAME を `'fujihill-v11'` → `'fujihill-v12'`。
- PRECACHE_URLS の `viewer-map3d.js?v=39` を `?v=40` に (index.html の script src と一致させる)。
- `web/tests/sw_cache_version.test.js` を通す。

## 注意 (= 決め切った仕様)

- `CONTROL_DEFS` は物理グローバル宣言 (L183-203) より後ろに置く (apply のクロージャがそれらを参照するため)。
- control_panel.js の input id は `rng_<key>`、値 span id は `<key>Val`。
- btnOpenPairing (L427、BLE setup-overlay) は本件と無関係、触らない。

## 検証

- `npm test` 全件。改訂した segment_labels_viewer.test.js / sw_cache_version.test.js / static_mode.test.js / map3d_index.test.js が green。
- 画面 (deskpilot): viewer 起動 → 機器設定パネルに9スライダー / 折りたたみ見出しのクリックで開閉 / 各スライダーが現行通り効く (負荷→勾配、光源→陰影、ラベルサイズ→文字)。

## Round 1 audit 反映

- removeItem を「旧9キー一律」→「形式不一致の5キーのみ、inertiaKg/mass は保持」に修正 (rev-migsec 指摘)。
- segment_labels_viewer.test.js が壊れる件、改訂方針を本文に明記 (rev-test / rev-structure 指摘)。
- sw.js bump を変更・検証に追加 (NG-R2-1、全 reviewer 指摘)。
