# fujihc-trainer — AI エージェント向けルール

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
