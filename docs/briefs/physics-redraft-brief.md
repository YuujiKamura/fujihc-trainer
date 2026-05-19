# 富士ヒルクライム viewer ── 自転車物理モデル統合の redraft

## はじめに

お前は fresh context の Claude Code session。`C:\Users\yuuji\fujihc-trainer` が cwd。
仕事は、今週作って検証済みの自転車物理モデルを富士ヒル viewer に**正しく**統合し、
rider が実際にコースを物理で前進し、それを**実画面で目視確認**できる状態にすること。

前回までは Agent tool の subagent でやってコンテキストが薄切りすぎ、ハリボテ
(= テスト緑なのに画面が動かない) を量産した。お前は full context で、root-cause
から通しで直し、実画面で「進む」のを見届けてから完了と言え。

## これまでの経緯

- fujihc-trainer = 富士ヒルクライムを室内トレーナーで再現する webapp。
- 今週: 自転車物理モデルを `web/lib/bike_physics.js` に実装 (`applyPhysicsStep`、
  フライホイール慣性 / 転がり抵抗 c_rr / 空気抵抗 CdA 入り)。
- それを単独 3D シミュレータ `web/inertia-sim.html` で検証。整備不良車〜世界記録TT〜
  プロの登坂まで全レンジで現実と一致。**シミュは動く、これがリファレンス**。
- 物理を本体 viewer `web/viewer-maplibre.js` に統合 (commit ab7d89f, 02b03ae)。
  だが viewer が壊れていた。
- loadCourse 起動不全を修正 (commit 38fa121) + SW キャッシュ版数 bump (ea31253)。
  viewer は今は起動する。HEAD は ea31253。

## 現状の問題 (実画面で検証済み)

1. **dist=0 [最優先]**: `?consent=dev&map=1` で起動すると、HUD に speed 20km/h /
   power 150W が出ているのに bottom HUD の `dist` が 0 のまま増えない。rider が
   コース上を 1m も進んでいない。物理が「速度の数字」止まりで「コース上の前進」に
   なっていない。これを直さないと物理フィードバックは機能していない。
   - 手がかり: `web/viewer-maplibre.js` の `tick()` (2222行付近) が `rider.tick(dt, ...)`
     を呼び `snap.distance` を `dist` HUD に出す。MAP_MODE の fake state generator
     (`initMapMode`, 1663行付近) は `snap.active && !snap.paused` の時だけ power 150 を
     出す。`wsHandlers.state` (620行付近) が `applyPhysicsStep` で `physicsSpeedMps` を
     積分し `rider.setSpeed()` に渡す。rider が前進しない原因をこの経路から root-cause しろ。

2. **7軸レビューの指摘 (REDRAFT必須)**:
   - **テストの嘘**: `web/tests/viewer_physics_drive.test.js` 15件中9件が、本物の
     `wsHandlers.state` を一度も呼ばず、テスト内に手コピーした `viewerStateStep` /
     `stateStep` を叩くだけ。本物が壊れてもテストは緑のまま。「テスト緑なのに画面が
     動かない」の構造的犯人。
   - **SoT 3重複**: 物理積分の substep loop (1/120秒刻み) + dt クランプ + パラメータが、
     viewer の `wsHandlers.state` 直書き / テストのコピー / `inertia-sim.html` の step()
     の3箇所に重複。
   - **マジックナンバー**: `{mass:88, c_rr:0.005, c_d:0.35, area:1}` が viewer に
     直書きで、`bike_physics.js` の DEFAULTS (c_d:0.88 / area:0.4) と食い違う。

3. **3D地形が平ら**: GSI 標高タイル (`web/static/tiles/gsi_dem/14/*.png`) の読み込みが
   失敗し地形メッシュが平ら。アセット欠落かコード経路かを調査 ── ただし深追いするな、
   dist=0 と redraft が優先。原因だけ報告でも可。

## やること

1. **dist=0 を root-cause して直す**。rider がコースを前進する経路を追い、なぜ
   `snap.distance` が 0 のままかを突き止めて直す。物理フィードバックの本体。

2. **共有純粋関数を切り出す**。`bike_physics.js` に「クランプ済 dt 区間を 1/120秒
   サブステップ積分して新速度を返す」純粋関数を1本追加。viewer の `wsHandlers.state`、
   `inertia-sim.html` の step()、テストの3者が全部それを呼ぶ。3重複を1本に。

3. **物理パラメータを1箇所に**。mass/c_rr/c_d/area を `bike_physics.js` の名前付き
   定数に集約。viewer のマジックナンバー直書きを撤去。CdA 方式 (c_d=CdA, area=1) は
   inertia-sim.html と揃える。

4. **テストを本物検証に書き直す**。手コピー helper を叩くテストを廃し、(2) で切り出した
   本物の共有関数を直接テストする。さらに viewer の起動〜rider 前進を実走 pin する
   integration test を最低1件足し、それが dist=0 を捕まえられる状態にしろ。

## 検証規律 (最重要 ── 前回ここで失敗した)

- 「できた」と言う前に**必ず実画面で目視**しろ。テスト緑 ≠ 画面が動く。
- Range 対応サーバが要る。`python -m http.server` は Range 非対応で地図が出ない。
  `python C:\Users\yuuji\.agents\scratch\fujihc-trainer-project\range_server.py 8020 web`
  で起動 (起動済なら再利用)。
- `http://127.0.0.1:8020/?consent=dev&map=1` で intro を抜けて起動する。
- headless Chrome でスクショ:
  `"C:\Program Files\Google\Chrome\Application\chrome.exe" --headless --disable-gpu
  --screenshot=<out.png> --window-size=1400,900 --virtual-time-budget=25000 "<URL>"`
  → **Read tool で画像を実際に観て**、rider がコース上を前進しているか (dist が
  増えるか) を批評しろ。`verify-fujihc-screen` スキルがある、invoke しろ。
- 完了条件: viewer 起動 + rider がコースを前進 (dist 増加) + HUD に物理由来速度 ──
  これを実画面で目視確認できて初めて完了。

## 制約

- commit OK (どんどんしろ、セーブと同じ)。**push は絶対禁止** ── push / PR / 公開操作は
  user の per-action 明示認可が要る。指示なく push するな。
- 既存 876 テストを 1 件も壊すな。
- 物理モデルの式 (`applyPhysicsStep` の中身) の正しさは検証済み。式を変えるな、
  共有関数への切り出しと呼び出し側整理のみ。
- repo の `CLAUDE.md` の規範に従え (テスト先 verify / push 禁止 / silent execution)。
- commit message 末尾に `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`。
- 詰まったら最大3回試す。調査メモ等は repo 内に置くな、`~/.agents/scratch/fujihc-trainer-project/` へ。

## まとめ

ゴール = 富士ヒル viewer で、トレーナーのパワーとコース勾配から `applyPhysicsStep` の
物理で rider が**実際にコースを前進**し、それを実画面で目視確認できる状態。
副次ゴール = SoT 3重複の解消 (共有純粋関数) と、テストを本物検証に書き直すこと。
前回は subagent のコンテキスト不足でハリボテを出した。お前は full context で、
dist=0 の root-cause から通しでやり、実画面で「進む」のを見届けてから完了と言え。
完了したら commit sha 一覧・テスト結果・実画面目視の結果 (スクショ path 付き) を報告。
