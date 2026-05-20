"""GSI 標高タイル (dem_png) をレート制限 DL してローカル DB に格納 (brief 15).

brief 26b で中核 logic は src/fujihc/dbinit.py に移動。 本 script は CLI wrapper.

usage:
    python scripts/fetch_gsi_dem.py
    python scripts/fetch_gsi_dem.py --course web/course.json --db data/tiles.sqlite
    python scripts/fetch_gsi_dem.py --force  # CI 用 (上限警告 skip)
"""
import argparse
import asyncio
import io
import json
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from fujihc import dbinit
from fujihc.tile_constants import (
    DEFAULT_CORRIDOR_TILES,
    FUJI_TERRAIN_BBOX,
    GSI_DEM_ZOOMS,
    GSI_RATE_LIMIT_SEC,
    TILE_FETCH_WARN_THRESHOLD,
)
from fujihc.tile_coverage import enumerate_bbox_tiles, enumerate_coverage_tiles

# 後方互換: 既存 test (= test_fetch_gsi_dem.py) が参照する公開 API.
# 中核 fetch / insert は dbinit に移動済だが、 旧 import path を維持する.
GSI_URL = dbinit.GSI_URL
DEFAULT_UA = dbinit.DEFAULT_USER_AGENT


def fetch_one(z, x, y, user_agent, timeout=10):
    """1 タイルを GSI から取得 (= dbinit の sync 版を露出).

    return: (status_code: int, data: bytes | None)
    """
    return dbinit._fetch_one_sync(z, x, y, user_agent, timeout=timeout)


def insert_tile(db, source, z, x, y, status, data, fmt='png'):
    """DB に 1 行 insert (= 既存 test が呼ぶ shim)."""
    db.execute(
        'INSERT OR REPLACE INTO tiles '
        '(source, zoom_level, tile_column, tile_row, format, data, fetched_at, fetch_status) '
        'VALUES (?, ?, ?, ?, ?, ?, datetime("now"), ?)',
        (source, z, x, y, fmt, data, status),
    )


def confirm_or_abort(count, threshold, force):
    """count > threshold なら user 確認、 force=True なら skip."""
    if count <= threshold or force:
        return True
    print(f'WARNING: about to fetch {count} tiles (> threshold {threshold}).')
    ans = input('continue? [y/N]: ').strip().lower()
    return ans in ('y', 'yes')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--course', default='web/course.json')
    parser.add_argument('--db', default='data/tiles.sqlite')
    parser.add_argument('--zoom', type=int, default=GSI_DEM_ZOOMS[0])
    parser.add_argument('--corridor-tiles', type=int, default=DEFAULT_CORRIDOR_TILES)
    parser.add_argument('--rate-limit', type=float, default=GSI_RATE_LIMIT_SEC)
    parser.add_argument(
        '--user-agent',
        default=DEFAULT_UA,
        help='GSI に送る User-Agent. OSS clone した他人は自分の連絡先に書き換えろ.',
    )
    parser.add_argument(
        '--force',
        action='store_true',
        help='DL 上限警告を skip して自動 proceed (CI 用).',
    )
    args = parser.parse_args()

    course = json.loads(Path(args.course).read_text(encoding='utf-8'))
    # fetch_gsi_async と同じ和集合 (course corridor ∪ FUJI_TERRAIN_BBOX) で
    # 事前カウント. corridor だけ数えると confirm_or_abort / 表示が実 fetch 数を
    # 大幅に過小評価する.
    coverage = enumerate_coverage_tiles(course, [args.zoom], args.corridor_tiles)
    coverage |= enumerate_bbox_tiles(FUJI_TERRAIN_BBOX, args.zoom)
    tiles = sorted(coverage)

    db_check = sqlite3.connect(args.db)
    existing = set(
        db_check.execute(
            'SELECT zoom_level, tile_column, tile_row FROM tiles WHERE source=?',
            ('gsi_dem',),
        ).fetchall()
    )
    db_check.close()
    to_fetch = [(z, x, y) for (z, x, y) in tiles if (z, x, y) not in existing]
    print(
        f'{len(tiles)} tiles in coverage, {len(existing)} already in DB, '
        f'fetching {len(to_fetch)} new at rate {args.rate_limit}s/req'
    )

    if not confirm_or_abort(len(to_fetch), TILE_FETCH_WARN_THRESHOLD, args.force):
        print('aborted')
        sys.exit(1)

    def cb(payload):
        n = payload['n']
        total = payload['total']
        phase = payload['phase']
        print(f'  [{n}/{total}] {phase}')

    result = asyncio.run(dbinit.fetch_gsi_async(
        db_path=args.db,
        course=course,
        zoom=args.zoom,
        corridor_tiles=args.corridor_tiles,
        rate_limit_sec=args.rate_limit,
        user_agent=args.user_agent,
        progress_cb=cb,
    ))
    print(f"done: fetched={result['fetched']} skipped={result['skipped']} "
          f"errors={result['errors']} total={result['total']}")


if __name__ == '__main__':
    main()
