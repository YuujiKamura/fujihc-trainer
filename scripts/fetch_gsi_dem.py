"""GSI 標高タイル (dem_png) をレート制限 DL してローカル DB に格納 (brief 15).

usage:
    python scripts/fetch_gsi_dem.py
    python scripts/fetch_gsi_dem.py --course web/course.json --db data/tiles.sqlite
    python scripts/fetch_gsi_dem.py --force  # CI 用 (上限警告 skip)
"""
import argparse
import json
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from fujihc.tile_constants import (
    DEFAULT_CORRIDOR_TILES,
    GSI_DEM_ZOOMS,
    GSI_RATE_LIMIT_SEC,
    TILE_FETCH_WARN_THRESHOLD,
)
from fujihc.tile_coverage import enumerate_coverage_tiles

GSI_URL = 'https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png'
DEFAULT_UA = 'fujihc-trainer/0.1 (https://github.com/YuujiKamura/fujihc-trainer)'


def fetch_one(z, x, y, user_agent, timeout=10):
    """1 タイルを GSI から取得. 200 / 404 / その他 を区別して返す.

    return: (status_code: int, data: bytes | None)
    """
    req = urllib.request.Request(
        GSI_URL.format(z=z, x=x, y=y),
        headers={'User-Agent': user_agent},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return (200, resp.read())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return (404, None)
        raise


def insert_tile(db, source, z, x, y, status, data, fmt='png'):
    """DB に 1 行 insert. brief 14 の fetch_status 列を使う."""
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
    tiles = sorted(enumerate_coverage_tiles(course, [args.zoom], args.corridor_tiles))

    db = sqlite3.connect(args.db)
    existing = set(
        db.execute(
            'SELECT zoom_level, tile_column, tile_row FROM tiles WHERE source=?',
            ('gsi_dem',),
        ).fetchall()
    )
    to_fetch = [(z, x, y) for (z, x, y) in tiles if (z, x, y) not in existing]
    print(
        f'{len(tiles)} tiles in coverage, {len(existing)} already in DB, '
        f'fetching {len(to_fetch)} new at rate {args.rate_limit}s/req'
    )

    if not confirm_or_abort(len(to_fetch), TILE_FETCH_WARN_THRESHOLD, args.force):
        print('aborted')
        sys.exit(1)

    for i, (z, x, y) in enumerate(to_fetch):
        status, data = fetch_one(z, x, y, args.user_agent)
        insert_tile(db, 'gsi_dem', z, x, y, status, data)
        db.commit()
        print(f'  [{i + 1}/{len(to_fetch)}] {z}/{x}/{y} {status}')
        time.sleep(args.rate_limit)

    # metadata 更新
    for name, value in [
        ('attribution', '国土地理院 標高タイル (dem_png)'),
        ('format', 'png'),
        ('minzoom', str(args.zoom)),
        ('maxzoom', str(args.zoom)),
        ('user_agent_used', args.user_agent),
        ('fetched_by', 'scripts/fetch_gsi_dem.py'),
    ]:
        db.execute(
            'INSERT OR REPLACE INTO metadata (source, name, value) VALUES (?, ?, ?)',
            ('gsi_dem', name, value),
        )
    db.commit()
    db.close()
    print(f'done: {len(to_fetch)} new tiles, total {len(tiles)} in coverage')


if __name__ == '__main__':
    main()
