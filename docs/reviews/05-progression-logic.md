# 05 進行 logic 軸 ── 水色 marker が変な場所を走る件

対象: `C:/Users/yuuji/fujihc-trainer/web/viewer.js` 全体、特に `tick(t)` (177-235行)。

## 結論先出し

**いちばん怪しいのは「marker を course の頂点 (course[curIdx]) にしか置いていない、頂点と頂点の間を補間していない」こと (line 185, 189)**。
course.json の頂点間隔は 30〜70m あり、走者は 30 m/s で進むので、頂点 1 個分 (= 数十m) を **1〜2 秒かけて curDist だけ前進、画面上の marker は止まったまま、頂点を越えた瞬間にワープ** という動きになる。HUD の dist 値だけが滑らかに増える一方、画面の cyan 点は段階的にジャンプするので「想定外の場所を走っている」「polyline と me がずれている」と見える。

これに加えて、tick 初回の dt が異常に大きくなる問題 (lastT が module load 時刻のままで、初回 tick は flyTo 完了 2.5 秒後) があり、最初の 1 フレームだけ 90m くらい瞬間ワープする副作用もある。

fix 提案は末尾。

---

## 6 軸 step ごとの判定

### Step 1: dt の単位は秒か?

**判定: 概ね OK、ただし初回 dt が爆発する穴あり。**

- line 178: `const dt = (t - lastT) / 1000;`
- `t` は `requestAnimationFrame` callback の引数 = `performance.now()` 系で ms 単位
- `lastT` も line 43 で `performance.now()` で初期化、line 179 で毎フレーム `t` に更新
- なので 2 フレーム連続の dt は普通に「経過秒数」になる。OK
- **問題**: line 43 で `lastT = performance.now()` は module load 時刻、tick 初回呼び出しは line 162 の `flyTo({ duration: 2.5, complete: () => requestAnimationFrame(tick) })` 経由なので **約 2.5 秒後 + course.json fetch 時間**。初回 dt = 2.5〜3 秒前後。`curDist = 0 + playSpeed * dt = 30 * 3 = 90 m` を 1 フレームで進む。直後の HUD と画面位置がいきなり 90m 先に飛ぶ。

### Step 2: curIdx の advance 条件は正しいか?

**判定: 仕様上は OK だが、off-by-one ぽいニュアンスあり。**

- line 184: `while (curIdx < course.length - 1 && course[curIdx + 1].distance_m < curDist) curIdx++;`
- 意図: 「curDist が次の頂点の距離を**追い越したら**curIdx を進める」
- 比較演算子が `<` (strict less than) なので、`curDist == course[curIdx+1].distance_m` ちょうど一致時に curIdx は据え置き
- 浮動小数の話なので実害はほぼ無いが、`<=` の方が意図に近い (= 「次の頂点に到達したら、その頂点を curIdx と見なす」)
- off-by-one それ自体は無い (course.length - 1 で止めるのも正しい、最終頂点を超えて配列外参照しない)

### Step 3: marker 位置と camera target は同じ点か? (lookAhead ずれ)

**判定: target と marker は同じ点で coherent。ただし heading のための nextIdx が +5 先で、camera の「後方」方向が走者の現在進行方向とズレる。**

- line 185: `const p = course[curIdx];` — marker と camera target 両方で使う基準点
- line 189: `riderEntity.position = ...fromDegrees(p.lon, p.lat, p.elevation_m);` — marker は `p` (= course[curIdx]) に置く
- line 200: `const target = ...fromDegrees(p.lon, p.lat, p.elevation_m + 1.5);` — camera target も同じ `p` (高さだけ +1.5m カメラ俯角用)
- line 193: `const nextIdx = Math.min(curIdx + 5, course.length - 1);` — heading 計算は **5 頂点先**を見る
- 結果として camera は「現在地点を target に、現在地点から 5 頂点先を向いた方向の後ろ 10m + 上 4m」に置かれる
- 直線部では問題ないが、急カーブの中では「5 頂点先の方向」≠「今この瞬間の進行方向」なので、camera は走者の真後ろではなく未来カーブの内側 or 外側に流れる。画面上、marker が画面中央でなく左右にずれて見える可能性あり
- ただし「marker が想定外の場所を走る」(= polyline から外れる) という症状の本質的原因ではない、これは camera framing の問題で marker の世界座標は polyline 上に正しく載っている

### Step 4: bridge speed 上書きが curDist を歪めるか?

**判定: 通常運用では OK。ただし bridge が 0 や負値や巨大値を投げると即破綻する gate なし。**

- line 67-73: WebSocket message handler で `playSpeed = msg.speed_mps` をそのまま代入
- 妥当性チェック (例: `>= 0`、`< 30 m/s = 108 km/h` 程度の上限) なし
- bridge が `speed_mps: 0` を送ったら走者が止まる (HUD は `0.0 (bridge)` を表示するので user が気付ける)
- bridge が `speed_mps: 1000` のような bogus 値を送ったら 1 秒で 1km 進む = course 全体を秒で完走、marker が一瞬で goal に飛ぶ
- bridge が負値を送ったら `curDist` が逆走、curIdx は while 条件で advance できず据え置き → marker が start 付近で停止、HUD だけマイナス値 (curDist が負になる)
- 「marker が変な場所を走る」の症状が bridge 接続時のみ出るなら、ここを疑え。bridge 未接続時 (test mode, playSpeed=30) は対象外

### Step 5: reset / pause / fast / slow の組み合わせ穴

**判定: 致命的な desync は見当たらない。reset 後の挙動に小さな穴。**

- line 238 pause: `paused = !paused;` — line 180-182 で paused 中は curDist 更新 skip、line 179 で `lastT = t` は毎フレーム更新されるので **pause 解除時の dt 爆発は起きない**。OK
- line 239 slow: `playSpeed = Math.max(5, playSpeed - 10);` — 下限 5 m/s、OK
- line 240 fast: `playSpeed = Math.min(200, playSpeed + 10);` — 上限 200 m/s = 720 km/h、上限としては緩いが logic 上 OK
- line 241 reset: `curDist = 0; curIdx = 0;` — riderEntity.position は次の tick で 0 番頂点に戻る、OK
- **穴1**: 完走後 (curDist >= totalDist) は line 230-234 で次の `requestAnimationFrame(tick)` が呼ばれないので tick ループが停止。完走後に reset を押しても tick が再起動せず、HUD は 0 表示だが画面は完走時のまま。**user は「reset 効いてないじゃん」と感じる**
- **穴2**: bridge 接続中に reset 後、bridge からの次の `speed_mps` が来るまで `playSpeed` は reset 前の値 (bridge から最後に来た値) のまま。bridge は速度を「再送」しないと sync しないが、bridge.py 側の挙動次第なのでここでは判定保留

### Step 6: camera lookAhead と marker 位置のずれで「変な場所」感

**判定: camera の構図上、marker は画面中央寄りに表示される設計だが、heading が +5 頂点先・atan2 が経緯度を直接使っているのでカーブ部で marker が画面センターから流れる可能性あり。**

- line 196: `const travelHeading = Math.atan2(dLon, dLat);`
- **隠れた問題**: 北緯 35.45° (course の中心緯度) では 1° 経度 ≈ 91 km、1° 緯度 ≈ 111 km。`dLon` と `dLat` を degrees のまま比較しているので、純粋に経度方向の移動 (= 真東) と純粋に緯度方向の移動 (= 真北) で、同じ距離でも `dLon` のほうが約 1.22 倍大きく出る。結果として heading が「東寄りに偏った」値を返す。具体的には、本当の進行方向が北東 (45°) のとき、計算は `atan2(dLon, dLat)` だが `dLon ≈ 1.22 * dLat` (本来等しいべき) なので、計算される heading は 50.6° (= 5.6° 東寄り)
- camera position は line 204 で ENU フレームの `(-sinH * 10, -cosH * 10, 4)` = 進行方向の後方 10m、上 4m。heading に 5°〜 のずれがあると、camera は走者の真後ろから 5° 横方向 (= 走者の真横よりちょい後ろ) にズレる
- 体感としては「走者の真後ろから車載カメラ視点」のはずが「やや斜め後ろから」になる。走者の進行方向と画面の進行方向がずれるので、polyline は画面奥に向かって伸びてるのに me marker は画面の端のほうで赤線から外れて見える可能性
- これだけだと数 % のずれで「変な場所」と言うほどではないが、Step 3 の +5 頂点先 lookAhead と組み合わさってカーブ部で増幅される

---

## bug 仮説 list (確度付き)

1. **【確度 高】marker は course の頂点にしかいない、頂点間補間なし** (line 185, 189) ── 頂点間隔 30〜70m の course を 30 m/s で走るので、marker は 1〜2 秒間止まって次の頂点へワープ。HUD dist は連続値で進むので「HUD と画面位置がズレる」「marker が polyline 上を滑らかに走らない」が直接の症状になる。**本本命**。
2. **【確度 中】tick 初回 dt が 2.5 秒越え、最初に 90m ワープ** (line 43, line 162-163) ── 起動直後だけ marker が start から離れた位置に瞬間移動。「変な場所から始まる」症状の説明として有力。
3. **【確度 中〜低】camera heading が +5 頂点先で取得されていて、急カーブで marker が画面センターから外れる** (line 193) ── 「変な場所」というより「画面の中央にいるべき marker が左右に流れる」症状の側。
4. **【確度 低】heading 計算が経緯度を degree のまま使うので緯度に応じて偏る** (line 196) ── 北緯 35° で 22% スケール差、heading は 5°〜 ずれる。Step 3 と相乗。
5. **【確度 低、bridge 接続時のみ】bridge speed_mps を validation なしに `playSpeed` 上書き** (line 70-73) ── bridge が異常値を送れば走者がワープ。test mode では発火しない。
6. **【確度 低】完走後 reset で tick が再起動しない** (line 230-234, line 241) ── reset したのに動かない症状、進行 logic というより control flow の穴。

---

## 最も疑わしい 1 個 + fix 提案

### 最も疑わしいのは **仮説1: 頂点間補間なし**

course.json の最初の数頂点を見ると distance_m = 0, 30.58, 62.21, 70.46, 84.55, 109.94, ... と進む。**1 頂点あたり 10〜30m 間隔、稀に 50〜70m**。
playSpeed = 30 m/s なら、頂点間 30m = 1 秒、70m = 2.3 秒。
この間 marker は完全に静止、curDist だけ HUD で増え続け、次の頂点に到達した瞬間に marker が 70m ジャンプ。
**「走者が止まる→ワープ→止まる→ワープ」** という滑らかでない動きが「想定外の場所を走る」と認識されている可能性が極めて高い。

### fix 提案 (tick 関数内、line 185-190 を補間版に置き換え)

```diff
   // advance index
   while (curIdx < course.length - 1 && course[curIdx + 1].distance_m < curDist) curIdx++;
   const p = course[curIdx];

+  // 頂点間を curDist で線形補間して滑らかな現在位置を作る
+  // (頂点 curIdx と curIdx+1 の間に curDist がいる前提、curIdx 進行ロジック直後なので必ず満たす)
+  let rLon = p.lon;
+  let rLat = p.lat;
+  let rEle = p.elevation_m;
+  if (curIdx < course.length - 1) {
+    const q = course[curIdx + 1];
+    const segLen = q.distance_m - p.distance_m;
+    if (segLen > 1e-6) {
+      const f = Math.max(0, Math.min(1, (curDist - p.distance_m) / segLen));
+      rLon = p.lon + (q.lon - p.lon) * f;
+      rLat = p.lat + (q.lat - p.lat) * f;
+      rEle = p.elevation_m + (q.elevation_m - p.elevation_m) * f;
+    }
+  }
+
   // 現在位置アイコンを更新
   if (riderEntity) {
-    riderEntity.position = Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.elevation_m);
+    riderEntity.position = Cesium.Cartesian3.fromDegrees(rLon, rLat, rEle);
   }
```

camera target も同じ補間値を使うのが筋なので、line 200 も差し替えるべき:

```diff
-  const target = Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.elevation_m + 1.5);
+  const target = Cesium.Cartesian3.fromDegrees(rLon, rLat, rEle + 1.5);
```

これで marker は curDist に追従して滑らかに移動、polyline 上を連続的に走る。HUD と画面位置のずれが解消。

### 副次 fix (仮説 2: 初回 dt 爆発)

`tick` の最初の呼び出し直前で `lastT` を更新するのが最小修正。具体的には line 162-163 の flyTo complete callback で:

```diff
     complete: () => requestAnimationFrame(tick),
+    complete: () => { lastT = performance.now(); requestAnimationFrame(tick); },
```

これだけで 90m ワープが消える。優先度は仮説1 fix の次。

---

## 補足: 仮説 3, 4 (heading のずれ) について

仮説 3 (+5 頂点先 lookAhead) は「marker が画面中央でなく端に表示される」体感問題の原因にはなるが、marker の世界座標 (= polyline 上のどこに me がいるか) はあくまで `course[curIdx]` (修正後は curIdx と curIdx+1 の補間点) で正しい。
仮説 4 (経緯度直接 atan2) は heading 精度 5°〜 のずれ、camera 構図の小ずれであり、marker 位置自体は polyline 上で動く。

「**polyline と me が画面上で乖離して見える**」 と user が言っているなら仮説 1 が本命、
「**走者の真後ろから見たいのに斜め後ろから見えている**」 なら仮説 3 + 4 が本命。
両方症状があるなら仮説 1 → 3 → 4 の順に直すのが効く。
