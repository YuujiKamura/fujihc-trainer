# fujihc-trainer — AI エージェント向けルール

## UI 要素を画面に追加する前は必ず user に問う (= 場所を勝手に決めるな)

新しい button / checkbox / トグル / row / panel / chip 等の **画面上に出る UI 要素を
追加するときは、 brief に「どこに置く」 と書いた時点で仮、 **実装直前に user に
場所を問う**. 私 (AI) が「機器設定 panel の奥に控えめ」 等の仮定を立てるのは構わないが、
実装に降ろす前に必ず user 確認を取る. 場所の選択肢が 1 つしか妥当でないと AI が
判断した場合でも、 user の判断を取れ ── AI の「答えは 1 つ」 は user 体験に対しては
ほぼ間違っている.

特に厳しく扱う:

- **ride 中画面 (`#controls` / `#hud` / `#minimap`)** への新規 UI 追加は **default 禁止**.
  ride 中は user の集中対象、 勝手なボタン / checkbox を生やすな. 必要があると判断
  しても user に問え、 user OK が出るまで実装するな.
- **setup-overlay への追加**も場所選定は user 確認. 「自然な位置」 は user の使用順
  によって変わる、 AI が決めるな.
- **HUD / 常時表示要素**への追加は特に厳禁. 富士ヒル本物画面に余計な要素が常時
  乗ると体験汚染、 user 怒りの core になる.

過去 anti-example:

- 2026-05-29 (= b128): AI が「機器設定 panel の bike slider 隣に halfMode checkbox を
  独立 row で追加」 を user 相談なしに決定. 結果として ride 開始前は controls panel
  が hide されてて触れない死に機能になった上、 ride 中画面に勝手な checkbox を生やした.
  user 訂正「勝手な判断でライド中にボタンを追加した時点でマジで死んだ方がいい」.
  本 section はこの訂正の永続化.
- 2026-05-29 (= b128 直後): 撤回しようと AI が「setup-overlay の ride 開始 button
  直前に移す」 を再度勝手に決めた. 移動先も AI が選ぶこと自体が user 訂正の対象、
  「答えが 1 つしかない」 と AI が思っても判断を user に渡せ.

実装手順:

1. brief / 設計段階で UI 配置を仮で書くのは OK (= 検討材料として).
2. 実装に降ろす直前、 「ここに置こうとしてるが OK?」 を user に必ず問う.
3. user OK が出てから initial 配置を実装. user が「他に置けるか」 と問うなら
   候補を 2-4 個並べる前に「正しい答えは 1 つしかない場面」 と「user 好みが分かれる
   場面」 を区別、 **前者なら 1 個提示**、 後者なら 2-3 個並べて user 選択.
4. UI 追加後の test も grep gate (= identifier 存在 pin) で済むなら最小化、
   配置場所自体は test しない (= user が後で動かしたくなる前提).

## MVC 規約 (= 新 module の責務を最初から分けろ、 後で剥がすな)

新規 module / 既存 module を編集する時、 **その module が Model / View / Controller の
どれに属するか冒頭コメントで宣言**、 1 module に 2 つ以上の責務を混ぜない。 後から
「ビューに癒着したライダー」 (= 2026-05-15 incident) を剥がすコストは AI が「最初から
混ぜない」 で防ぐべき、 user が毎回訂正しなくて済むようにする物理 gate.

3 区分:

- **Model** (`web/lib/*.js` の大半): data + 純粋関数寄りの振る舞い. DOM / window /
  document / performance.now / localStorage を **直接参照しない**, 全て引数 / deps /
  opts で受ける. node 単独 test で副作用ゼロで pin 可能. 例: `rideState` /
  `physicsState` / `rider` / `ride_db` / `save_summary` / `bike_physics` /
  `ride_clock` / `ride_resume` / `course_loader`.
- **View** (`web/lib/{history_row,hud,hud_chart,postride_buttons,minimap,...}.js`):
  DOM 組み立て helper. `document` を `cfg.document` で受ける形 (= 既存
  `history_row.js` を踏襲)、 ride 状態を直接読まず caller (Controller) が値を
  渡す形. ride 開始 / state 遷移 / IDB 書込はしない、 callback で Controller に
  上げるだけ.
- **Controller** (`web/viewer-maplibre.js`、 当面これ 1 つ): Model と View の協調、
  event bind、 state 遷移、 ride 開始 / 終了の orchestration. **当面 1 file** だが
  軽量化方向 (= 上 section) に常に動かす、 Model と View に運べる部分は運ぶ.

規約:

- **冒頭コメントで責務宣言**: 新 module の最初の数行に `// model:` / `// view:` /
  `// controller:` のいずれかを書く (= 例: `// model: bike 設定 slider 値の SoT.
  pure module、 DOM 不参照、 deps + opts で受ける.`).
- **Model に DOM 参照を書こうとした瞬間止まれ**: `document` / `window` /
  `localStorage` を Model module に直接書いてる時、 必ず caller から `cfg.storage`
  / `cfg.document` で受け取る形に変えろ. 既存 `save_summary.js` /
  `physics_state.js` / `ride_clock.js` が踏襲モデル.
- **View に ride state を読みに行く logic を書くな**: `rideState.snapshot()` を
  View 内で呼ぶのは Controller が値を作って渡す形に直す. View は受け取った値を
  DOM に描くだけ.
- **Controller から Model を呼ぶ正規経路**: 新機能を viewer 直書きで済ますな (= 上
  section と同じ)、 Model 側に API を生やして Controller から呼ぶ.

過去 anti-example:

- 2026-05-15 (= b1 復元バグ): rider が view に癒着、 model 側で位置が更新されないのに
  view が動いて見える bug. JS 地形コンポーネントは問題なかった、 壊れたのは「ビューに
  癒着したライダー」 だけ. MVC 分離が事故境界そのもの.
- 2026-05-29: AI が viewer-maplibre.js に新規 inline 関数を生やそうとして user 訂正
  「MVC モデルを規約にしておけ。 違反してるようなのを最初から作りこませるな」.
  本 section はこの訂正の永続化.

## viewer 軽量化 + Svelte 移行準備 (= 機能追加と同位の最優先)

viewer-maplibre.js (= 3000+ 行の塊) は **常に軽量化方向に動かす**。 svelte-poc/ への
移行準備として、 viewer 内の module-global / inline 関数 / DOM bind / 物理積分 /
時計 state は **別 file (= `web/lib/*.js`) に切り出すのを default**。 機能追加だけが
食えるコードではなく、 「viewer を分けて Svelte 側に運べる形にする」 こと自体が
user 価値 (= 後で user 自身が Svelte 移植を引き取る時のコストを軽くする).

ルール:

- **viewer 内 module-global / inline 関数の新規追加は禁止寄り**: 新機能を viewer
  直書きで済ませようとした瞬間、 「これは別 module に出せるか?」 を 1 度問う。
  出せるなら出す、 出せない理由が即答できなければ出す。
- **「食える機能 vs 内部 refactor」 の二項対立で refactor を切るな**: AI は「内部
  整理は user benefit ゼロ」 と判断しがちだが user 訂正済 (2026-05-29)。 viewer
  軽量化は user 価値そのもの。 機能追加 brief と viewer 軽量化 brief は二者択一
  ではなく、 両方やる。
- **brief を縮めて module 化を skip するな**: 「viewer 内 local 関数で済ます」 と
  短絡したら user 訂正「モジュールは作れ、 頭おかしいのかお前は」 で叩き直される。
  brief が module を指定したら作る、 「管理コスト」 を理由に縮めない (= 管理コスト
  は viewer の 3000 行 の方が圧倒的に大きい)。
- **既存 module 系統を踏襲**: `physics_state.js` / `ride_clock.js` / `rider.js` /
  `bike_physics.js` 等の既存 SoT 分離パターンに従う、 新規 module は同じ語彙で命名。
- **node 単独 test で pin できる純粋関数寄り**: DOM / window / performance.now を
  直接参照せず、 deps と nowMs を引数で受ける形 (= `physics_state.js` /
  `ride_clock.js` と同じ形)。 viewer を import せずに振る舞いを test できる状態を
  保つ。

過去 anti-example:

- 2026-05-29: b127 (= 履歴続きから) で「ride_resume.js を別 module で作らず viewer
  内 local 関数で済ます」 と AI が判断、 user 訂正「アホ。 モジュールは作れ。 頭
  おかしいのかお前は」。 本 section はこの訂正の永続化。
- 2026-05-29: b125c (= bike_settings 集約) / b125d (= viewer runtime 切り出し) を
  AI が「user benefit ゼロの内部 refactor だから切る」 と判断、 user 訂正
  「viewer 軽量化してスベルテ化の準備に寄せていけ。 ルールに書いとけバカ」 で復活。
  viewer 軽量化は user benefit そのもの、 切る判断をするな。

## 配布元への配慮 (最重要、変更禁止)

このリポは国土地理院 (GSI) のタイル、 OpenStreetMap (OSM、 Protomaps PMTiles 経由) のタイル、
気象庁オープンデータ (= AMeDAS、 bosai 系) の現在気象を使う。
配布元へ迷惑をかけないことを設計の軸に据えている。以下のルールは AI が勝手に変更・回避してはならない。

### 考え方 (= ルールの文字列より上位、これを念頭に下記ルールを読め)

国土地理院は **国民の税金で運営される公的機関**、 OSM は **市民ボランティアが手で道を描いて積み上げた世界地図 + 寄付ベースで限られたサーバを回す OSMF**。 どちらも「全員のため」 と引き受けて無償公開してくれている。 アクセスする側 (= 本 app) は規約の文字を逐語的に守るだけでは不十分、 配布元の立場で **「やってほしくないこと」 を想像する** のが本道。

配布元から見て嫌がられる行為の例:

- **テスト自動化で実 endpoint を毎日叩く**: 1 人の手動操作と違って、 CI cron / push 連動の自動 fetch は無人で配布元を消費し続ける。 「contract test を cron で日次走らせる」 は配布元から見れば「test ロボットが毎日 N タイル取りに来る」 で嫌がられる class。 **実 endpoint を叩く test は手動 trigger のみ** (= `workflow_dispatch`)、 push / cron 連動禁止。
- **キャッシュを意図的に消して全 fetch をやり直す**: 「キャッシュは活かす、 再配布はしない」 の本意は「配布元負荷ゼロに近づける」。 test の都合で `data/tiles.sqlite` や IndexedDB を clear して全 fetch を再現するなら、 **fixture から復元する経路を使い実配布元には触らない**。
- **嘘の連絡先を送る**: `scripts/fetch_gsi_dem.py` の `--user-agent` を default の URL のまま使うと、 地理院が heavy user に連絡したい時にリポ作者に届く。 自分の email を必ず入れる。
- **公的予算 / 寄付の使われ方を意識せず大量取得**: 富士ヒル course の DEM は ±1 km 走路 buffer で 36 タイル (= zoom 17 単一化)。 これ以上の bbox / zoom を増やす変更は配布元負荷を直に増やすので、 必要性を 1 度問うてから書く。
- **「配布元の URL pattern 変更」 を実 endpoint への定期 fetch で検出する**: 自動 drift catch を配布元の負担で実現する発想自体が筋違い。 公式 announcement / changelog を **月 1 で人間が読む**、 もしくは過去 fetch 済 fixture との diff でローカル pin する。

本 section は 2026-05-20 user 訂正「相手の立場に立って、 やってほしくないことを考えたほうがいい。 AI だからといってそれが出来ないわけはないだろ?」 を AI 向けに言語化した。 規約の文字を超えて「配布側がどういう動機で無償公開してるか」 を想像してから設計しろ ── 出来ないわけはない。

過去 anti-example (= AI が踏んだ failure mode):

- 2026-05-20: Pages live contract test を「GitHub Actions の cron で日次走らせる」 と AI (= Claude) が提案、 配布元から見れば毎日定期的に叩かれる DoS 寄り、 user に「相手の立場で考えろ」 と訂正された
- 2026-05-14 (= x4 occurrence): 「ローカル DB にタイルを整備したらダメなんか?」 と user が x4 言っていたのに AI は配布元を都度 fetch する path を提案、 「キャッシュは活かす」 の本意 (= 配布元負荷ゼロに近づける) を踏まずに「キャッシュ無効化して全 fetch する mock test」 を書いた
- 2026-05-26 (= b117): AMeDAS (気象庁 bosai) を viewer 起動の度に 2 req fetch していた (= b72 〜 b116 まで誰も気にせず landed)。 user に「気象庁の配布元を毎回フェッチしてると思うが、 これも頻繁になり過ぎると迷惑掛かりそうなんで、 更新頻度を決めて、 起動のたびに取って来るとかはしない方がいい」「10 分に一回とかに決めておいて、 それ以上 (= 以内) はキャッシュを使うようにしろ」 と訂正、 localStorage で 10 分 cache 実装。 観測値が 10 分 granularity で更新される配布元仕様に合わせる発想を AI が先回りすべきだった
- 2026-05-26 (= b118): `e2e/debug_capture.spec.js` と `e2e/svelte_map.spec.js` が `?noterrain=1` 抑止も `page.route` mock も無く、 ローカル `npx playwright test` の度に GSI に通信が出ていた (= b74-screenshot / b75-screenshot 等の他 e2e は mock 完備、 この 2 件だけが規律外で放置されていた)。 user に「テスト群の中でも、 こういった配布元にストレスを掛けてるものがないか精査しろ」 と訂正、 全 e2e と CI workflow を精査して 2 件特定 → `page.route` mock 追加で物理 block

### test での配布元 fetch (= 自動経路 / 手動経路の両方で物理 block)

test (= vitest / pytest / playwright e2e) は配布元への通信を **物理層で block** すること。
mock / route intercept / fixture から fulfill のいずれかで、 1 byte も配布元に出ない設計を保つ。

- **vitest / pytest**: 配布元 client 関数の test は `vi.fn()` / `vi.mock` / `patch('...urlopen')` 等で fetch を mock 駆動。 source-grep gate は `readFileSync` で source を読んで pattern を assert するだけで通信ゼロ。
- **playwright e2e**: 地形 / 雲 / minimap を描画する spec は `page.route(/(?:cyberjapandata\.gsi\.go\.jp|tile\.openstreetmap\.org)/, ...)` で配布元 URL を intercept、 fixture PNG (= `web/tests/fixtures/gsi_dem_v1_sample.png` 等) を `route.fulfill` で返す。 必要なら `?noterrain=1` で地形 fetch そのものを抑止 (= ENV gate)。
- **新 spec を書く時の確認手順**: 配布元 URL が走る経路 (= 地形 / minimap / Strava / AMeDAS) を含む spec は、 mock を組まずに commit しない。 既存 mock pattern (`b74-screenshot.spec.js` / `tile_load_budget.spec.js`) を踏襲する。
- **default config に居る e2e は全部 mock 完備**: `playwright.config.js` の testIgnore に居ない spec は `npx playwright test` で auto 走る = 開発者の手元で何度も叩かれる = 配布元負荷。 default config に新 spec を追加する時は mock 必須。
- **実 endpoint を叩く test を立てるなら**: `e2e/playwright.pages-live.config.js` 系 (= `workflow_dispatch only` + email + reason 50+ 文字 + 配布元 URL anchored + AUTHOR_HANDLE 制限) と同等の物理 gate を必ず併設、 push / cron 連動禁止。

### GSI 地理院タイル

- **取得は 1 回だけ**: ページを開いた 1 回、コース外接矩形を覆う数十枚のみ。自動再取得・ループ取得は禁止。
- **同時接続 6 本以下**: `GSI_FETCH_LIMIT = 6` を減らす方向にのみ変更可、増やし禁止。
- **タイル数上限 200**: `MAX_TILES = 200` を超えたら地形を組まずエラー。 b70 は ring topology 境界整列達成のため一時 256 に引き上げたが、 b71 で外周ストリップ廃止 + 単一 zoom 統合でタイル数約 42 で余裕、 200 に戻した (= 「緩めた gate は必要消滅で戻す」 規律)。 配布元配慮の本質 (= 1 回 fetch + IndexedDB 90 日 TTL + GSI_FETCH_LIMIT=6 並列で 1 wave 完了、 自動再取得・ループ取得なし、 ToS 内) は不変。 さらなる引き上げは禁止。
- **「設定 1 箇所」 SoT**: 地形タイルの zoom / bbox は `web/courses/fujihill.js:TERRAIN_CONFIG` (JS) と `src/fujihill/tile_constants.py:TERRAIN_CONFIG` (Python) の 2 SoT、 `DEM_ZOOM` / `GSI_PROBE_Z` / `GSI_DEM_ZOOMS` / `demBounds` / `FUJI_TERRAIN_BBOX` は全てそこからの派生。 zoom や bbox を変えたい時は **JS / Python の TERRAIN_CONFIG を同値で書き換えるだけ**で全部追随する設計。 cross-language 同期は `tests/test_b59_dem5a.py` で値同値性 pin。
- **seamlessphoto 固定**: `std` / `relief` / `hybrid` はサーバ負荷が倍増するため封印。追加禁止。
- **Python スクリプト**: `GSI_RATE_LIMIT_SEC = 1.0` (1 req/s)。速くするな。
- **IndexedDB キャッシュ必須**: `openTileCache()` を外さない。TTL 内は GSI に再アクセスしない設計を壊さない。
- **出典クレジット必須**: `© 国土地理院タイル` + `https://maps.gsi.go.jp/development/ichiran.html` を画面に常時表示する `#attrib` 要素を消さない。

### OSM タイル

- **`tile.openstreetmap.org` を直接叩くな**: OSMF Tile Usage Policy 違反。Protomaps PMTiles 経由のみ。
- **`bridge.py` は `127.0.0.1` bind 固定**: LAN 内に ODbL タイルを再配布する事故を物理的に防いでいる。`0.0.0.0` への変更禁止。

### 気象庁 AMeDAS (= bosai 系オープンデータ)

- **取得は 10 分に 1 回まで**: 観測値自体が 10 分 granularity で更新されるため、 それより短い間隔で叩く意味は無い。 `web/lib/weather/jma_amedas.js` の `fetchFujiWeather` は `opts.storage` (= localStorage) を渡された時 `AMEDAS_CACHE_TTL_MS = 10 * 60 * 1000` で cache、 10 分以内の再アクセスは fetch しない。 viewer は起動時にこの opts を必ず渡す ── 起動毎 2 req を出さない。
- **配布元 down 時の挙動**: cache の TTL を超えた古い保存値があれば stale を返す (= `stale: true` フラグ付き)、 画面の連続性を維持。 「観測値が古いまま表示」 のほうが「気象 panel が error 表示で消える」 より user 体験が高い。
- **観測点は 5 個のみ**: 富士山周辺 (河口湖 / 山中 / 古関 / 御殿場 / 富士山頂) の固定 5 観測点。 観測点を増やす変更は fetch 量を増やさず (= map endpoint は 1 req で全 1286 観測点の値を返す) 抽出を増やすだけ。
- **出典クレジット必須**: 「現在気象 (気象庁 アメダス)」 を画面に表示する (= `#weather-panel` 内、 b116 で「大気環境」 fold 内に DOM 移動済)。 「気象庁オープンデータ」 を出典として明示する義務を画面で果たす。
- **新 endpoint 追加禁止**: 現状は `latest_time.txt` + `map/<timestamp>.json` の 2 req。 forecast / radar 等の新 endpoint を追加する前に「観測ではなく予報なら別 source (= 気象 API 商用) を使えないか」 を 1 度問う。

### DB / バイナリ

- `data/*.sqlite` / PMTiles 元ファイルは `.gitignore` 済、git に含めるな。
- 数百 MB 以上の binary を commit するな。

## テスト

```sh
python -m pytest          # Python (pytest)
npm test                  # JS (vitest) — web/tests/
```

変更後は触ったモジュールのテストを両方走らせてから次の action に移れ。

## scratch / draft の置き場

調査メモ・レポート・brief は `~/.agents/scratch/fujihc-trainer-project/` に書け。
リポ内 (`/c/Users/yuuji/fujihc-trainer/`) に置くのは commit する意図があるファイルだけ。

## 変更前ワークフロー (= 「直接実装するな」、 user が毎回言わなくて済むようにする物理 gate)

このリポでコードを変更する前に、 必ず下記の順を踏め。 user / main session が「ブリーフ書いて」「7軸レビューに掛けて」 と毎回言わなくて済むようにするための default workflow。

1. **ブリーフを書く** (= `~/.agents/scratch/fujihc-trainer-project/bNN-<name>.md`)
   - 「直すこと」「テストで pin すること」「完了条件」「取り下げ手順」「参照」 を最低限 encode
   - 形式は既存 brief (= b30 / b32 / b35) を踏襲、 bookend (= 「はじめに」「まとめ」) を地の文で書く
2. **`multi-axis-draft-audit` skill で 7 軸並列 audit** (= `~/.claude/skills/multi-axis-draft-audit`)
   - 軸 1 register/構造、 軸 2 語彙の規律、 軸 3 抽象段差、 軸 4 テスト網羅性、 軸 5 設計境界、 軸 6 マイグレ可逆性、 軸 7 セキュリティ境界 の 7 並列 sub-agent dispatch
   - drift catalog (= `~/.agents/state/fujihc-trainer/audit-drift-catalog.md`) を必読、 過去 NG pattern の再演は LOAD-BEARING 自動昇格
   - LOAD-BEARING ≥ 1 なら brief 改訂 → 再 audit、 CONVERGED まで loop
3. **実装** (= brief 改訂版に厳密に従う)
4. **検証** (= vitest + e2e + 実画面批評)
5. **commit** (= 明示パス指定)

例外:
- typo / コメント / docs のみの軽微修正で「コード挙動 不変」 が明白 → brief 不要、 ただし「コード挙動 不変」 を自分で 1 度問うこと
- user が明示的に「brief 不要、 直接やれ」 と instruct した時のみ skip 可
- 一切の例外として、 「次のアクションは X で良いですか」 と user に判断を投げる前に **まず brief を書け** ── user に判断を投げる時点で brief が無ければ user 価値がゼロ、 brief 経由なら user は brief を読んで判断できる

過去 anti-example:

- 2026-05-17: AI が「直接実装するな、 ブリーフを書いて 7軸レビュー→チームで実装」 と user に役割を再定義された
- 2026-05-20 (= 本 commit 直前): b35 改修後の「実 endpoint test を cron 日次で回す」 提案 / 「`dem_png` fix」 / 「test を CI から外す」 を、 brief 経由せずに直接 commit に飛んだ。 user に「お前が毎回言わなくて良いように出来るか?」 と訂正された ── まさにそれを物理 stop するために本 section を書く

## ブリーフ管理 DB (= 2026-05-20 整備、 worker 起動時に必ず query)

このリポの brief / task / 検討メモ (= scratch + docs/briefs/) は `~/.skill-miner/kanban.sqlite`
(= 既存 substrate) に 114 task として登録済。 同 substrate の `~/.skill-miner/index.sqlite`
に `fujihc_sessions` view があり、 fujihc-trainer 関連の過去 session 履歴を引ける (=
cwd LIKE '%fujihc%' OR '%fujihill%' で絞った view)。

**worker は brief 着手前に grep ではなく query で過去関係を引け**:

```bash
bash ~/.agents/scratch/fujihc-trainer-project/kanban_fujihc_query.sh             # summary + 直近 task + 直近 session
bash ~/.agents/scratch/fujihc-trainer-project/kanban_fujihc_query.sh <slug>      # 指定 brief task + 編集履歴 + FTS 言及 session
bash ~/.agents/scratch/fujihc-trainer-project/kanban_fujihc_query.sh --state doing  # state 別 task 一覧
```

新規 brief を scratch or docs/briefs/ に置いたら `python ~/.agents/scratch/fujihc-trainer-project/register_briefs.py`
を再実行 (= idempotent、 diff のみ INSERT)。 `.final` suffix で重複 task が増えたら
`merge_final.py` で base task に統合 (= 同じく idempotent)。

task の state 進行 (todo/doing/review/done/blocked) は既存 `~/.skill-miner/kanban_move.sh`、
コメント追加は `kanban_comment.sh`、 vault export は `kanban_export_vault.sh` を使う。
helper script の追加 install は不要、 全部既存運用に乗ってる。

**触ってはいけない**:
- 既存 task id 1-11 (= kanban 自身のメタ task、 fujihc 由来ではない、 不変)
- raw_conversations / raw_messages / session_chunks / session_files (= skill-miner の生 ingest、
  読み取り専用、 INSERT/UPDATE は外部 ingest pipeline の責務)

## push

`git push` (= origin = YuujiKamura/fujihc-trainer、 自分の repo) は、 触った module の
全種類 test (= vitest + pytest + e2e、 該当するもの) が green なら **per-action 認可
なしで実行してよい** (2026-05-21 user 改訂「できてるならプッシュに規制はない、 ルールを
変えろ」)。 検証 green = 「できてる」、 できてれば push は規制しない。

ただし:
- 検証未済での push は禁止 (= Rule 1、 「できてる」 の実体は test green)。
- `data/*.sqlite` / PMTiles 等の配布元データ・credentials は commit 段階で止める
  (= 上記「DB / バイナリ」 + global Rule 11)、 push 以前の問題。
- upstream / 他人名義 repo への push・PR・Issue は従来どおり禁止 (= 人間判断を経由)。
