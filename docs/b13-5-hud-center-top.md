# b13-5: HUD を画面中央上部に固定

- シリーズ: b13
- 依存: なし (独立して着手可)
- 状態: draft v2 (Round 1 7軸 audit 反映済)

## 目的

`#rider-hud` (slope/speed/power/cad/hr) のライダー追従をやめ、画面中央上部に固定する。

## なぜ

ユーザー指摘「ライダーにHUDが追従してない。というかHUDセンター上に固定してもいい」。`#rider-hud` は本来ライダーの画面座標に追従する設計 (毎フレーム `map.project` 経由で left/top を更新) だが、viewer が map3d (Three.js) になり追従が機能していない。追従を直すより、ユーザー指示通り中央上部固定にするのが最小で確実。

## 現状

- index.html L388-394 `#hud`: time/dist/ele/ack/cam ── 左下固定 (CSS L54-61)。**今回の指摘外、触らない。**
- index.html L398-404 `#rider-hud`: slope/speed/power/cad/hr ── CSS L65-77 (`position:fixed; left:0; top:0; z-index:998; transform:translate(-50%,0)`、初期 `display:none`)。CSS コメントに「中央寄せ、top は豆腐の下端」とある。
- hud.js L124-134 `riderHudAt(x, y, visible)`: visible なら `el.style.display='block'` + `el.style.left/top` をインライン設定、visible=false なら `display:'none'`。座標は呼び出し側が渡す (hud は座標系を知らない)。
- viewer-maplibre.js L1991-1997: tick が `const pt = mapRenderer.projectToScreen(rLon, rLat); hud.riderHudAt(pt.x, pt.y+30, true);` で毎フレーム #rider-hud の left/top を更新。else 節で `hud.riderHudAt(0,0,false)`。
- sw.js: app shell network-first、CACHE_NAME='fujihill-v11'。index.html L808 `<script type="module" src="viewer-maplibre.js?v=39"></script>`。
- hud.test.js の `riderHudAt` 参照は2箇所 ── L151-161 の独立 it「riderHudAt: visible で座標配置、false で非表示」と、L163-173 の it「要素が無くても落ちない」内 L169 の `hud.riderHudAt(1, 1, true)`。

## 変更

### hud.js
- `riderHudVisible(visible)` を新規追加: `el.style.display = visible ? 'block' : 'none'` のみ。left/top には触れない (= CSS の固定位置を上書きしない)。
- `riderHudAt(x,y,visible)` は本変更で呼ばれなくなる。削除する前に `riderHudAt` の全参照を grep で確認 ── 現状の参照は viewer-maplibre.js L1995/L1997 と hud.test.js の2箇所。hud.test.js は (a) L151-161 の独立 it を `riderHudVisible` のテストに丸ごと差し替え、(b) L163-173 内 L169 の `hud.riderHudAt(1, 1, true)` を `hud.riderHudVisible(true)` に差し替える。両方やらないと riderHudAt 関数削除でテストが落ちる。

### viewer-maplibre.js
- L1991-1997 の `mapRenderer.projectToScreen` 呼び出しと `hud.riderHudAt(pt.x, pt.y+30, true)` / `hud.riderHudAt(0,0,false)` を、`hud.riderHudVisible(true)` / `hud.riderHudVisible(false)` に置換 (表示/非表示の判定ロジックはそのまま、座標計算だけ除去)。
- 除去により mapRenderer.projectToScreen が他で使われなくなる場合はデッドコード化を確認 (projectToScreen は map3d の差し替え口、メソッド自体は残してよい)。

### index.html
- CSS `#rider-hud` (L65-70): `left:0; top:0` を `left:50%; top:1rem` に変更。`transform:translate(-50%,0)` は維持 (left:50% と合わせて水平中央寄せ)。
- CSS コメント「中央寄せ、top は豆腐の下端」を「画面中央上部に固定」に書き換える (top が豆腐基準でなくなるため)。
- L808 `<script type="module" src="viewer-maplibre.js?v=39"></script>` の `?v=` を bump (sw.js PRECACHE と一致させる、下記)。

### sw.js
- CACHE_NAME と `?v=` を bump。b13-1 も同じ sw.js / index.html L808 を触るため、単一ファイルへの版数は着地順の通し番号で決める: b13-1 着地済みなら b13-1 が v12 / `?v=40` を取っているので b13-5 は `fujihill-v13` / `?v=41`。b13-5 が先着なら v12 / `?v=40` を取り b13-1 を v13 / `?v=41` にずらす。具体値は実装者が着地時に確定。
- index.html L808 の `?v=` と sw.js PRECACHE_URLS の `?v=` を一致させる。`sw_cache_version.test.js` を通す。

## 注意 (= 決め切った仕様)

- `#hud` (左下 time/dist/ele) は指摘対象外、触らない。
- `#rider-hud` と `#hud` の統合 (1パネル化) はユーザー未指示、やらない。
- 中央上部固定で minimap (左上) や course loaded 表示 (右上) と重なる可能性 → 実画面で確認し、重なれば top を微調整。

## 検証

- `npm test`: 改訂した hud.test.js / sw_cache_version.test.js / 全件。
- 画面 (deskpilot): ride 中に `#rider-hud` が画面中央上部に固定表示 / ライダーが course 上を動いても HUD は動かない / minimap や他の隅 UI と重なっていない。

## Round 1 audit 反映

- tick の撤去対象を viewer-maplibre.js L1991-1997 と特定、「要 worker 特定」を解消 (全 reviewer 指摘)。
- hud.js は riderHudAt のインライン left/top 設定が CSS 固定を上書きするため、座標を扱わない riderHudVisible を新設する設計に決め切り (rev-design / rev-migsec 指摘)。
- CSS コメント清掃を変更に明記 (rev-structure 指摘)。
- sw.js bump を追加 (NG-R2-1)。
