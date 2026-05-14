# fujihc-trainer

富士ヒルクライム (= Mt. Fuji HC) コースを室内 trainer (FTMS) で再現する練習補助 app。

## 初回セットアップ

### コースデータ (= web/course.json)

GPX (例えば公式 [fujihc.jp/course](https://fujihc.jp/course/) で公開されているもの) を `src/fujihc/course.py` で変換した派生 JSON。 距離 / 標高 / 勾配 / lat / lon の列で、 元 GPX とは別物。 自分の GPX を使いたい場合は:

```sh
python -m fujihc.course ~/path/to/your.gpx > web/course.json
```

- 富士ヒル以外のコースでも動作する、 minimap bbox は `tile_constants.MINIMAP_BBOX` を要書換

### タイル DB セットアップ

タイル DB (= 国土地理院 DEM + OSM 地名 PMTiles) をローカルに用意する:

```sh
python scripts/init_tile_db.py
# → data/tiles.sqlite (空 schema_v1) を作成
```

その後、 個別 fetch スクリプト (brief 15 / 16 で landing 予定) で実データを投入:

```sh
python scripts/fetch_gsi_dem.py    # GSI DEM タイル (= zoom 17, 約 36 秒)
python scripts/fetch_osm_pmtiles.py # OSM 地名抽出 (= 数秒)
```

- **想定 DB サイズ**: 約 16 MB (= zoom 17 単一化、 富士ヒル course ±1km buffer / corridor=3)
- **DL 時間**: 約 36 秒 (GSI DEM) + 数秒 (OSM PMTiles 抽出)
- DB は `.gitignore` 済 (= `data/*.sqlite`)、 リポには含めない

## 画面操作確認 (= trainer / bridge 不要、 brief 22)

viewer の操作系 (= camera / wheel zoom / pitch drag / ride 進行 button) を
trainer や bridge.py を起動せずに確認できる. fake state が 1Hz で流れて
ride_start ボタンで pairing → riding 遷移、 button 全部押せる:

```sh
python -m http.server -d web/ 8000
# その後 browser で http://localhost:8000/?test=1
```

- tile は 404 で灰色背景 (= ローカル DB 無しでも画面操作だけ確認可)
- ride 中の GPU 負荷 / FPS / 温度を実測したいなら通常モード (`python -m fujihc.bridge --dummy`) を使う、 こちらは tile + WebSocket + dummy ride loop が全部走る

## テスト

```sh
python -m pytest
```

## OSS clone した人へ (= 第三者 ToS / 規約遵守)

このアプリは地図タイルとして以下のデータ source を使う:

- **OpenStreetMap (ODbL ライセンス)**: 表示時 `© OpenStreetMap contributors (ODbL)` の表記義務。 Protomaps が再配布する PMTiles ファイル経由のみで取得、 `tile.openstreetmap.org` (= OSMF 公式 tile server) は **絶対に直接叩くな** (Tile Usage Policy 違反、 brief 13/17b 参照)
- **国土地理院標高タイル**: 表示時「国土地理院 標高タイル」の出典明示義務、 大量アクセス自粛 (= `scripts/fetch_gsi_dem.py` は 1 req/s で 36 タイルだけ取得する設計)

### scripts/fetch_gsi_dem.py を走らせる前に

`--user-agent` 引数で **自分の連絡先を含む文字列**に書き換えろ:
```bash
python scripts/fetch_gsi_dem.py --user-agent "fujihc-trainer/0.1 (your-email@example.com)"
```

地理院側で heavy user 同定に email が使われる、 default の `(https://github.com/YuujiKamura/fujihc-trainer)` のままだと他人 (= リポ作者) の連絡先を僭称することになる。

### 公開リポに DB ファイルを commit するな

`data/*.sqlite` は `.gitignore` で除外済、 PMTiles 元ファイルもリポ外配置 (= `~/Downloads/japan.pmtiles` 等) が前提。 数百 MB ~ 数 GB の binary をリポに含めるな。

### bind は 127.0.0.1 限定

`bridge.py` は HTTP server (port 8000) も WebSocket server (port 8765) も `127.0.0.1` bind 明示、 LAN 内の他端末からアクセス不可。 これは ODbL タイルを LAN 内に再配布する事故を物理的に止めるため、 `0.0.0.0` への変更は禁止。
