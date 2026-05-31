"""brief 31 + b69: scripts/export_static.py の単体 test.

b69 で GSI DEM タイルの静的展開 (= `export_gsi_dem_tree`) を撤去した。
SoT 統一で course.json は web/static/ 自体が source、 `copy_course` も撤去。
本 test は pmtiles コピーと main() 接続 + 物理 grep gate を pin する。
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import export_static  # noqa: E402


def test_copy_pmtiles_size_match(tmp_path: Path) -> None:
    """copy_pmtiles 後 size 一致 (= shutil.copy2)。"""
    src = tmp_path / "src.pmtiles"
    payload = b"PMTILES_FAKE" + b"\x00" * 1024
    src.write_bytes(payload)
    dst = tmp_path / "out" / "map.pmtiles"
    size = export_static.copy_pmtiles(src, dst)
    assert dst.exists()
    assert size == len(payload)
    assert dst.read_bytes() == payload


def test_export_static_no_http_url_in_source() -> None:
    """物理 grep gate: export_static.py source 内に http:// / https:// 一切含まない (= 外部 fetch ゼロ規律)。"""
    src_path = REPO_ROOT / "scripts" / "export_static.py"
    text = src_path.read_text(encoding="utf-8")
    assert "http://" not in text, "external HTTP URL appeared in export_static.py"
    assert "https://" not in text, "external HTTPS URL appeared in export_static.py"


def test_export_static_no_gsi_dem_extraction_in_source() -> None:
    """b69 物理 grep gate: GSI DEM 静的展開系の実装識別子が source に残っていない。

    catalog C2 (e) 解消 ── 撤去 brief は「旧コードが無いこと」 を negative grep で pin。
    対象は実装識別子 (= 関数名 `export_gsi_dem_tree`、 SQLite 接続呼出 `sqlite3.connect`、
    `bytes write` 等の DEM 展開 API)。 docstring の歴史的注記 (= 「`data/tiles.sqlite` の
    静的展開を撤去」 等の説明文) は対象外 ── 撤去を説明する prose まで禁止すると
    false positive で gate が壊れる。
    """
    src_path = REPO_ROOT / "scripts" / "export_static.py"
    text = src_path.read_text(encoding="utf-8")
    forbidden_tokens = [
        "export_gsi_dem_tree",  # 撤去した関数名
        "sqlite3.connect",      # SQLite 接続呼出 (= DEM BLOB 読み出し経路)
        "write_bytes",          # DEM PNG bytes 書き出し API
    ]
    for token in forbidden_tokens:
        assert token not in text, (
            f"撤去対象トークン '{token}' が export_static.py に残っている (= b69 撤去未完)"
        )


def test_main_argparse_smoke(tmp_path: Path) -> None:
    """main() が argparse + pmtiles 展開で 0 を返す (= CLI 接続 smoke)。

    b69: --db 引数と GSI DEM 出力の assert を撤去。
    SoT 統一: --course 引数と course.json コピー assert を撤去 (= web/static/ 自体が source)。
    """
    pmt = tmp_path / "fuji.pmtiles"
    pmt.write_bytes(b"PMTILES" + b"\x00" * 16)
    out = tmp_path / "out"
    rc = export_static.main([
        "--pmtiles", str(pmt),
        "--out", str(out),
    ])
    assert rc == 0
    assert (out / "map.pmtiles").exists()
    # GSI DEM 出力は生成されない (= b69 撤去)
    assert not (out / "tiles" / "gsi_dem").exists(), (
        "b69 撤去後は web/static/tiles/gsi_dem/ が生成されてはならない"
    )
