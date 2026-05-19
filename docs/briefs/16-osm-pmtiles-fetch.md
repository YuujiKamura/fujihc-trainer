---
brief: 16-osm-pmtiles-fetch
title: Protomaps PMTiles から富士ヒル範囲を抽出してローカル DB に格納
parent_project: ~/fujihc-trainer/
created: 2026-05-14
revised: 2026-05-14 (Round 2: 中央定数参照 / Protomaps URL fallback 内蔵化 / 全関数 test)
depends_on: [14-tile-local-db]
blocks: [17a-tile-server-module]
---

# Brief 16: OSM タイル抽出 (Protomaps PMTiles 経由)

## はじめに

`tile.openstreetmap.org` から bulk DL は OSM Tile Usage Policy 違反のため、 代わりに **Protomaps の OSM 派生 PMTiles 配布物** (ODbL 配下、 再配布許可) を経由する。 PMTiles ファイル 1 個を 1 回 DL → 富士ヒル範囲 corridor 3x3 だけを抽出して `data/tiles.sqlite` に格納する。

brief 14 の総量見積もりより: **zoom 14-18 corridor 3x3 で OSM 1185 タイル / 約 59 MB**。 PMTiles 抽出は外部 fetch ではなく PMTiles ファイル内 read なのでレート制限不要、 数秒で完了。

Round 2 audit を受けて 3 点を確定:
1. **中央定数 `OSM_VECTOR_ZOOMS` / `DEFAULT_CORRIDOR_TILES`** を brief 14 から import (= corridor 値三重 drift の解消)
2. **Protomaps URL fallback を brief 内に内蔵**: 公式 build が消滅した場合の自力生成手順を「やらないこと」ではなく「fallback」section に明記
3. **全関数 mandate**: reader 経由の抽出 / metadata / `to_fetch` 計算を全部 test

## 実装する script

`scripts/fetch_osm_pmtiles.py` を新規。 `pmtiles` Python パッケージ (PyPI) を使う:

```python
# pyproject.toml に dep 追加
dependencies = [..., 'pmtiles>=3.0']
```

```python
# scripts/fetch_osm_pmtiles.py
import argparse, json, sqlite3
from pathlib import Path
from pmtiles.reader import Reader, MmapSource
from fujihc.tile_constants import (
    DEFAULT_CORRIDOR_TILES, OSM_VECTOR_ZOOMS, TILE_FETCH_WARN_THRESHOLD,
)
from fujihc.tile_coverage import enumerate_coverage_tiles

def extract_tile(reader, z, x, y):
    """PMTiles から 1 タイルを read. None なら範囲外."""
    return reader.get(z, x, y)

def insert_tile(db, source, z, x, y, status, data, fmt='pbf'):
    db.execute(
        'INSERT OR REPLACE INTO tiles '
        '(source, zoom_level, tile_column, tile_row, format, data, fetched_at, fetch_status) '
        'VALUES (?, ?, ?, ?, ?, ?, datetime("now"), ?)',
        (source, z, x, y, fmt, data, status),
    )

def compute_to_fetch(wanted_tiles, existing_set):
    """wanted から existing を引いた set を sort して返す."""
    return sorted([t for t in wanted_tiles if t not in existing_set])

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pmtiles', required=True,
        help='ローカル PMTiles ファイル path. Protomaps の build を事前 DL.')
    parser.add_argument('--course',  default='web/course.json')
    parser.add_argument('--db',      default='data/tiles.sqlite')
    parser.add_argument('--corridor-tiles', type=int, default=DEFAULT_CORRIDOR_TILES)
    parser.add_argument('--force', action='store_true')
    args = parser.parse_args()

    course = json.loads(Path(args.course).read_text(encoding='utf-8'))
    wanted = enumerate_coverage_tiles(course, OSM_VECTOR_ZOOMS, args.corridor_tiles)
    print(f'want {len(wanted)} tiles across z={OSM_VECTOR_ZOOMS}, '
          f'corridor={args.corridor_tiles}')

    with open(args.pmtiles, 'rb') as f:
        reader = Reader(MmapSource(f))
        db = sqlite3.connect(args.db)
        existing = set(db.execute(
            'SELECT zoom_level, tile_column, tile_row FROM tiles WHERE source=?', ('osm',)
        ).fetchall())
        to_fetch = compute_to_fetch(wanted, existing)
        print(f'{len(existing)} already in DB, extracting {len(to_fetch)} new')

        # PMTiles 抽出はレート制限不要 (= file read)、 ただし上限警告は維持
        if len(to_fetch) > TILE_FETCH_WARN_THRESHOLD and not args.force:
            ans = input(f'WARNING: about to extract {len(to_fetch)} tiles. continue? [y/N]: ')
            if ans.strip().lower() not in ('y', 'yes'):
                print('aborted')
                return

        extracted = 0
        skipped_out_of_range = 0
        for i, (z, x, y) in enumerate(to_fetch):
            data = extract_tile(reader, z, x, y)
            if data is None:
                # PMTiles に該当タイルなし (= 富士ヒル範囲が PMTiles 範囲外、 通常起こらない)
                insert_tile(db, 'osm', z, x, y, 404, None)
                skipped_out_of_range += 1
            else:
                insert_tile(db, 'osm', z, x, y, 200, data)
                extracted += 1
            if (i+1) % 100 == 0:
                db.commit()
                print(f'  [{i+1}/{len(to_fetch)}] extracted={extracted} skipped={skipped_out_of_range}')
        db.commit()

        # metadata
        for name, value in [
            ('attribution', '© OpenStreetMap contributors (ODbL)'),
            ('license', 'ODbL-1.0'),
            ('format', 'pbf'),
            ('minzoom', str(min(OSM_VECTOR_ZOOMS))),
            ('maxzoom', str(max(OSM_VECTOR_ZOOMS))),
            ('source_pmtiles_basename', Path(args.pmtiles).name),
            ('fetched_by', 'scripts/fetch_osm_pmtiles.py'),
        ]:
            db.execute(
                'INSERT OR REPLACE INTO metadata (source, name, value) VALUES (?, ?, ?)',
                ('osm', name, value),
            )
        db.commit()
        db.close()
    print(f'done: extracted={extracted}, out_of_range={skipped_out_of_range}')

if __name__ == '__main__':
    main()
```

## PMTiles 入手手順 (README に記載)

1. `https://maps.protomaps.com/builds/` で最新 build を確認
2. 日本サブセット (`asia_japan.pmtiles` 等、 数 GB) を `wget` / `curl` で DL、 `~/Downloads/japan.pmtiles` 等に置く (= リポ外配置、 巨大 binary を git に landing させない)
3. `python scripts/fetch_osm_pmtiles.py --pmtiles ~/Downloads/japan.pmtiles` で抽出
4. 抽出完了後、 元 PMTiles は不要なら削除可

## Protomaps URL 消滅時の fallback

将来 Protomaps の build が変動 / 消滅した場合の自力生成手順 (= deferred せず brief 内に明記):

1. **Geofabrik から OSM 生データ DL**: `https://download.geofabrik.de/asia/japan-latest.osm.pbf` (= ODbL、 自由 DL、 公式)
2. **tippecanoe で PMTiles 化** (Mapbox 製、 OSS):
   ```bash
   # tippecanoe install (Windows なら WSL2 経由が無難)
   tippecanoe -z 18 -Z 14 --no-tile-size-limit \
       --bounding-box 138.65,35.30,138.85,35.45 \
       -o ~/Downloads/fujihill.pmtiles \
       ~/Downloads/japan-latest.osm.pbf
   ```
3. `scripts/fetch_osm_pmtiles.py --pmtiles ~/Downloads/fujihill.pmtiles` で本 brief 通常 path に合流

tippecanoe install と OSM 生データ DL (約 2GB) は重いが、 Protomaps 依存を消す保険として明記。

## やらないこと

- PMTiles を git commit (= 数 GB、 `.gitignore` 既設定)
- raster タイル PNG レンダリング (= vector pbf を SQLite に格納するだけ、 描画は MapLibre の vector style で)
- PMTiles auto DL (= URL 変動、 user が手動 DL)
- 日本以外の範囲 (= 富士山周辺だけ)
- tippecanoe 自動 install (= 環境依存大、 fallback 時に user が手動 install)

## 完了条件

1. `scripts/fetch_osm_pmtiles.py` landed、 中央定数 import
2. `pyproject.toml` に `pmtiles>=3.0` 追加、 `pip install -e .` 完了
3. README に PMTiles 手動 DL 手順 + fallback 手順 (tippecanoe) 追加
4. 実走: 適当な PMTiles ダミー入力 (= 公式 build か自前 tippecanoe build) で抽出完了
5. `sqlite3 data/tiles.sqlite "SELECT COUNT(*) FROM tiles WHERE source='osm' AND fetch_status=200"` で約 1185 件
6. metadata 7 row
7. `tests/test_fetch_osm_pmtiles.py` に **全関数 mandate** で 5-6 件:
   - `extract_tile` happy: reader.get が bytes 返す (mock) → そのまま return
   - `extract_tile` 範囲外: reader.get が None → None return
   - `insert_tile`: 200 / 404 (None data) 両方で DB row 正しい
   - `compute_to_fetch` happy: wanted=5 件 / existing=2 件 → 3 件 sort 済
   - `compute_to_fetch` 全 existing: 空 list 返る
   - `compute_to_fetch` 決定性: 同 input で同 output
8. pytest 全 green、 brief 14/15 + 本 brief = 24-30 件
9. `pmtiles>=3.0` の install verify

## ハマる罠

- pmtiles パッケージは Python 3.10+
- PMTiles は HTTP Range Request で部分読み出し可能、 ただし 1000+ タイル抽出なら一旦 DL したほうが速い
- vector tile (pbf) は MapLibre の style.json で layer 定義必須 (= brief 17b)
- Protomaps のライセンス: 配布物 ODbL、 抽出物も ODbL 派生物、 viewer 同梱時 attribution 必須 (= brief 14 で metadata に持っているので viewer が読めば義務充足)
- tippecanoe 自前 build は Windows native では困難、 WSL2 経由推奨、 README に注記

## まとめ

完了条件: script landed (中央定数 import) / pmtiles dep / 実走で OSM 1185 件抽出 / metadata 7 row / 5-6 件 unit test / 全 pytest green / README に PMTiles + tippecanoe fallback 手順。

ship される: 富士ヒル範囲 OSM ベクタタイル (約 59 MB) がローカル DB に常駐、 Protomaps URL 消滅時の自力再生手順も documented。
ship されない: PMTiles 自動 DL、 raster 化、 viewer 経路変更 (= brief 17a/17b)。

次の atom: brief 15 と並列、 両方完了で brief 17a (tile_server.py module) に進む。
