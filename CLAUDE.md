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

## push 禁止

`git push` は user の明示指示があるまで禁止。ローカル commit まで。
