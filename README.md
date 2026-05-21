# fujihc-trainer

富士ヒルクライム (= 富士スバルライン、 標高差 約 1270m) のコースを、 室内のスマートトレーナーで再現する練習補助アプリ。

> 本アプリは富士ヒルクライム大会の **非公認** な個人プロジェクト。 大会の主催者・運営とは無関係です。

**使う**: 公開版を Chrome または Edge で開くだけ → https://yuujikamura.github.io/fujihc-trainer/ 。 インストール不要、 ローカルに bridge などを立てる必要も無い。 トレーナーはブラウザの Web Bluetooth で直接繋ぐ。

## このアプリは何をするか

GPX のコースデータと地形タイルから 3D の走行画面を組み、 スマートトレーナー (FTMS = Bluetooth でパワー / ケイデンスをやり取りする規格) と繋いで、 そのコースを室内で走れるようにする。 訪問者は 2 つのモードから選ぶ:

- **走る**: FTMS 対応トレーナーを Chrome / Edge の Web Bluetooth で直接繋ぎ、 実際に漕いでコースを登る。 走行記録はブラウザ内に残る。
- **観る**: トレーナーなしで、 コースを再生で眺める。 記録は取らない。

公開版は viewer 単体で完結する ── ブラウザの中だけで動き、 サーバは要らない。 トレーナー接続はブラウザの Web Bluetooth、 地形タイルは表示時に配布元から取得して訪問者のブラウザにキャッシュする (= 詳細は下記「地形タイル」)。 リポジトリにはこの viewer のほかに、 ローカル開発用の bridge (= Range 対応で viewer を配信し、 `--dummy` で fake トレーナーを出す) が入っているが、 公開版の動作には使わない。 viewer 単体でも `?test=1` で UI 操作の確認はできる。

なお、 リポジトリ名は `fujihc-trainer` だが、 Python の module 名は歴史的な経緯で `fujihill` のまま (= 下記コマンドの `python -m fujihill.*`)。

## セットアップ

### コースデータ (= web/course.json)

GPX を `src/fujihill/course.py` で変換した派生 JSON (= 距離 / 標高 / 勾配 / 緯度 / 経度 の列)。 自分が権利を持つ GPX を使うこと:

```sh
python -m fujihill.course ~/path/to/your.gpx --export-json web/course.json
```

`--export-json` を付けないと走行サマリが表示されるだけで JSON は書き出されない。 富士ヒル以外のコースでも動く ── その場合 `src/fujihill/tile_constants.py` の `MINIMAP_BBOX` を書き換える。

### 地形タイル

地形タイルをプロジェクト側の DB に貯めることはしない。 保持は訪問者のブラウザの中だけ ── ブラウザキャッシュでのみローカルに持つ:

- **標高タイル (= 国土地理院)**: viewer が表示時に、 コースを覆う範囲 (= 富士ヒルなら zoom 14 の数十タイル) だけを取得し、 訪問者のブラウザの IndexedDB (= `fujihc-tile-cache`、 ブラウザ内のローカル DB) にキャッシュする。 TTL 内は再取得しない。 訪問者ごと・ ブラウザごとのキャッシュであって、 プロジェクトが持って回る永続タイル DB ではない。
- **地図 (= OpenStreetMap)**: `web/static/map.pmtiles` (= OpenStreetMap から自前 build 済、 リポに同梱) を使う。 富士ヒル以外の地域で使う時だけ `python scripts/fetch_osm_pmtiles.py` で作り直す。

= clone した人が地形タイルのために事前にやる準備は無い。 標高タイルは viewer を動かした時に取りに行き、 地図 (`map.pmtiles`) と コースデータ (`course.json`) はリポに同梱されている。

## ローカルで動かす (= 開発時)

公開版を使うだけなら上記の Pages URL を開けばよい。 以下はリポジトリを clone して開発・改造する時の話。

`?test=1` の純粋な UI 操作確認以外 (= 観るモード / 走るモード / 地図描画を含む動作) は、 地図描画が **HTTP Range request (= ファイルの一部だけを取得する仕組み)** を必要とする。 標準の `python -m http.server` は Range 非対応なので、 地図を含む確認では使えない。

```sh
# 地図描画まで含む完全な確認 (= 推奨、 こちらをまず使う)
python -m fujihill.bridge --dummy
# → ブラウザで http://localhost:8000/?test=1 (= ?test=1 で trainer 不要)

# UI 操作だけの軽量確認 (= 地図は描画されない、 index.html / script の配信を見るだけ)
python -m http.server -d web/ 8000
```

観るモード / 走るモードを確認するなら必ず上 (= bridge) を使う。 下 (= http.server) は地図が灰色のまま遷移するので、 画面遷移そのものだけ見たい時の限定用途。 GitHub Pages 本番は配信側が Range 対応済なので、 この差は本番では問題にならない。

## テスト

```sh
python -m pytest   # Python 側
npm test           # JavaScript 側 (= vitest、 web/tests/)
```

変更したら両方走らせる。

## 配布元 (国土地理院 / OpenStreetMap) への配慮

このアプリは地図タイルを国土地理院と OpenStreetMap という無償の配布元から取得する。 配布元に迷惑をかけないことを設計の軸にしている ── 一度取ったタイルは訪問者のブラウザの IndexedDB にキャッシュして TTL 内は二度と取りに行かない、 取得範囲は最小限にする、 出典を画面に常時表示する。 この考え方と、 AI エージェント向けの詳しい禁止事項は `CLAUDE.md` を参照 (= こちらが正本)。

clone した人が必ず守ること:

- **地形タイルを貯め込む改造をしない**。 標高タイルは viewer が表示時に必要な範囲だけ取得し、 訪問者のブラウザの IndexedDB にキャッシュする設計。 これを「起動時に一括取得」 や「自前 DB に永続化」 へ変えると、 配布元から見て無人の bot が大量取得しに来る形になる。 取得の範囲・頻度を増やす方向の変更はしない。
- **`tile.openstreetmap.org` を直接叩かない**。 OpenStreetMap の Tile Usage Policy 違反。 OpenStreetMap データは Protomaps の PMTiles 経由でのみ取得する。 表示時は `© OpenStreetMap contributors (ODbL)` の出典表記が必要。
- **国土地理院タイルの出典明示**。 表示時に「国土地理院 標高タイル」 の出典を出す。
- **DB ファイルをリポに commit しない**。 `data/*.sqlite` と PMTiles の元ファイルはリポ外。 数百 MB 以上のバイナリを含めない。
- **`bridge.py` は `127.0.0.1` 限定で bind する** (= HTTP / WebSocket 両方)。 LAN 内の他端末に地図タイルを再配布する事故を物理的に止めるため、 `0.0.0.0` への変更はしない。

## Strava 連携 (= 使う人だけ)

走行終了画面から、 (a) GPX をブラウザにダウンロード、 (b) Strava に直接アップロード、 (c) ブラウザ内に履歴保存 ── の 3 つがブラウザだけで完結する。

### 自分の Strava アプリを用意する

リポに固定の client_id は埋め込まない (= 各自の活動が混ざらないため)。 各自で自分の Strava アプリを作って設定する:

1. [Strava API Settings](https://www.strava.com/settings/api) で API Application を作成
2. Authorization Callback Domain に GitHub Pages のホスト (例: `<your>.github.io`) を登録
3. ブラウザの dev console で `localStorage.setItem('fujihill.strava.client_id', '<your_client_id>')` を実行

### 連携解除

設定画面の「連携を解除」 ボタンでブラウザ内のトークンを削除できる。 ただしこれだけでは Strava 側にアプリ登録が残るので、 完全に断つには [Strava 設定 → 連携アプリ](https://www.strava.com/settings/apps) からこのアプリを revoke する。

### 扱うデータの範囲

- アップロードは自分の Strava アカウントへの自己投稿のみ (= 第三者への再配布ではない)
- 走行記録 (trkpt) の保存先はブラウザ内のみ (= サーバには送らない)
- 履歴画面に出るのは自分の走行のみ

OAuth のアクセストークンはブラウザの localStorage に保存される ── クラウドには送られないが、 万一ブラウザに不正なスクリプトが入り込むと読み取られうるので、 このアプリは外部 CDN / 解析タグを一切使わず全部 self-host している。 公開リポに走行の実データを commit しないこと、 他人の Strava データは扱わないこと。
