# タスク (確定版): 3D コースリボンを区間ごとのフラット塗りに直す

> 改訂履歴: 草案を multi-axis-draft-audit の 7 軸並列監査にかけ、LOAD-BEARING 9 件で
> REDRAFT した確定版。主要な訂正 = (1) 第一候補だった「de-index (頂点複製)」は rider
> 配置を静かに壊すため却下し「区間ラン単位の geometry group + bin ごと単色 material」を
> 採用に確定、(2) 区間代表勾配を MapLibre 版 SoT と同じ終点 slope に確定、(3) 既存テスト
> 件数を実数 18 に訂正し落ちるテストを行番号で名指し、(4) `## 用語` `## 参照` を新設。
>
> 実装時の user 指示による方針転換 (= 本文の classifyGrade / 終点 slope 記述を上書き、
> commit 832dbc2 / drift catalog の task-course-tiles-flat Round 1 参照):
> (a) 配色は `classifyGrade` (6 段階) ではなく `gradeColorContinuous` (0.5% 勾配刻みの
> 連続ランプ、実コースで 35 色) を使う。
> (b) 区間 i の代表勾配は終点 `course[i+1].slope_pct` ではなく始点 `course[i].slope_pct`
> を使う ── slope_pct は course.py 曰く「点に入る後方平滑勾配」で viewer の HUD も
> course[i].slope_pct を使うため、始点で塗らないと色が勾配区間より 1 区間後ろにずれる。

## はじめに -- 前回の手当てが見た目に出なかった

直前のコミット b2eef1b「3Dコースリボンの配色を連続グラデーションから離散ビンに
戻す」は、各 course 点の頂点色を gradeColorContinuous から classifyGrade().color
(6 段階の離散色) に差し替えた。色の「値」は離散になった。だが実画面はまだ滑らかな
グラデーションのまま -- 実 viewer を desk_capture で観て確認済み (緑->黄->橙->赤が
地続きで混ざっている)。

理由は描き方にある。3D リボンは Three.js のメッシュで、隣り合う 2 つの course 点を
1 つの帯 (= 区間) として描く。今は 1 本の Mesh + 頂点色 material (vertexColors:true)
で、区間の色は両端の course 点の頂点色を三角形の面の上で GPU が線形補間 (混色) して
塗る。だから頂点色を 6 段階に丸めても、隣の点と色が違えばその区間は 2 色の
グラデーションになる。course 点は密 (約 1968 点 / 24km) なので、bin をまたぐ区間が
連なって全体が滑らかに見える。

MapLibre 版がタイル状に見えたのは、道路 polygon を区間ごとに 1 色のべた塗りで描き、
区間の境目で色がガクッと不連続に切り替わっていたから。3D でも同じ「区間を 1 色で
塗り、bin が変わる区間境界で色を不連続にする」を作るのがこのタスク。

前回のブリーフの誤り (= この確定版が正す設計判断): 前回の確定版ブリーフは「変えるのは
頂点色だけ。リボンの形状もメッシュも触るな」と縛った。この縛りがそのまま失敗の原因。
頂点色を 1 本の Mesh で補間する描き方を変えない限り、色の値を離散にしても混色は消えない。
今回は「色の値」ではなく「描き方 (区間ごとに色を適用する仕組み)」を変える。

## 用語

監査で「同一概念に 7 語が散在」と指摘されたため、語を固定する。本ブリーフは下記語のみ使う。

- **区間** = 隣り合う course 点 `course[i]` と `course[i+1]` の間の帯。`buildCourseRibbon`
  (terrain3d.js) の index ループ 1 周ぶん (= 2 三角形 / 6 index)。course 点が n 個なら
  区間は n-1 個。MapLibre 版 `buildGradeColoredRoute` (route_styling.js) の segment と同概念。
- **グレード bin** = `classifyGrade` が slope_pct を分類する 6 段階 (flat / gentle /
  moderate / hard / very_hard / extreme)。閾値と色は `GRADE_THRESHOLDS`。
- **区間フラット塗り** = 1 区間を 1 つのグレード bin 色のべた塗りで描き、区間の中で
  色を混ぜない描き方。MapLibre 版で「タイル状」に見えた塗り方のこと。本タスクの目標。
- **段差** = グレード bin が変わる区間境界で、色が補間されず不連続に切り替わること。
- **区間ラン** = 同じグレード bin 色が連続する区間のまとまり。描画の最小単位 (後述)。

「べた塗り」「単色」「タイル状」「1 色フラット」等の揺れ語は以後使わない。

## 目標 (達成条件)

3D コースリボンが、MapLibre 版と同じ区間フラット塗りで描かれて見えること:

- 1 区間は 1 つのグレード bin 色のべた塗り。区間の中で色が混ざらない。
- グレード bin が切り替わる区間境界で段差 (色の不連続) が出る。滑らかに溶けない。
- 色と bin 閾値は MapLibre 版と同一 = `web/lib/route_styling.js` の `classifyGrade()` /
  `GRADE_THRESHOLDS` (flat 緑 #3aa055 / gentle 黄緑 #a3c853 / moderate 黄 #f4d03f /
  hard 橙 #e67e22 / very_hard 赤 #e74c3c / extreme 紫 #8e44ad) を import して使う。
  `course_ribbon3d.js` に色定数・閾値を新規定義するな。
- リボンの見た目の形状 (位置・幅・地形追随) は前と同一。位置がズレた・幅が変わった・
  地面に埋まった、は不可。

### なぜ離散 6 bin に戻すのか (= 設計判断の中段)

`route_styling.js:60-64` は、2026-05-17 に配色を 6 bin の離散から 0.5% 刻みの連続ランプ
(`gradeColorContinuous`) に変えた経緯を明記している ── 「旧 6 段階では road がほぼ
緑〜黄〜橙の狭い帯にしか見えなかった」。富士ヒルの実勾配は 0〜10% に集中するため、
6 bin だとコース全体が moderate / hard の 2 色程度に潰れる (b2eef1b の desk_capture でも
配色クラスタが moderate / hard の 2 ピークだった)。

それでも今回 6 bin の `classifyGrade` に戻すのは、user が**色の解像度より「区間ごとに
はっきり段差で読める」見やすさを優先する**と判断したから。連続ランプは勾配差を豊かな
色変化で見せられるが、隣接区間がほぼ同色に溶けて「どこで勾配が変わったか」が読み取り
にくい。本タスクはこのトレードオフ ── 勾配差の色解像度を捨て、区間境界の段差を得る
── を意図的に選ぶ。`gradeColorContinuous` は他 module (road_polygon.js / road_texture.js)
が使い続けるので route_styling.js には残す。3D リボンだけが `classifyGrade` を使う。

## 実機構 -- 区間色の消費側 (壊してはいけない依存)

`createCourseRibbon` が返す `mesh.geometry` の **position 属性は、配色とは別の機能から
消費されている**。配色の直し方がこの属性のレイアウトを変えると、無関係に見える機能が
静かに壊れる。実装前にこの依存を頭に入れろ。

- `web/lib/map3d/index.js:406` および `:514` で
  `ribbonPositions = ribbon3d.mesh.geometry.getAttribute('position').array` と、
  リボン mesh の position 属性をそのまま rider 配置の入力に取り出している
  (コメント:「buildCourseRibbon を二重に呼ばない」)。
- その `ribbonPositions` は `rider3d.updatePose(ribbonPositions, course, distanceM)`
  (index.js:434/456/516/536) -> `rider_mesh3d.js` -> `rider_placement.js` の
  `riderPlacementAtDistance` -> `ribbonCenterAt(positions, i)` に渡る。
- `ribbonCenterAt` (rider_placement.js:23-36) は
  `pointCount = Math.floor(positions.length / 6)` で点数を出し、`i*2*3` で左頂点・
  `(i*2+1)*3` で右頂点を引く。**つまり「position 属性 = course 点 i ごとに左右 2 頂点
  (2i / 2i+1)、長さ n*2*3」というレイアウトを前提にしている**。
- さらに `index.js:531-532` の `setRoadHeight` は `ribbonPositions` を stride 3 で
  in-place に走査して Y を加算する。これも position 属性がリボン頂点そのものである
  前提。

帰結: position 属性の頂点数・並びを変える直し方を採ると、ユニットテスト
(`rider_placement.test.js` は手書き配列で通る) は緑のまま、**実画面で rider が
コース上の誤った位置に出る / カメラが追従先を失う**。これは「テスト緑・画面崩壊」型の
事故で、完了報告の desk_capture 目視でしか捕まらない。

## 採る方式と、却下する方式

リボンを区間フラット塗りにする方式は 2 つある。**監査の結論で (採用) に確定済み**。

### 採用: 区間ラン単位の geometry group + グレード bin ごとの単色 material

- メッシュの **頂点配列 (position) と index は `buildCourseRibbon` の出力そのまま、
  一切変えない** (= n*2 頂点、(n-1)*6 index)。
- 1 本の Mesh に **material の配列**を持たせ、各 material は
  `MeshBasicMaterial({ color: bin色, side: DoubleSide })` の単色 (vertexColors を使わない)。
- `geometry.addGroup(start, count, materialIndex)` で index バッファを区間ラン単位に
  分割し、各ランにその bin 色の material を割り当てる。
- 単色 material はその group の全三角形を一様な色で塗る ── 頂点が隣の区間と共有
  されていても、色は material の uniform なので**補間が起きない**。区間境界は material
  が切り替わる所でピクセル単位に不連続 = 段差。MapLibre 版と同じ見え。
- position 属性は n*2*3 のまま不変 -> 上記「実機構」の rider 配置・setRoadHeight は無傷。
- 頂点を複製しないので `conformRibbonToMesh` の地形追随も無改造でそのまま効く。

### 却下: de-index (頂点を区間ごとに複製)

頂点色 material で区間ごとに別色を塗るには区間が頂点を共有しないよう複製 (de-index)
する必要がある。だが de-index は position 属性を n*2 頂点から (n-1)*4 頂点へ変える。
すると上記「実機構」の `ribbonCenterAt` の `positions.length/6` も `i*2*3` も成立せず、
rider 配置が壊れる。それを直すには index.js / rider_placement.js も変える必要があるが、
**本タスクの担当ファイルは course_ribbon3d.js だけ (別 worker 稼働中、他ファイル厳禁)**。
よって de-index は採れない。採用方式は course_ribbon3d.js 内で完結する。

## リポジトリ

- `C:\Users\yuuji\fujihc-trainer`、ブランチ `b11-phase5-tile-cache`。ローカル commit
  まで、git push 禁止。
- viewer は http://127.0.0.1:8000/ で配信中 (既存サーバ稼働、bridge を二重起動するな)。
- 触ってよいファイルは 2 つだけ: `web/lib/map3d/course_ribbon3d.js` と
  `web/tests/course_ribbon3d.test.js`。それ以外 (index.js / rider_placement.js /
  route_styling.js / terrain3d.js / 別 worker の作業ファイル) は読むのは可、変更厳禁。

## やること

1. `web/lib/map3d/course_ribbon3d.js` と、依存 (`buildCourseRibbon` in terrain3d.js、
   `classifyGrade` / `GRADE_THRESHOLDS` / `buildGradeColoredRoute` in route_styling.js)
   を読め。上記「実機構」「採る方式」を実コードで裏取りしてから着手。

2. **区間の代表勾配 -> グレード bin 色の純関数**を作る (例: `ribbonSegmentBins`)。
   - 入力 = course 点列、出力 = 長さ n-1 の hex 色文字列配列 (区間 i の色)。
   - 区間 i (`course[i]`->`course[i+1]`) の代表勾配は **`course[i+1].slope_pct`
     (終点 = 次区間の勾配)** を採る。これは MapLibre 版 SoT `buildGradeColoredRoute`
     (route_styling.js:139-155) が区間色に使う値と**同一**。`buildGradeColoredRoute`
     の fallback も踏襲しろ: `course[i+1].slope_pct` が null/undefined/NaN なら
     `course[i].slope_pct`、それも無効なら 0。その slope を `classifyGrade(slope).color`
     に通す。始点 slope や中点 slope を採ると MapLibre 版とセグメント色が 1 点ぶん
     ズレ「色は MapLibre 版と同一」の目標を外す ── 採るな。

3. **区間色配列 -> geometry group 配列の純関数**を作る (例: `ribbonColorGroups`)。
   - 入力 = 2 の出力 (区間色 hex 配列)、出力 = `{ start, count, color }` の配列。
     `start` / `count` は index バッファ上の位置 (区間 i は index `[i*6, i*6+6)`)。
   - 同じ色が連続する区間をまとめて 1 つの区間ランにする (= group 1 つ)。
   - 不変条件: 全 group の `start` と `count` は 6 の倍数 (区間境界に揃う、group が
     区間を分断しない)。group は index 0 から隙間なく連続し、`count` の総和は
     `(n-1)*6` (全区間が必ずどれかの group に入り描画される)。

4. `createCourseRibbon` を採用方式に書き換える。`createCourseRibbon` は数値ロジックを
   持たず 2・3 の純関数の出力を Three.js に詰めるだけの glue に保て。
   - `buildCourseRibbon` -> `conformRibbonToMesh(ribbon.positions, ...)` の順は現状維持
     (position は n*2 頂点のまま conform する。複製しないので順序の曖昧さは無い)。
   - geometry に position (n*2*3) と index ((n-1)*6) を現状どおり setAttribute / setIndex。
     **頂点色 (color) 属性はもう使わないので setAttribute しない。**
   - 区間色 (2) -> group 配列 (3) を得て、出現する bin 色ごとに
     `MeshBasicMaterial({ color, side: DoubleSide })` を 1 つ作る (同色 group は
     material を共有、material 数 <= 6)。各 group を
     `geometry.addGroup(start, count, materialIndex)` で登録。
   - `new THREE.Mesh(geometry, materials配列)` で mesh を組む。
   - `dispose()` は geometry と **配列の全 material** を解放する。

5. `conformRibbonToMesh` は無改造。地形追随 (task F の「2m まで下げても埋まらない」
   挙動) は position 属性が n*2 のまま変わらないので維持される ── テストで pin する
   (下記)。

6. テストを直す / 足す (下記「テスト」)。

7. 真正性確認 (下記)。

## 不可侵 (壊すな)

- **`createCourseRibbon` の戻り `mesh.geometry` の position 属性は長さ n*2*3、
  並びは「course 点 i -> 頂点 2i (左) / 2i+1 (右)」のまま保て。** index も (n-1)*6 の
  まま。これを崩すと「実機構」の rider 配置 (`rider_placement.js` の `ribbonCenterAt` /
  `riderPlacementAtDistance`) と `setRoadHeight` が静かに壊れる。
- リボンの見た目の位置・幅・地形追随を変えるな。変えるのは色の塗り方 (1 本 Mesh +
  頂点色補間 -> group + bin ごと単色 material) だけ。
- `route_styling.js` の `classifyGrade` / `GRADE_THRESHOLDS` / `gradeColorContinuous` /
  `buildGradeColoredRoute` の本体を改変・削除するな。リボンは `classifyGrade` /
  `GRADE_THRESHOLDS` を import して使う。
- `web/lib/terrain3d.js` は無改造。理由は配布元配慮ではない (terrain3d.js は fetch を
  持たない純関数群、配布元配慮の対象は tile_loader3d.js / bridge.py)。無改造の理由は
  `web/tests/terrain3d.test.js` が pin 済のテスト済 SoT であり、`buildCourseRibbon` の
  出力契約 (n*2 頂点 / (n-1)*6 index) を本タスクが前提にしているから。
- `bridge.py` / `tile_loader3d.js` は触るな。地図タイル配布元配慮ルールを破るな。

## テスト

対象 = `web/tests/course_ribbon3d.test.js` (現状 **18 件** ── `describe('ribbonVertexColors')`
10 件 + `describe('createCourseRibbon')` 6 件 + `describe('createCourseRibbon — 地形メッシュ
追随')` 2 件)。草案の「13 件」は誤り、必ず実ファイルを数えて確認しろ。

採用方式は `ribbonVertexColors` (course 点ごとの頂点色) を廃し `ribbonSegmentBins` /
`ribbonColorGroups` (区間ごとの色 / group) に置き換える。下記のとおり書き換える。
落とすために書き換えるのではなく、新しい正しい挙動を pin するよう書き換える。

### 書き換える既存テスト (新方式で構造が変わり、そのままでは落ちる)

`describe('ribbonVertexColors')` の 10 件 (L77/L81/L91/L102/L110/L121/L129/L137/L147/L156)
は `ribbonVertexColors` 廃止に伴い全て対象。意図を新関数に移植する:
- L91「色が classifyGrade と一致」-> `ribbonSegmentBins`: 区間 i の色が
  `classifyGrade(course[i+1].slope_pct).color` と一致。
- L102「勾配が違えば色も違う」、L110「欠損点は flat」、L129「2 点未満 RangeError」
  -> `ribbonSegmentBins` に移植。
- L137「同一 bin 内は同色」、L147「bin 境界で段に切り替わる」、L156「GRADE_THRESHOLDS
  境界値 1/4/7/10/15% で色が変わる (min inclusive / max exclusive、4.0% は moderate)」
  -> `ribbonSegmentBins` + `ribbonColorGroups` に移植。境界値テストは名指しの
  1/4/7/10/15% を維持。
- L77「長さ」、L81「左右頂点同色」、L121「成分 0..1」は頂点色配列前提のテスト。
  L77 は `ribbonSegmentBins` の長さ = n-1 に置換。L81 (片側だけ色違いバグ検出) は
  区間単位の単色化で構造的に消える概念なので削除。L121 は色が hex 文字列になるため
  「成分 0..1」は無意味、削除。

`describe('createCourseRibbon')` の 6 件:
- L182「index 長 = (n-1)*6」-> **変更不要、そのまま緑を維持** (index は不変)。
- L176「position / color attribute 長 = n*2*3」-> position 部分は **n*2*3 を pin
  したまま維持** (rider 安全性の pin、消すな)。color 属性は廃止したので color 部分は
  削除。
- L170「mesh は BufferGeometry + MeshBasicMaterial」、L187「material 頂点色 ON +
  DoubleSide」、L193「color 属性の中身」、L199「dispose」-> 採用方式に書き換え:
  material は MeshBasicMaterial の**配列**、各 material は単色 (vertexColors を
  持たない) + DoubleSide、geometry.groups が `ribbonColorGroups` の出力と一致、
  dispose で geometry と全 material が解放。

`describe('createCourseRibbon — 地形メッシュ追随')` の 2 件 (L230 埋まり / L267 step1
drape) -> **position 属性は n*2*3 のまま、`conformRibbonToMesh` は無改造なので、この
2 件は変更不要でそのまま緑を維持する**。緑のまま通ることを実走で確認し、もし落ちたら
それは position レイアウトを壊した証拠 ── その時は不可侵違反、設計に戻れ。

`mockThree()` (L47) は `BufferGeometry` に `addGroup(start,count,matIndex)` メソッドと
`groups` 配列を足す。`Mesh` は material 配列をそのまま受ければよい (現状の mock で可)。

### 足すテスト (区間フラット塗りの本質を pin)

- `ribbonColorGroups`: 全 group の `start` / `count` が 6 の倍数 (= 1 区間が group を
  またがず単色)。group が index 0 から連続し `count` 総和 = (n-1)*6 (= 全区間が描画
  される、塗り残しなし)。
- `ribbonColorGroups`: 同一 bin の連続 2 区間が 1 つの group にまとまる (= 区間ラン)。
- `ribbonColorGroups`: bin をまたぐ隣接 2 区間が別 group・別色 (= 段差)。
- `createCourseRibbon`: 区間 i の 6 個の index がちょうど 1 つの material に対応し、
  その色が区間 i の期待 bin 色 (= `classifyGrade(course[i+1].slope_pct).color`) と一致。

`route_styling.test.js` の既存テストは触るな、全 green 維持。

役割分担: 区間色の数値的正しさ・group 構造・区間が単色か は vitest。実画面が区間
フラット塗りに見えるか・段差があるか は desk_capture 目視。e2e に配色テストは足すな、
既存 e2e を壊さないことだけ確認。

## 真正性確認 (必須)

区間フラット塗りのロジックを 1 箇所わざと壊して `npm test` が落ちることを手元で
1 回確認 -> 戻す。壊し方は「まさに防ぎたい回帰」= **1 区間を 2 色にして混色を復活
させる**: `ribbonColorGroups` (または `createCourseRibbon` の group 登録) を、区間 i の
6 index を 2 つの group ([i*6, i*6+3) と [i*6+3, i*6+6)) に割り、前半を
`classifyGrade(course[i].slope_pct).color`、後半を
`classifyGrade(course[i+1].slope_pct).color` にする。これで 1 区間が始点色と終点色の
2 色になる (= 段差を作らず区間内で色が変わる状態に逆戻り)。

この壊しで「全 group の start/count が 6 の倍数」「区間 i の 6 index が 1 material」の
テストが落ちることを確認しろ。落ちないならテストが真正でない、書き直し。確認したら
壊しを戻し、`git diff web/lib/map3d/course_ribbon3d.js` と
`git diff web/tests/course_ribbon3d.test.js` で意図した差分以外が無いこと
(壊しの戻し漏れゼロ) を確認してから commit。

## 検証

- `npm test` (vitest)、`npm run test:e2e` (Playwright)、`python -m pytest` を全て
  走らせ全 green。passed / failed / skipped 数を報告。
- desk_capture で実画面を観て批評しろ。期待する最終 state を先に言語化する:
  「コースリボンが区間ごとに 1 つのグレード bin 色 (緑 / 黄緑 / 黄 / 橙 / 赤 / 紫)
  のべた塗りで描かれ、bin が変わる区間境界で色が段差で不連続に切り替わり、各区間の
  中は 1 色」。viewer を映した通常 Chrome タブを用意し、リボンが見える state まで
  到達させてから desk_capture し、撮った画像を Read tool で開いて目で見ろ。
  滑らかなグラデーションが残っていたら未完。前回 b2eef1b はここで「離散ビンにした」と
  言いつつ画面はグラデーションのままだった -- 同じ見落としをするな。段差が「ある」か
  「無い」かを断定しろ。
  - 注意 (catalog の既知パターン): Three.js は色を sRGB 変換するため、画素値は詰めた
    hex (#f4d03f 等) とそのまま一致しない。判定は「段差があるか / 区間内が単色か」で
    行え、画素の hex 一致で判定するな。
- 真正性確認の結果 (壊して落ちたテスト名、戻したこと) を報告。

## 制約 (環境・運用)

- 画面確認は desk_capture のみ。`chrome --headless` 直叩きも `headless-shot.ps1` も
  使うな (viewer は never-idle で headless が固まり worker ごと全滅する)。viewer を
  映した通常 Chrome ウィンドウが無ければ自分で 1 回だけ通常タブで
  `http://127.0.0.1:8000/?test=1&consent=dev` を開いてから desk_capture。desk_capture
  が誤サイズ / outside bounds を返したら PowerShell の ShowWindow 最大化 +
  CopyFromScreen 全画面 PNG -> 必要領域を crop、で代替してよい。
- `course_ribbon3d.js` は `.js` = `sw.js` の `isAppShell` で network-first 配信
  (`sw.js` の `/\.(html|js|css)$/`)。online の限り常に最新が届くため CACHE_NAME bump
  不要。
- 作業ツリーには別 worker の未 commit 変更がある (rails-app/ / web/inertia-sim.html /
  web/terrain3d.html / scripts/ 等)。自分が触らないファイルに触れるな。commit は自分が
  触った 2 ファイルだけを `git commit -- web/lib/map3d/course_ribbon3d.js
  web/tests/course_ribbon3d.test.js` の一発でやれ (git add と git commit を分けるな、
  `git add -A` 禁止)。
- ローカル commit まで。git push 禁止。

## 参照

- Three.js BufferGeometry: https://threejs.org/docs/#api/en/core/BufferGeometry
- BufferGeometry.addGroup / .groups (index バッファの material 別分割):
  https://threejs.org/docs/#api/en/core/BufferGeometry.addGroup
- Mesh の material 配列 (multi-material): https://threejs.org/docs/#api/en/objects/Mesh
- MeshBasicMaterial (陰影なし単色 material): https://threejs.org/docs/#api/en/materials/MeshBasicMaterial
- 配色 SoT: `web/lib/route_styling.js` (`classifyGrade` / `GRADE_THRESHOLDS` /
  `buildGradeColoredRoute`)
- メッシュ生成元: `web/lib/terrain3d.js` の `buildCourseRibbon`
- 差し替え対象: `web/lib/map3d/course_ribbon3d.js`、テスト
  `web/tests/course_ribbon3d.test.js`
- 区間色の消費側 (壊すな): `web/lib/map3d/index.js` / `web/lib/rider_placement.js` /
  `web/lib/map3d/rider_mesh3d.js`

## 完了報告

採用方式 (group + bin ごと単色 material) で実装したこと、区間の代表勾配を終点 slope
(`course[i+1].slope_pct`、MapLibre 版 `buildGradeColoredRoute` と同一) にした旨、直した
ファイル、position 属性を n*2*3 に保ち rider 配置を壊していないこと、`conformRibbonToMesh`
の地形追随が生きていること (地形追随テスト 2 件が無改造で緑)、書き換えた既存テストと
足したテスト、真正性確認の結果、desk_capture の実画面観察と批評 (段差があるか無いかを
断定)、`npm test` / `npm run test:e2e` / `python -m pytest` の passed / failed 数。

## まとめ

前回 b2eef1b は色の「値」を離散化したが「描き方」(1 本 Mesh + 頂点色補間) を変えず、
混色が残った。今回は描き方を変える ── index バッファを区間ラン単位に分割し、各ランに
グレード bin の単色 material を割り当てる。頂点配列・index・position レイアウトは
不変なので、rider 配置も `conformRibbonToMesh` の地形追随も無傷。区間代表勾配は
MapLibre 版 SoT と同じ終点 slope を使うので、3D リボンの区間色は MapLibre 版と一致する。
これでコースリボンは MapLibre 版と同じ、段差のある区間フラット塗りになる。
