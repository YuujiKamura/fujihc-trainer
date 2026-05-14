"""brief 31: GitHub Pages 静的サイト用 export.

data/tiles.sqlite (= gsi_dem BLOB tree) + data/fuji.pmtiles + web/course.json を
web/static/ 配下に展開する。 GitHub Actions と user ローカル両方から呼べる thin wrapper。

外部 fetch ゼロ規律: 本 source 内に外部 URL scheme 文字列を一切含まない。
viewer_url_audit 同型の物理 grep gate (= tests/test_export_static.py) で pin される。
"""

from __future__ import annotations

import argparse
import shutil
import sqlite3
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def export_gsi_dem_tree(db_path: Path, out_dir: Path) -> int:
    """SQLite から source='gsi_dem' AND fetch_status=200 AND data IS NOT NULL の row を全件 SELECT、
    out_dir / 'tiles' / 'gsi_dem' / str(z) / str(x) / f'{y}.png' に bytes write。

    Returns: write した file 数 (= row 数 と一致)。
    """
    out_root = out_dir / "tiles" / "gsi_dem"
    out_root.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(db_path))
    try:
        cur = con.execute(
            "SELECT zoom_level, tile_column, tile_row, data "
            "FROM tiles "
            "WHERE source = 'gsi_dem' AND fetch_status = 200 AND data IS NOT NULL"
        )
        n = 0
        for z, x, y, data in cur:
            tile_path = out_root / str(z) / str(x) / f"{y}.png"
            tile_path.parent.mkdir(parents=True, exist_ok=True)
            tile_path.write_bytes(data)
            n += 1
        return n
    finally:
        con.close()


def copy_pmtiles(src: Path, dst: Path) -> int:
    """data/fuji.pmtiles を web/static/map.pmtiles に shutil.copy2。

    Returns: コピー後 size (bytes)。
    """
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(str(src), str(dst))
    return dst.stat().st_size


def copy_course(src: Path, dst: Path) -> int:
    """web/course.json を web/static/course.json に shutil.copy2。

    Returns: コピー後 size (bytes)。
    """
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(str(src), str(dst))
    return dst.stat().st_size


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="export web/static/ for GitHub Pages")
    p.add_argument("--db", default=str(REPO_ROOT / "data" / "tiles.sqlite"))
    p.add_argument("--pmtiles", default=str(REPO_ROOT / "data" / "fuji.pmtiles"))
    p.add_argument("--course", default=str(REPO_ROOT / "web" / "course.json"))
    p.add_argument("--out", default=str(REPO_ROOT / "web" / "static"))
    args = p.parse_args(argv)

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    n_tiles = export_gsi_dem_tree(Path(args.db), out_dir)
    print(f"[export_static] gsi_dem PNG: {n_tiles} files -> {out_dir / 'tiles' / 'gsi_dem'}")

    pmt_size = copy_pmtiles(Path(args.pmtiles), out_dir / "map.pmtiles")
    print(f"[export_static] map.pmtiles: {pmt_size} bytes -> {out_dir / 'map.pmtiles'}")

    course_size = copy_course(Path(args.course), out_dir / "course.json")
    print(f"[export_static] course.json: {course_size} bytes -> {out_dir / 'course.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
