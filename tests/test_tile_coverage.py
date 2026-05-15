"""brief 14: tile_coverage.py の 3 pure 関数 全関数 mandate test.

happy / edge / 決定性 / boundary を網羅する.
富士ヒル course (web/course.json, 1968 点) を実 input にした assertion を含む.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "src"))

from fujihill.tile_constants import DEFAULT_BUFFER_M, DEFAULT_CORRIDOR_TILES  # noqa: E402
from fujihill.tile_coverage import (  # noqa: E402
    compute_bounds,
    enumerate_coverage_tiles,
    estimate_tile_count,
)

COURSE_JSON = REPO_ROOT / "web" / "course.json"


@pytest.fixture(scope="module")
def fuji_course():
    """富士ヒル course (1968 点) を load. brief 14 の数値根拠."""
    with COURSE_JSON.open(encoding="utf-8") as f:
        course = json.load(f)
    assert len(course) == 1968, f"expected 1968 points, got {len(course)}"
    return course


# ---------------------------------------------------------------------------
# enumerate_coverage_tiles
# ---------------------------------------------------------------------------


def test_enumerate_coverage_tiles_fujihill_z17_corridor3_300(fuji_course):
    """富士ヒル course を corridor=3 で z=17 → 300 タイル (brief 14 確定値)."""
    tiles = enumerate_coverage_tiles(fuji_course, [17], corridor_tiles=3)
    assert len(tiles) == 300


def test_enumerate_coverage_tiles_table_values(fuji_course):
    """brief 14 の見積もり表と一致を全 zoom で担保 (= 14:36, 15:70, 16:148, 17:300, 18:631)."""
    expected = {14: 36, 15: 70, 16: 148, 17: 300, 18: 631}
    for zoom, exp_count in expected.items():
        tiles = enumerate_coverage_tiles(fuji_course, [zoom], corridor_tiles=3)
        assert len(tiles) == exp_count, (
            f"zoom={zoom}: expected {exp_count} tiles, got {len(tiles)}"
        )


def test_enumerate_coverage_tiles_corridor_1_vs_3_differ(fuji_course):
    """corridor=1 (中央のみ) と corridor=3 (3x3) で差が出る. 1 < 3 厳密."""
    c1 = enumerate_coverage_tiles(fuji_course, [17], corridor_tiles=1)
    c3 = enumerate_coverage_tiles(fuji_course, [17], corridor_tiles=3)
    assert len(c1) < len(c3)
    # corridor=1 の結果は corridor=3 の subset
    assert c1.issubset(c3)


def test_enumerate_coverage_tiles_deterministic(fuji_course):
    """同 input で同 output (set 順序非依存)."""
    a = enumerate_coverage_tiles(fuji_course, [17], corridor_tiles=3)
    b = enumerate_coverage_tiles(fuji_course, [17], corridor_tiles=3)
    assert a == b


def test_enumerate_coverage_tiles_invalid_corridor_raises():
    """corridor_tiles < 1 は ValueError."""
    with pytest.raises(ValueError):
        enumerate_coverage_tiles([{"lat": 35.4, "lon": 138.7}], [17], corridor_tiles=0)


def test_enumerate_coverage_tiles_single_point_corridor_3():
    """1 点だけの course でも corridor=3 で 9 タイル (3x3) 返る (境界外せず)."""
    # 富士山頂近辺 1 点, タイル境界からの偏りで 9 を割ることはない
    tiles = enumerate_coverage_tiles(
        [{"lat": 35.40, "lon": 138.72}], [17], corridor_tiles=3
    )
    assert len(tiles) == 9
    zooms = {z for (z, _x, _y) in tiles}
    assert zooms == {17}


# ---------------------------------------------------------------------------
# compute_bounds
# ---------------------------------------------------------------------------


def test_compute_bounds_fujihill_with_1km_buffer(fuji_course):
    """富士ヒル course, buffer=1km の bounds が brief 14 期待値 (±誤差) を満たす.

    brief 14: W=138.681 S=35.364 E=138.768 N=35.461 (buffer 1km 込み).
    ±0.005 度 (= 約 500 m) 許容. 1 km buffer の round-trip 誤差を吸収.
    """
    west, south, east, north = compute_bounds(fuji_course, buffer_m=1000)
    assert west == pytest.approx(138.681, abs=0.005)
    assert south == pytest.approx(35.364, abs=0.005)
    assert east == pytest.approx(138.768, abs=0.005)
    assert north == pytest.approx(35.461, abs=0.005)
    # 順序の sanity
    assert west < east
    assert south < north


def test_compute_bounds_single_point():
    """1 点だけの course でも返る (= buffer で広がる)."""
    pt = [{"lat": 35.40, "lon": 138.72}]
    w, s, e, n = compute_bounds(pt, buffer_m=1000)
    # buffer 1km で広がるので west < lon < east, south < lat < north
    assert w < 138.72 < e
    assert s < 35.40 < n


def test_compute_bounds_empty_raises():
    """空 course は ValueError."""
    with pytest.raises(ValueError):
        compute_bounds([])


# ---------------------------------------------------------------------------
# estimate_tile_count
# ---------------------------------------------------------------------------


def test_estimate_tile_count_table_matches(fuji_course):
    """brief 14 の見積もり表と estimate_tile_count の数値が一致."""
    result = estimate_tile_count(fuji_course, [14, 15, 16, 17, 18], corridor_tiles=3)
    expected = [(14, 36), (15, 70), (16, 148), (17, 300), (18, 631)]
    assert result == expected


def test_estimate_tile_count_monotonic_in_zoom(fuji_course):
    """zoom が上がるとタイル数が単調増加 (corridor 固定)."""
    result = estimate_tile_count(fuji_course, [14, 15, 16, 17, 18], corridor_tiles=3)
    counts = [c for (_z, c) in result]
    for prev, nxt in zip(counts, counts[1:]):
        assert prev < nxt, f"non-monotonic: {counts}"


def test_estimate_tile_count_preserves_zoom_order(fuji_course):
    """estimate_tile_count は入力 zoom_levels の順序を保つ."""
    result = estimate_tile_count(fuji_course, [17, 14], corridor_tiles=3)
    assert [z for (z, _c) in result] == [17, 14]


# ---------------------------------------------------------------------------
# default constants が import 経路で見えること (= 中央定数の sanity)
# ---------------------------------------------------------------------------


def test_default_corridor_tiles_is_3():
    assert DEFAULT_CORRIDOR_TILES == 3


def test_default_buffer_m_is_1000():
    assert DEFAULT_BUFFER_M == 1000
