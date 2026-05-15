"""brief 14 / brief 18 cross-language fixture 生成 test.

Python の enumerate_coverage_tiles と compute_bounds の結果を JSON で
web/tests/fixtures/py_coverage_z14.json に出力する.
brief 18 の JS test がこの JSON を読み、 同 input で生成した自分の出力と
一致を担保する (= Python と JS が同じ logic で動いている保証).

このテストは「fixture 生成」を兼ねており、 走らせるだけで JSON を作る.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "src"))

from fujihill.tile_coverage import compute_bounds, enumerate_coverage_tiles  # noqa: E402

COURSE_JSON = REPO_ROOT / "web" / "course.json"
FIXTURE_DIR = REPO_ROOT / "web" / "tests" / "fixtures"
FIXTURE_PATH = FIXTURE_DIR / "py_coverage_z14.json"


@pytest.fixture(scope="module")
def fuji_course():
    with COURSE_JSON.open(encoding="utf-8") as f:
        return json.load(f)


def test_dump_py_coverage_fixture(fuji_course):
    """brief 18 JS test が読む cross-language fixture を出力 + 中身 assertion."""
    # 計算
    tiles_z17_c3 = enumerate_coverage_tiles(fuji_course, [17], corridor_tiles=3)
    tiles_z17_c1 = enumerate_coverage_tiles(fuji_course, [17], corridor_tiles=1)
    bounds_1km = compute_bounds(fuji_course, buffer_m=1000)
    bounds_0 = compute_bounds(fuji_course, buffer_m=0)

    payload = {
        "schema": "py_coverage/v1",
        "course_points": len(fuji_course),
        "tiles_z17_corridor3": {
            "count": len(tiles_z17_c3),
            # set -> sorted list of [z, x, y] for deterministic JSON
            "tiles": sorted([list(t) for t in tiles_z17_c3]),
        },
        "tiles_z17_corridor1": {
            "count": len(tiles_z17_c1),
            "tiles": sorted([list(t) for t in tiles_z17_c1]),
        },
        "bounds_1km": {
            "west": bounds_1km[0],
            "south": bounds_1km[1],
            "east": bounds_1km[2],
            "north": bounds_1km[3],
        },
        "bounds_no_buffer": {
            "west": bounds_0[0],
            "south": bounds_0[1],
            "east": bounds_0[2],
            "north": bounds_0[3],
        },
    }

    # 出力
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    with FIXTURE_PATH.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2, sort_keys=True)

    # 出力直後の sanity (= round-trip と数値固定)
    assert FIXTURE_PATH.exists()
    reloaded = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    assert reloaded["schema"] == "py_coverage/v1"
    assert reloaded["course_points"] == 1968
    assert reloaded["tiles_z17_corridor3"]["count"] == 300
    assert len(reloaded["tiles_z17_corridor3"]["tiles"]) == 300
    # corridor=1 (= 中央のみ) は 3 より少ない
    assert reloaded["tiles_z17_corridor1"]["count"] < 300
    # bounds 1km は no_buffer より広い
    assert reloaded["bounds_1km"]["west"] < reloaded["bounds_no_buffer"]["west"]
    assert reloaded["bounds_1km"]["east"] > reloaded["bounds_no_buffer"]["east"]
    assert reloaded["bounds_1km"]["south"] < reloaded["bounds_no_buffer"]["south"]
    assert reloaded["bounds_1km"]["north"] > reloaded["bounds_no_buffer"]["north"]
