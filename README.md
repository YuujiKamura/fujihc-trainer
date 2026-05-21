# fujihc-trainer

富士ヒルクライム (= 富士スバルライン、 標高差 約 1270m) のコースを、 室内のスマートトレーナーで再現する練習補助アプリ。

> 本アプリは富士ヒルクライム大会の **非公認** な個人プロジェクト。 大会の主催者・運営とは無関係です。

## このアプリは何をするか

GPX のコースデータと地形タイルから 3D の走行画面を組み、 スマートトレーナー (FTMS = Bluetooth でパワー / ケイデンスをやり取りする規格) と繋いで、 そのコースを室内で走れるようにする。 訪問者は 2 つのモードから選ぶ:

- **走る**: トレーナーと繋ぎ、 実際に漕いでコースを登る。 走行記録はブラウザ内に残る。
- **観る**: トレーナーなしで、 コースを再生で眺める。 記録は取らない。

構成は 3 つに分かれる ── ブラウザで動く viewer (= 画面描画)、 ローカルの bridge (= トレーナーとの通信 + タイル配信)、 ローカルのタイル DB (= 地形データの保管)。 viewer 単体でも `?test=1` で UI 操作の確認はできる。

なお、 リポジトリ名は `fujihc-trainer` だが、 Python の module 名は歴史的な経緯で `fujihill` のまま (= 下記コマンドの `python -m fujihill.*`)。

## セットアップ

### コースデータ (= web/course.json)

GPX を `src/fujihill/course.py` で変換した派生 JSON (= 距離 / 標高 / 勾配 / 緯度 / 経度 の列)。 自分が権利を持つ GPX を使うこと:

```sh
python -m fujihill.course ~/path/to/your.gpx --export-json web/course.json
```

`--export-json` を付けないと走行サマリが表示されるだけで JSON は書き出されない。 富士ヒル以外のコースでも動く ── その場合 `src/fujihill/tile_constants.py` の `MINIMAP_BBOX` を書き換える。

### タイル DB

地形タイル (= 国土地理院の標高データ + OpenStreetMap の地名) をローカル DB に用意する:

```sh
python scripts/init_tile_db.py        # 空の data/tiles.sqlite を作る
python scripts/fetch_gsi_dem.py       # 国土地理院 標高タイル (zoom 14)
python scripts/fetch_osm_pmtiles.py   # OpenStreetMap 地名抽出
```

- 国土地理院への取得は 1 req/s で、 富士ヒルコースの場合 zoom 14 の数十タイルのみ (= 約 36 タイルなら 1 分弱)
- DB は `.gitignore` 済 (= `data/*.sqlite`)、 リポには含めない
- 出来上がった DB の実サイズは `init` 後に確認すること

## 動かす

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

このアプリは地図タイルを国土地理院と OpenStreetMap という無償の配布元から取得する。 配布元に迷惑をかけないことを設計の軸にしている ── 一度取ったタイルはローカルに保存して二度と取りに行かない、 取得範囲は最小限にする、 出典を画面に常時表示する。 この考え方と、 AI エージェント向けの詳しい禁止事項は `CLAUDE.md` を参照 (= こちらが正本)。

clone した人が必ず守ること:

- **`scripts/fetch_gsi_dem.py` の `--user-agent` に自分の連絡先 (= email) を入れる**。 国土地理院が大量取得者を同定するのに使うので、 既定値のままだとリポ作者の連絡先を僭称することになる:
  ```sh
  python scripts/fetch_gsi_dem.py --user-agent "fujihill-trainer/0.1 (your-email@example.com)"
  ```
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
