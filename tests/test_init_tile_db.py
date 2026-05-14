"""brief 14: scripts/init_tile_db.py の unit test (全関数 mandate)."""
import sqlite3
import sys
from pathlib import Path

import pytest

# scripts/ を path に追加 (= pyproject から scripts は package 化されてない)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))
import init_tile_db  # noqa: E402


def test_init_db_creates_empty_db_with_schema_v1(tmp_path):
    """新規 DB 作成で user_version=1 + 3 table が揃う."""
    db = tmp_path / 'tiles.sqlite'
    status = init_tile_db.init_db(db)
    assert status == 'created'
    assert db.exists()
    conn = sqlite3.connect(str(db))
    try:
        assert init_tile_db.get_user_version(conn) == 1
        tables = init_tile_db.list_tables(conn)
        assert {'tiles', 'metadata', 'schema_migrations'} <= tables
    finally:
        conn.close()


def test_init_db_inserts_migration_row(tmp_path):
    """schema_migrations に version=1 の row が入る."""
    db = tmp_path / 'tiles.sqlite'
    init_tile_db.init_db(db)
    conn = sqlite3.connect(str(db))
    try:
        cur = conn.execute(
            'SELECT version, description, applied_at FROM schema_migrations'
        )
        rows = cur.fetchall()
    finally:
        conn.close()
    assert len(rows) == 1
    assert rows[0][0] == 1
    assert 'brief 14' in rows[0][1]
    assert rows[0][2]  # applied_at は non-empty


def test_init_db_idempotent_on_existing_v1_db(tmp_path):
    """既存 schema_v1 DB に再実行しても破壊しない (= already_initialized)."""
    db = tmp_path / 'tiles.sqlite'
    init_tile_db.init_db(db)
    # 適当な metadata を入れて、 2 回目の init で消えないことを verify
    conn = sqlite3.connect(str(db))
    try:
        conn.execute(
            "INSERT INTO metadata (source, name, value) VALUES (?, ?, ?)",
            ('gsi-dem', 'note', 'sentinel'),
        )
        conn.commit()
    finally:
        conn.close()

    status = init_tile_db.init_db(db)
    assert status == 'already_initialized'

    conn = sqlite3.connect(str(db))
    try:
        cur = conn.execute(
            "SELECT value FROM metadata WHERE source='gsi-dem' AND name='note'"
        )
        rows = cur.fetchall()
        # migration row は 1 件のまま (= 重複 insert していない)
        mig_count = conn.execute(
            'SELECT COUNT(*) FROM schema_migrations'
        ).fetchone()[0]
    finally:
        conn.close()
    assert rows == [('sentinel',)]
    assert mig_count == 1


def test_init_db_raises_on_version_mismatch(tmp_path):
    """user_version が 1 でない既存 DB は error (= 将来の v2 migration 前提)."""
    db = tmp_path / 'tiles.sqlite'
    conn = sqlite3.connect(str(db))
    try:
        conn.execute('PRAGMA user_version = 99')
        conn.execute('CREATE TABLE tiles (x INTEGER)')  # dummy
        conn.commit()
    finally:
        conn.close()
    with pytest.raises(RuntimeError, match='user_version=99'):
        init_tile_db.init_db(db)


def test_init_db_creates_parent_dir(tmp_path):
    """親 directory が存在しなくても作成する."""
    db = tmp_path / 'nested' / 'dir' / 'tiles.sqlite'
    assert not db.parent.exists()
    status = init_tile_db.init_db(db)
    assert status == 'created'
    assert db.exists()
