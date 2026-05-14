"""空の tile cache SQLite DB を schema_v1 で作成 (brief 14).

usage:
    python scripts/init_tile_db.py
    python scripts/init_tile_db.py --db data/tiles.sqlite
"""
import argparse
import sqlite3
from pathlib import Path

SCHEMA_VERSION = 1
SCHEMA_DESCRIPTION = 'initial schema, brief 14'

DDL_STATEMENTS = [
    """
    CREATE TABLE tiles (
      source TEXT NOT NULL,
      zoom_level INTEGER NOT NULL,
      tile_column INTEGER NOT NULL,
      tile_row INTEGER NOT NULL,
      format TEXT NOT NULL,
      data BLOB,
      fetched_at TEXT NOT NULL,
      fetch_status INTEGER NOT NULL DEFAULT 200,
      PRIMARY KEY (source, zoom_level, tile_column, tile_row)
    )
    """,
    "CREATE INDEX idx_tiles_source_zxy ON tiles(source, zoom_level, tile_column, tile_row)",
    """
    CREATE TABLE metadata (
      source TEXT NOT NULL,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (source, name)
    )
    """,
    """
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL,
      description TEXT NOT NULL
    )
    """,
]

EXPECTED_TABLES = {'tiles', 'metadata', 'schema_migrations'}


def get_user_version(conn: sqlite3.Connection) -> int:
    """PRAGMA user_version の現在値を返す."""
    cur = conn.execute('PRAGMA user_version')
    return cur.fetchone()[0]


def list_tables(conn: sqlite3.Connection) -> set:
    """sqlite_master から table 名 set を返す."""
    cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    return {row[0] for row in cur.fetchall()}


def apply_schema_v1(conn: sqlite3.Connection) -> None:
    """空 DB に schema_v1 を作成し migration row を入れる."""
    for stmt in DDL_STATEMENTS:
        conn.execute(stmt)
    conn.execute(
        "INSERT INTO schema_migrations (version, applied_at, description) "
        "VALUES (?, datetime('now'), ?)",
        (SCHEMA_VERSION, SCHEMA_DESCRIPTION),
    )
    conn.execute(f'PRAGMA user_version = {SCHEMA_VERSION}')
    conn.commit()


def init_db(db_path: Path) -> str:
    """指定 path に DB を作成 or idempotent 確認.

    returns: 'created' (新規) / 'already_initialized' (既存で schema_v1 一致).
    raises: RuntimeError (= 既存 DB の user_version が 1 でない / 想定 table 欠落)
    """
    db_path.parent.mkdir(parents=True, exist_ok=True)
    existed = db_path.exists()
    conn = sqlite3.connect(str(db_path))
    try:
        if existed:
            version = get_user_version(conn)
            tables = list_tables(conn)
            if version == 0 and not (tables & EXPECTED_TABLES):
                # 既存 file だが空 (= touch だけされたケース) → 普通に apply
                apply_schema_v1(conn)
                return 'created'
            if version != SCHEMA_VERSION:
                raise RuntimeError(
                    f'existing DB {db_path} has user_version={version}, '
                    f'expected {SCHEMA_VERSION}'
                )
            missing = EXPECTED_TABLES - tables
            if missing:
                raise RuntimeError(
                    f'existing DB {db_path} is missing tables: {sorted(missing)}'
                )
            return 'already_initialized'
        apply_schema_v1(conn)
        return 'created'
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        '--db', default='data/tiles.sqlite',
        help='SQLite DB path (default: data/tiles.sqlite)',
    )
    args = parser.parse_args()
    db_path = Path(args.db)
    status = init_db(db_path)
    print(f'{status}: {db_path}')


if __name__ == '__main__':
    main()
