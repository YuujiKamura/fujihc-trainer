"""brief 16 + 26b: Protomaps PMTiles から富士ヒル範囲を抽出して DB に格納.

中核 logic は src/fujihill/dbinit.py の extract_osm_async に移動。 本 script は
CLI wrapper (= 後方互換 + 直接呼び出し用).

usage:
    # 1. https://maps.protomaps.com/builds/ から日本サブセット PMTiles を DL
    # 2. 抽出:
    python scripts/fetch_osm_pmtiles.py --pmtiles ~/Downloads/japan.pmtiles
    # 3. 元 PMTiles は不要なら削除可

`tile.openstreetmap.org` から bulk DL は OSM Tile Usage Policy 違反のため、
Protomaps の OSM 派生 PMTiles (ODbL 配下、 再配布許可) 経由で抽出する。
"""
import argparse
import asyncio
import json
import sqlite3
from pathlib import Path

from fujihill import dbinit
from fujihill.tile_constants import (
    DEFAULT_CORRIDOR_TILES,
    OSM_VECTOR_ZOOMS,
    TILE_FETCH_WARN_THRESHOLD,
)
from fujihill.tile_coverage import enumerate_coverage_tiles


def extract_tile(reader, z, x, y):
    """PMTiles reader から 1 タイルを read. 範囲外なら None."""
    return reader.get(z, x, y)


def insert_tile(db, source, z, x, y, status, data, fmt='pbf'):
    """tiles テーブルに 1 行 insert (= 既存 test が呼ぶ shim)."""
    db.execute(
        'INSERT OR REPLACE INTO tiles '
        '(source, zoom_level, tile_column, tile_row, format, data, fetched_at, fetch_status) '
        'VALUES (?, ?, ?, ?, ?, ?, datetime("now"), ?)',
        (source, z, x, y, fmt, data, status),
    )


def compute_to_fetch(wanted_tiles, existing_set):
    """wanted から existing を引いた set を sort して返す (= 決定性)."""
    return sorted([t for t in wanted_tiles if t not in existing_set])


def main():
    # pmtiles import を main 内で遅延 (= test 時に install 不要)
    try:
        from pmtiles.reader import Reader, MmapSource  # noqa: F401
    except ImportError:
        print('ERROR: pmtiles package not installed. run: pip install -e .')
        raise SystemExit(1)

    parser = argparse.ArgumentParser(
        description='Extract OSM vector tiles from Protomaps PMTiles into local SQLite DB.'
    )
    parser.add_argument('--pmtiles', required=True,
                        help='ローカル PMTiles ファイル path. Protomaps の build を事前 DL.')
    parser.add_argument('--course', default='web/course.json')
    parser.add_argument('--db', default='data/tiles.sqlite')
    parser.add_argument('--corridor-tiles', type=int, default=DEFAULT_CORRIDOR_TILES)
    parser.add_argument('--force', action='store_true',
                        help='上限警告を skip (= 自動実行用)')
    args = parser.parse_args()

    course = json.loads(Path(args.course).read_text(encoding='utf-8'))
    wanted = enumerate_coverage_tiles(course, OSM_VECTOR_ZOOMS, args.corridor_tiles)
    print(f'want {len(wanted)} tiles across z={OSM_VECTOR_ZOOMS}, '
          f'corridor={args.corridor_tiles}')

    db_check = sqlite3.connect(args.db)
    existing = set(db_check.execute(
        'SELECT zoom_level, tile_column, tile_row FROM tiles WHERE source=?',
        ('osm',),
    ).fetchall())
    db_check.close()
    to_fetch = compute_to_fetch(wanted, existing)
    print(f'{len(existing)} already in DB, extracting {len(to_fetch)} new')

    if len(to_fetch) > TILE_FETCH_WARN_THRESHOLD and not args.force:
        ans = input(f'WARNING: about to extract {len(to_fetch)} tiles. continue? [y/N]: ')
        if ans.strip().lower() not in ('y', 'yes'):
            print('aborted')
            return

    def cb(payload):
        n = payload['n']
        total = payload['total']
        phase = payload['phase']
        if n % 100 == 0 or phase == 'done':
            print(f'  [{n}/{total}] {phase}')

    result = asyncio.run(dbinit.extract_osm_async(
        db_path=args.db,
        pmtiles_path=args.pmtiles,
        course=course,
        corridor_tiles=args.corridor_tiles,
        progress_cb=cb,
    ))
    print(f"done: extracted={result['extracted']} skipped={result['skipped']} "
          f"out_of_range={result['out_of_range']} total={result['total']}")


if __name__ == '__main__':
    main()
