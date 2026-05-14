"""course 沿いタイル列挙の pure function 群 (brief 14).

Web Mercator XYZ scheme で (zoom, x, y) tuple の set を返す.
brief 18 で JS 版を同 logic で作るため、 cross-language fixture
(tests/test_dump_for_js.py) で出力結果を JSON にダンプし、 JS 側 test が
これを読んで一致を担保する.

公式:
    x = floor((lon + 180) / 360 * 2^zoom)
    y = floor((1 - asinh(tan(lat)) / pi) / 2 * 2^zoom)
"""

from __future__ import annotations

import math
from typing import Iterable, List, Mapping, Sequence, Set, Tuple

from .tile_constants import DEFAULT_BUFFER_M, DEFAULT_CORRIDOR_TILES


def _lonlat_to_tile(lon: float, lat: float, zoom: int) -> Tuple[int, int]:
    """(lon, lat) を XYZ スキームの (x, y) タイル座標に変換."""
    n = 1 << zoom  # 2^zoom
    x = int(math.floor((lon + 180.0) / 360.0 * n))
    lat_rad = math.radians(lat)
    y = int(math.floor((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n))
    # clamp (極端な緯度 / 経度 ラップアラウンド対策、 富士ヒル course
    # では発火しないが safety)
    x = max(0, min(n - 1, x))
    y = max(0, min(n - 1, y))
    return x, y


def enumerate_coverage_tiles(
    course: Sequence[Mapping[str, float]],
    zoom_levels: Iterable[int],
    corridor_tiles: int = DEFAULT_CORRIDOR_TILES,
) -> Set[Tuple[int, int, int]]:
    """course (lat/lon dict の列) を corridor 込みで覆うタイル座標 set を返す.

    Args:
        course: [{lat, lon, ...}, ...] の sequence. 他キーは無視.
        zoom_levels: 走査する zoom 整数の iterable.
        corridor_tiles: 各 course 点周辺の何タイルを含めるか.
            3 なら 3x3 (= 中央 + 周辺 8), 1 なら中央のみ.
            偶数を渡すと中心が定まらないので奇数推奨だが、 偶数でも
            radius=(n//2) として動作する (= ややバイアスあり).

    Returns:
        set of (zoom, x, y) tuples (XYZ scheme).
    """
    if corridor_tiles < 1:
        raise ValueError(f"corridor_tiles must be >= 1, got {corridor_tiles}")
    radius = corridor_tiles // 2  # 3 -> 1, 1 -> 0, 5 -> 2

    tiles: Set[Tuple[int, int, int]] = set()
    for zoom in zoom_levels:
        n = 1 << zoom
        for pt in course:
            cx, cy = _lonlat_to_tile(pt["lon"], pt["lat"], zoom)
            for dx in range(-radius, radius + 1):
                for dy in range(-radius, radius + 1):
                    x = cx + dx
                    y = cy + dy
                    if 0 <= x < n and 0 <= y < n:
                        tiles.add((zoom, x, y))
    return tiles


def compute_bounds(
    course: Sequence[Mapping[str, float]],
    buffer_m: float = DEFAULT_BUFFER_M,
) -> Tuple[float, float, float, float]:
    """course から外接矩形 [west, south, east, north] を返す.

    Args:
        course: [{lat, lon, ...}, ...] の sequence.
        buffer_m: 矩形に対する余白 (m). 富士ヒル course だと 1km で十分余裕.
            buffer_m を 度に変換するときは緯度依存だが (1 度 ≈ 111 km は緯度)、
            経度は cos(lat) で短くなる. 中心緯度の cos で近似.

    Returns:
        (west, south, east, north) tuple of floats (degree).
    """
    if not course:
        raise ValueError("course is empty")

    lats = [pt["lat"] for pt in course]
    lons = [pt["lon"] for pt in course]
    south, north = min(lats), max(lats)
    west, east = min(lons), max(lons)

    # buffer (m) を度に変換
    # 緯度方向: 1 度 ≈ 111_320 m
    # 経度方向: 1 度 ≈ 111_320 * cos(中心緯度) m
    lat_per_m = 1.0 / 111_320.0
    center_lat_rad = math.radians((south + north) / 2.0)
    lon_per_m = 1.0 / (111_320.0 * max(math.cos(center_lat_rad), 1e-6))

    south -= buffer_m * lat_per_m
    north += buffer_m * lat_per_m
    west -= buffer_m * lon_per_m
    east += buffer_m * lon_per_m

    return (west, south, east, north)


def estimate_tile_count(
    course: Sequence[Mapping[str, float]],
    zoom_levels: Iterable[int],
    corridor_tiles: int = DEFAULT_CORRIDOR_TILES,
) -> List[Tuple[int, int]]:
    """enumerate_coverage_tiles の結果から (zoom, count) リストを返す.

    DL 前の見積もり用. brief 14 の総量見積もり表の数値と一致するかを
    test で担保する.

    Returns:
        list of (zoom, tile_count). zoom_levels の入力順を維持.
    """
    zooms = list(zoom_levels)
    all_tiles = enumerate_coverage_tiles(course, zooms, corridor_tiles=corridor_tiles)
    counts = []
    for z in zooms:
        n = sum(1 for (zz, _x, _y) in all_tiles if zz == z)
        counts.append((z, n))
    return counts
