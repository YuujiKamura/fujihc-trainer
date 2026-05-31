"""GitHub Pages 静的サイト用 export (= pmtiles のみ).

`data/fuji.pmtiles` (= 自前 OSM ビルド、 ODbL、 出典明示で配信可) を
`web/static/` 配下に展開する thin wrapper。 GitHub Actions と user ローカル両方から
呼べる。

course.json は SoT 統一で `web/static/course.json` 自体が source、 本 script の
役割から外れた (= 自己コピー不要、 旧 `web/course.json` は撤去)。

GSI DEM タイルは b69 で撤去。 配信物への DEM 同梱は `scripts/build_pages.py` の
`strip_redistribution_restricted` / `verify_no_dem` が物理 gate として残る。

外部 fetch ゼロ規律: 本 source 内に外部 URL scheme 文字列を一切含まない。
viewer_url_audit 同型の物理 grep gate (= tests/test_export_static.py) で pin される。
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def copy_pmtiles(src: Path, dst: Path) -> int:
    """data/fuji.pmtiles を web/static/map.pmtiles に shutil.copy2。

    Returns: コピー後 size (bytes)。
    """
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(str(src), str(dst))
    return dst.stat().st_size


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="export web/static/ for GitHub Pages")
    p.add_argument("--pmtiles", default=str(REPO_ROOT / "data" / "fuji.pmtiles"))
    p.add_argument("--out", default=str(REPO_ROOT / "web" / "static"))
    args = p.parse_args(argv)

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    pmt_size = copy_pmtiles(Path(args.pmtiles), out_dir / "map.pmtiles")
    print(f"[export_static] map.pmtiles: {pmt_size} bytes -> {out_dir / 'map.pmtiles'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
