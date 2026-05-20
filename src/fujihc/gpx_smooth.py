"""brief 23: GPX course の GPS ジッター除去 (moving average smoothing).

GPX 由来の course データは lat/lon に GPS ジッターが乗って小刻みに左右へぶれる.
zoom 23 級の道路 1 車線視点で滑らかに見えるように、 隣接点平均で smoothing する.

設計:
    - 既存の distance_m / slope_pct / elevation_m は再計算せず保持
      (= 距離・勾配は累積誤差が出やすい / elevation は DEM が真値)
    - default は lat / lon のみ smooth (options で上書き可)
    - 終端境界は window が縮む (fade): course 先頭 / 末尾は近傍が少ない分、
      原データに近い結果になる ── 端点が変な方向に飛ぶのを防ぐ.

JS 版 (web/lib/gpx_smooth.js) と同 logic / 同 signature.
cross-language fixture (tests/test_dump_for_gpx_smooth_js.py) で同値性 pin.
"""

from __future__ import annotations

from typing import Iterable, List, Mapping, Sequence


def moving_average(values: Sequence[float], window: int) -> List[float]:
    """一次元数列の moving average smoothing.

    window=N で各点を「自分を中心に最大 N 点 (端では縮む)」の平均で置換.
    奇数 window 推奨 (= 中央が定義しやすい). 偶数でも動作するが左右の重みが
    1 ずれる: half_left = (window-1)//2, half_right = window-1-half_left.

    window >= len(values) の時は全要素が全体平均と等しくなる (= 完全平均化).

    Args:
        values: smoothing 対象の数値列.
        window: 平均化窓 (1 以上の整数、 奇数推奨).

    Returns:
        同 length の smoothed 値リスト.

    Raises:
        ValueError: window が 1 未満 / 非整数の時.
    """
    if not isinstance(window, int) or window < 1:
        raise ValueError(f"moving_average: window must be positive integer, got {window!r}")
    n = len(values)
    if n == 0:
        return []
    if window == 1:
        return list(values)

    # window >= length → 全要素同じ平均.
    if window >= n:
        mean = sum(values) / n
        return [mean] * n

    half_left = (window - 1) // 2
    half_right = (window - 1) - half_left

    # O(n) prefix sum.
    prefix = [0.0] * (n + 1)
    for i in range(n):
        prefix[i + 1] = prefix[i] + values[i]

    out: List[float] = [0.0] * n
    for i in range(n):
        lo = max(0, i - half_left)
        hi = min(n, i + half_right + 1)  # exclusive
        count = hi - lo
        out[i] = (prefix[hi] - prefix[lo]) / count
    return out


def smooth_course(
    course: Sequence[Mapping[str, float]],
    window: int = 5,
    smooth_fields: Iterable[str] | None = None,
) -> List[dict]:
    """GPX course の moving average smoothing.

    default で lat / lon のみ smooth. distance_m / slope_pct / elevation_m は
    不変 (= ride 視点で「道路がギザギザ」なのは lat/lon 由来、 距離 / 勾配 /
    標高は別系統の値なので smooth しない).

    偶数 window でも動作するが (window-1)//2 前後の非対称になる. 奇数推奨.

    やりすぎ禁止 / 短距離ジグザグ補正のみ:
        default window=5 (= 各点で前後 2 + 自分、 約 20-30m スケール) は
        GPS ジッター (= 通常 5-10m 級の 1-2 点ぶれ) を除去する用. window を
        大きくしすぎる (= 11 以上) と、 50m 級の道路カーブも平滑化されて
        course が直線化 → ride 視点で「道路がコースから外れている」見え方
        になる. window 11 を渡す事は可能だが調査用、 default では使うな.

    Args:
        course: [{lat, lon, distance_m, elevation_m, slope_pct}, ...].
        window: 平均化窓 (default 5 = 各点で前後 2 点 + 自分、 ジグザグ補正
            程度に留める). 大きくしすぎ禁止 ── 道路カーブも消える.
        smooth_fields: smooth 対象 field. default ('lat', 'lon').

    Returns:
        同 length の course (dict list)、 smoothed 後の field が更新.

    Raises:
        ValueError: window が 1 未満 / 非整数の時.
    """
    if not isinstance(window, int) or window < 1:
        raise ValueError(f"smooth_course: window must be positive integer, got {window!r}")
    if len(course) == 0:
        return []
    fields = list(smooth_fields) if smooth_fields else ["lat", "lon"]

    # window=1 は identity (= shallow copy のみ).
    if window == 1:
        return [dict(p) for p in course]

    out: List[dict] = [dict(p) for p in course]
    for field in fields:
        values = [p[field] for p in course]
        smoothed = moving_average(values, window)
        for i, v in enumerate(smoothed):
            out[i][field] = v
    return out
