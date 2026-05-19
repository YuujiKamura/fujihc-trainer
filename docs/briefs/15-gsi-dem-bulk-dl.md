---
brief: 15-gsi-dem-bulk-dl
title: GSI dem_png をレート制限 DL してローカル DB に格納
parent_project: ~/fujihc-trainer/
created: 2026-05-14
revised: 2026-05-14 (Round 2: UA 引数化 / DL 上限 abort / 中央定数参照 / 全関数 test)
depends_on: [14-tile-local-db]
blocks: [17a-tile-server-module]
---

# Brief 15: GSI 標高タイル 一括 DL

## はじめに

brief 14 で確定した `data/tiles.sqlite` に、 富士ヒル外接矩形 + 余白 1km の GSI dem_png タイル (zoom 14) を 1 回だけレート制限 DL して格納する。 地理院タイル利用規約はキャッシュを明示許可、 レート制限 (1 req/s) で計画的に取れば policy 内。

brief 14 の総量見積もりより: **zoom 14 で 36 タイル / 約 1 MB / DL 時間 36 秒**。 1 ride 1 回どころか「初回セットアップ 1 回」で済む。 7 軸 audit のセキュリティ境界軸 LOAD-BEARING NG (= GSI 大量アクセス) を根本解として閉じる工程。

Round 2 audit を受けて 3 点を確定:
1. **User-Agent を `--user-agent` 引数化**、 hardcode 撤回 (= OSS 配布時に他人が yuuji の email で叩く事故を防ぐ)
2. **DL 上限警告 + 自動 abort**: `TILE_FETCH_WARN_THRESHOLD` (= brief 14 中央定数 1000) を超える時は user 確認 prompt
3. **全関数 mandate**: `fetch_one` だけでなく `main` 内 ロジック (resume / metadata / abort) を全部 test

## 実装する script

`scripts/fetch_gsi_dem.py` を新規。 brief 14 の中央定数を import:

```python
# scripts/fetch_gsi_dem.py
import argparse, json, sqlite3, sys, time, urllib.request, urllib.error
from pathlib import Path
from fujihc.tile_constants import (
    DEFAULT_CORRIDOR_TILES, DEFAULT_BUFFER_M, GSI_DEM_ZOOMS,
    GSI_RATE_LIMIT_SEC, TILE_FETCH_WARN_THRESHOLD,
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
    parser.add_argument('--db',     default='data/tiles.sqlite')
    parser.add_argument('--zoom',   type=int, default=GSI_DEM_ZOOMS[0])
    parser.add_argument('--corridor-tiles', type=int, default=DEFAULT_CORRIDOR_TILES)
    parser.add_argument('--rate-limit', type=float, default=GSI_RATE_LIMIT_SEC)
    parser.add_argument('--user-agent', default=DEFAULT_UA,
        help='GSI に送る User-Agent. OSS clone した他人は自分の連絡先に書き換えろ.')
    parser.add_argument('--force', action='store_true',
        help='DL 上限警告を skip して自動 proceed (CI 用).')
    args = parser.parse_args()

    course = json.loads(Path(args.course).read_text(encoding='utf-8'))
    tiles = sorted(enumerate_coverage_tiles(course, [args.zoom], args.corridor_tiles))

    db = sqlite3.connect(args.db)
    existing = set(db.execute(
        'SELECT zoom_level, tile_column, tile_row FROM tiles WHERE source=?', ('gsi_dem',)
    ).fetchall())
    to_fetch = [(z, x, y) for (z, x, y) in tiles if (z, x, y) not in existing]
    print(f'{len(tiles)} tiles in coverage, {len(existing)} already in DB, '
          f'fetching {len(to_fetch)} new at rate {args.rate_limit}s/req')

    if not confirm_or_abort(len(to_fetch), TILE_FETCH_WARN_THRESHOLD, args.force):
        print('aborted')
        sys.exit(1)

    for i, (z, x, y) in enumerate(to_fetch):
        status, data = fetch_one(z, x, y, args.user_agent)
        insert_tile(db, 'gsi_dem', z, x, y, status, data)
        db.commit()
        print(f'  [{i+1}/{len(to_fetch)}] {z}/{x}/{y} {status}')
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
```

## やらないこと

- 別 zoom 級の DL (= zoom 14 で十分、 brief 14 の `GSI_DEM_ZOOMS` 中央定数で固定)
- OSM タイル DL (= brief 16)
- viewer 経路変更 (= brief 17a/17b)
- DB の git commit (= `.gitignore` 済)
- User-Agent に email hardcode (= 引数化、 OSS 配布時の事故回避)

## 完了条件

1. `scripts/fetch_gsi_dem.py` landed、 中央定数を import
2. 実行: `python scripts/fetch_gsi_dem.py` → 36 タイル、 36 秒で完了
3. `sqlite3 data/tiles.sqlite "SELECT COUNT(*) FROM tiles WHERE source='gsi_dem'"` で 36 件 (404 込み)、 200 のみは 30 件前後 (= 海面下 / 山頂周辺で 404 が数件)
4. `sqlite3 ... "SELECT * FROM metadata WHERE source='gsi_dem'"` で 6 row
5. 2 回目実行 → "fetching 0 new" で即終了 (= resume 動作)
6. `tests/test_fetch_gsi_dem.py` に **全関数 mandate** で 5-7 件:
   - `fetch_one` happy: 200 + bytes 返る (mock)
   - `fetch_one` 404: (404, None) 返る (mock)
   - `fetch_one` その他 HTTPError: raise する (mock)
   - `insert_tile`: 200 / 404 で DB に row 入る、 fetch_status 列が正しい
   - `confirm_or_abort` happy: threshold 以下なら True
   - `confirm_or_abort` threshold 超: input mock で y/N の両方を確認
   - `confirm_or_abort` force=True: prompt skip して True
7. pytest 全 green (brief 14 で +7-9 = 19-24 件)、 既存 backend test も green

## ハマる罠

- GSI dem_png は海面下や標高 0m 周辺で 404、 例外で止まらず fetch_status=404 として行を残す
- rate limit を破ると GSI 側で IP 一時 block (= 数時間)、 1 req/s 厳守、 並列禁止
- User-Agent に email を入れる是非: 地理院は heavy user 同定に email を期待、 ただし OSS 配布時に他人が同 UA を使う事故を避けるため引数化。 default はリポ URL のみ
- 富士ヒル外接矩形が富士山頂周辺を含む = 標高 3776m まで含む、 GSI dem の符号化範囲 (-32768 ~ 8388608 m) 内なので問題なし
- `confirm_or_abort` の input mock は `monkeypatch.setattr('builtins.input', ...)` で

## まとめ

完了条件: script landed (中央定数 import) / 実走 36 タイル / metadata 6 row / resume 動作 / 5-7 件 unit test / 全 pytest green / README に DL 時間記載済 (brief 14 完了条件 8)。

ship される: 富士ヒル範囲の GSI 標高タイル (36 タイル / 約 1 MB) がローカル DB に常駐、 走行時の外部 fetch 不要状態の標高側。
ship されない: OSM タイル (= brief 16)、 viewer 経路変更 (= brief 17a/17b)。

次の atom: brief 16 (OSM PMTiles) と並列着手可能、 両方完了で brief 17a/17b に進む。
