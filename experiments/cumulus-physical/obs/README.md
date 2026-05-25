# 観測データ取得 + 空間内補完

user 指示 (= 2026-05-25):
- 「test に使うのはあくまで気象庁その他の機関が提供している実際の富士山の周辺のリアルタイムデータを空間内補完したもの」
- 「ウインドプロファイラや風や気圧の空間データを取得しろ」

つまり cumulus sim の **初期条件 + 側面境界 + 検証データ** は実観測値を富士山 100m grid に空間内補完したものを使う。 toy 理想化 setup は不可。

## データソース (= 8 担当者観測チーム合意、 + ウインドプロファイラ追加)

### 風 + 気圧 空間データ (= user 明示)

| key | 機関 | 種別 | 解像度 | 入手 | sim 用途 |
|---|---|---|---|---|---|
| **MSM-GPV** | 気象庁 | メソ数値予報、 風 + 気圧 + 温度 + 水蒸気 3D | 5km × 1h | RISH (GRIB2) | 初期 3D 場 + 側面境界 nudging |
| **LFM-GPV** | 気象庁 | 局地モデル、 関東圏限定 | 2km × 30min | RISH (GRIB2) | 富士山に最も近い境界 source |
| **ERA5** | ECMWF | 再解析、 138 層 | 28km × 1h | CDS API | 鉛直プロファイル代替 (= 数日遅延) |
| **GFS** | NOAA | 全球数値予報、 fallback | 0.25° × 6h | NOMADS | MSM 入手不可時 |

### ウインドプロファイラ (= user 明示)

| 観測点 | 緯度経度 | 富士山距離 | 解像度 |
|---|---|---|---|
| **静岡** | 34.97°N, 138.41°E | 西南西 50km (= 最近) | 10min / 鉛直 300m |
| **国立** | 35.71°N, 139.45°E | 東北 80km | 同上 |
| **新島** | 34.40°N, 139.27°E | 南東 100km | 同上 |

入手: JMA AWS 経由 or RISH archive (= GRIB2 / CSV)、 過去観測は IGRA NOAA 経由でも可。
頻度: **10 分 / 30 分**、 リアルタイムは最も近い静岡 + 国立 で 3D 風プロファイル triangulation。

### 地表観測 (= アメダス + WP の交点)

| 観測点 | 標高 | 用途 |
|---|---|---|
| 富士 (= 富士市) | 60m | 山麓地表 T / RH / 風 / 雨量 |
| 河口湖 | 859m | 富士北面 |
| 山中 | 1000m | 富士東面 |
| 御殿場 | 460m | 富士南東面 |
| 富士山 (剣ヶ峰) | 3775m | 山頂 |

### 鉛直プロファイル ground truth

- **Tateno (= 館野 ラジオゾンデ)**: 36.05°N 140.13°E、 富士山から東 130km、 00 / 12 UTC = 1 日 2 回、 鉛直 5-10m bin
- 取得: Univ. Wyoming or NOAA IGRA

### 地形 (= 国土地理院 DEM、 user 2026-05-25 「富士ヒルアプリのタイルを遣え」)

**重要**: 地形は obs/ で **再 fetch しない**。 fujihc-trainer 本体が既に国土地理院 zoom 17
DEM (= dem10b_png) を取得 + cache 済 (= `src/fujihill/` 配下 + IndexedDB)、 これを
sim 側で **再利用** する。 配布元 (= 国土地理院) への負荷を増やさない (= CLAUDE.md
fujihc 「地図タイル配布元への配慮」 規定)。

実装方針:
- obs/load_terrain.py (= 新規) = fujihc 既存 cache を読む、 fetch しない
- 既存 source path:
  - python: `src/fujihill/` 配下の DEM 取得 module
  - JS: `web/lib/map3d/terrain_mesh3d.js` の IndexedDB 経由
  - data: `data/*.sqlite` (= zoom 17 タイル cache、 IndexedDB と並列)
- python 側で SQLite cache を直接読み、 reproject (= 富士山中心 UTM zone 54N) +
  100m grid に area-weighted coarsen、 sim 下端境界 h(x, y) として NetCDF 出力

### 検証 (= sim 出力と突き合わせ)

- **気象レーダー** (= 静岡 / 富士)、 5min / 1km → 降水 q_r 検証
- **ひまわり 9 号** (= B03 可視 + B13 赤外)、 2.5min / 500m-2km → 雲頂高度 / 雲被覆検証

## ToS + 配布元配慮

- **CI cron / push 連動 fetch 禁止** (= 2026-05-20 user 訂正)
- **手動 trigger のみ** (= GitHub Actions workflow_dispatch、 user の明示 click 時のみ)
- User-Agent 必須: `fujihc-trainer/0.x (yuujikamura@gmail.com)`
- 単 fetch 当たり sleep 1s、 並列禁止
- SQLite cache UNIQUE 制約で同 day 再取得を物理層 enforce
- fixture 経由が default、 fixture 更新は月 1 程度の routine
- JMA / RISH には学術利用通知メールを別途、 取得ペースは月単位

## ファイル構成 (= 計画)

```
obs/
  README.md                ← 本ファイル
  fetch_msm.py             ← MSM-GPV を RISH から fetch + SQLite cache
  fetch_lfm.py             ← LFM-GPV、 関東圏のみ
  fetch_wind_profiler.py   ← ウインドプロファイラ (= 静岡 + 国立 + 新島)
  fetch_amedas.py          ← アメダス 5 点
  fetch_tateno.py          ← Tateno ラジオゾンデ
  fetch_era5.py            ← ERA5 (= 鉛直プロファイル代替)
  fetch_radar.py           ← 気象レーダー (= 検証)
  fetch_himawari.py        ← ひまわり (= 検証)
  decode_grib2.py          ← GRIB2 → numpy decode
  interpolate.py           ← MSM 5km / LFM 2km / WP → 富士山 100m grid 空間内補完
  cache.sqlite             ← 全 fetch の hot cache (= UNIQUE 制約)
  fixtures/
    msm_2026-05-25.tar.zst ← 凍結 snapshot、 git track 可能なサイズ
    ...
```

## sim 入力への接続

```
[1] fetch → cache (= 手動 trigger、 1 日 1 回)
[2] decode → npy
[3] interpolate to 100m grid (= 富士山中心 10km × 15km)
[4] field_2d.py の initial_from_obs() を新規作成、 npy/NetCDF を読んで初期条件に
[5] 側面境界も 1h ごとに MSM snapshot を nudging
```

## 実装 phase

- **Phase A**: obs/fetch_msm.py + decode_grib2.py + interpolate.py (= 風 + 気圧 + 温度 + 水蒸気 3D 取得 + 富士山 grid 補完)
- **Phase B**: obs/fetch_wind_profiler.py (= 静岡 + 国立 + 新島 WP triangulation)
- **Phase C**: obs/fetch_amedas.py + fetch_tateno.py (= 地表 + 鉛直 ground truth)
- **Phase D**: field_2d.py に initial_from_obs() + 側面境界 nudging
- **Phase E**: 検証 (= fetch_radar.py + fetch_himawari.py、 sim 出力との比較)

各 phase は手動 trigger で fetch、 fixture 経由で sim、 CI / 通常 push では fixture 固定。

## 参照

- RISH JMA archive: http://database.rish.kyoto-u.ac.jp/arch/jmadata/
- JMA WP 公開: https://www.jma.go.jp/jma/kishou/know/upper/profile.html
- IGRA NOAA: https://www.ncei.noaa.gov/data/integrated-global-radiosonde-archive/
- ECMWF CDS: https://cds.climate.copernicus.eu/
- ひまわり AWS Open Data: s3://noaa-himawari9/
