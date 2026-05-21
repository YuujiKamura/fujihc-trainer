# fujihc-trainer — AI エージェント向けルール

## 地図タイル配布元への配慮 (最重要、変更禁止)

このリポは国土地理院 (GSI) と OpenStreetMap (OSM) のタイルを使う。
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

### GSI 地理院タイル

- **取得は 1 回だけ**: ページを開いた 1 回、コース外接矩形を覆う数十枚のみ。自動再取得・ループ取得は禁止。
- **同時接続 6 本以下**: `GSI_FETCH_LIMIT = 6` を減らす方向にのみ変更可、増やし禁止。
- **タイル数上限 200**: `MAX_TILES = 200` を超えたら地形を組まずエラー。増やし禁止。
- **seamlessphoto 固定**: `std` / `relief` / `hybrid` はサーバ負荷が倍増するため封印。追加禁止。
- **Python スクリプト**: `GSI_RATE_LIMIT_SEC = 1.0` (1 req/s)。速くするな。
- **IndexedDB キャッシュ必須**: `openTileCache()` を外さない。TTL 内は GSI に再アクセスしない設計を壊さない。
- **出典クレジット必須**: `© 国土地理院タイル` + `https://maps.gsi.go.jp/development/ichiran.html` を画面に常時表示する `#attrib` 要素を消さない。

### OSM タイル

- **`tile.openstreetmap.org` を直接叩くな**: OSMF Tile Usage Policy 違反。Protomaps PMTiles 経由のみ。
- **`bridge.py` は `127.0.0.1` bind 固定**: LAN 内に ODbL タイルを再配布する事故を物理的に防いでいる。`0.0.0.0` への変更禁止。

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
