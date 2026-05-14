# fujihc-trainer

富士ヒルクライム (= Mt. Fuji HC) コースを室内 trainer (FTMS) で再現する練習補助 app。

## 初回セットアップ

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

## テスト

```sh
python -m pytest
```
