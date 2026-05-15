"""brief 23: gpx_smooth.py のユニットテスト + cross-language fixture 出力.

全関数 mandate で moving_average / smooth_course を網羅し、 同時に JS 側 test
(web/tests/gpx_smooth.test.js) が読む cross-language fixture を出力する.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "src"))

from fujihill.gpx_smooth import moving_average, smooth_course  # noqa: E402

COURSE_JSON = REPO_ROOT / "web" / "course.json"
FIXTURE_DIR = REPO_ROOT / "web" / "tests" / "fixtures"
FIXTURE_PATH = FIXTURE_DIR / "py_gpx_smooth.json"


@pytest.fixture(scope="module")
def fuji_course():
    with COURSE_JSON.open(encoding="utf-8") as f:
        return json.load(f)


# ---------- moving_average ----------

def test_moving_average_window3_simple():
    """window=3 で [1,2,3,4,5] → [1.5, 2, 3, 4, 4.5] (端は縮む)."""
    out = moving_average([1, 2, 3, 4, 5], 3)
    assert out == pytest.approx([1.5, 2.0, 3.0, 4.0, 4.5])


def test_moving_average_window1_is_identity():
    """window=1 は値をそのまま返す."""
    values = [1.0, 2.5, -3.0, 4.0]
    out = moving_average(values, 1)
    assert out == values
    # ただし新しい list を返す (= 入力 alias しない).
    assert out is not values


def test_moving_average_window_exceeds_length_returns_global_mean():
    """window=length+1 (= 全要素平均で全部埋める)."""
    values = [1, 2, 3, 4, 5]
    out = moving_average(values, 6)  # 5 + 1
    mean = sum(values) / len(values)  # 3.0
    assert out == pytest.approx([mean] * 5)


def test_moving_average_empty_input():
    """空入力は空出力."""
    assert moving_average([], 11) == []


def test_moving_average_invalid_window_raises():
    """window が 0 / 負 / float の時は ValueError."""
    with pytest.raises(ValueError):
        moving_average([1, 2, 3], 0)
    with pytest.raises(ValueError):
        moving_average([1, 2, 3], -1)
    with pytest.raises(ValueError):
        moving_average([1, 2, 3], 1.5)  # type: ignore[arg-type]


# ---------- smooth_course ----------

def test_smooth_course_window1_identity(fuji_course):
    """window=1 は値が全て同じ (= shallow copy)."""
    out = smooth_course(fuji_course, window=1)
    assert len(out) == len(fuji_course)
    for orig, sm in zip(fuji_course, out):
        assert sm == orig
        assert sm is not orig  # 別 dict.


def test_smooth_course_preserves_non_smoothed_fields(fuji_course):
    """distance_m / slope_pct / elevation_m は smoothing 前後で完全一致 (default window)."""
    out = smooth_course(fuji_course)  # default window=5
    assert len(out) == len(fuji_course)
    for orig, sm in zip(fuji_course, out):
        assert sm["distance_m"] == orig["distance_m"]
        assert sm["slope_pct"] == orig["slope_pct"]
        assert sm["elevation_m"] == orig["elevation_m"]


def test_smooth_course_lat_lon_changes_but_stays_close(fuji_course):
    """lat/lon は変わるが原データから大きく離れない (default window=5、 < 0.001° ≒ 100m)."""
    out = smooth_course(fuji_course)  # default window=5
    max_dlat = 0.0
    max_dlon = 0.0
    any_diff = False
    for orig, sm in zip(fuji_course, out):
        dlat = abs(sm["lat"] - orig["lat"])
        dlon = abs(sm["lon"] - orig["lon"])
        if dlat > 0 or dlon > 0:
            any_diff = True
        max_dlat = max(max_dlat, dlat)
        max_dlon = max(max_dlon, dlon)
    assert any_diff, "smoothing で 1 点も lat/lon が変わっていない (= 実質 identity)"
    # window=5 のジッター補正は富士ヒル course 実測で max_dlat ~0.00046 / max_dlon ~0.00066.
    # 道路ジッター除去 (= 数十 m 級) 範囲で、 0.001° 未満に収まる.
    assert max_dlat < 0.001, f"lat 移動が過大: {max_dlat}"
    assert max_dlon < 0.001, f"lon 移動が過大: {max_dlon}"


def test_smooth_course_total_distance_change_is_small(fuji_course):
    """default window=5 で course 全長変化が < 1% (= ジグザグ補正レベル)."""
    def total_length(c):
        total = 0.0
        for i in range(1, len(c)):
            dlat = (c[i]["lat"] - c[i-1]["lat"]) * 111_000  # m / deg
            # 富士ヒル域 lat≒35 で cos補正.
            dlon = (c[i]["lon"] - c[i-1]["lon"]) * 111_000 * math.cos(math.radians(35.4))
            total += math.hypot(dlat, dlon)
        return total

    orig_len = total_length(fuji_course)
    smoothed_len = total_length(smooth_course(fuji_course))  # default window=5
    ratio = abs(smoothed_len - orig_len) / orig_len
    # smoothing で経路は短くなる (ジッター除去で「ぎざぎざ」の経路長が減る).
    # 富士ヒル course 1968 点で実測 ~0.62% 程度. 「ジグザグ補正」程度 = < 1%
    # に収まれば「道路カーブを潰していない」と言える.
    assert ratio < 0.01, f"course 全長変化が過大 (default window=5): {ratio:.4%}"


def test_smooth_course_window11_is_stronger(fuji_course):
    """大きい window (11) は default (5) より course 全長を大きく削る ── 大 window は道路カーブも消える挙動の確認."""
    def total_length(c):
        total = 0.0
        for i in range(1, len(c)):
            dlat = (c[i]["lat"] - c[i-1]["lat"]) * 111_000
            dlon = (c[i]["lon"] - c[i-1]["lon"]) * 111_000 * math.cos(math.radians(35.4))
            total += math.hypot(dlat, dlon)
        return total

    orig_len = total_length(fuji_course)
    sm_w5 = total_length(smooth_course(fuji_course, window=5))
    sm_w11 = total_length(smooth_course(fuji_course, window=11))
    ratio_w5 = abs(sm_w5 - orig_len) / orig_len
    ratio_w11 = abs(sm_w11 - orig_len) / orig_len
    # window=11 は道路カーブまで平滑化するため、 全長削減 ratio は default
    # より大きい. 同時に「やりすぎ」感が出るのでこれは default にしない.
    assert ratio_w11 > ratio_w5, (
        f"window=11 ({ratio_w11:.4%}) が default window=5 ({ratio_w5:.4%}) より"
        " 強く平滑化しているはず"
    )
    # ただし course 全体が完全に直線化するほどではない (< 3%).
    assert ratio_w11 < 0.03, f"window=11 の course 全長変化が過大: {ratio_w11:.4%}"


def test_smooth_course_empty_input():
    """空 course は空 list."""
    assert smooth_course([], window=11) == []


def test_smooth_course_invalid_window_raises():
    """window 不正で ValueError."""
    with pytest.raises(ValueError):
        smooth_course([{"lat": 0, "lon": 0}], window=0)
    with pytest.raises(ValueError):
        smooth_course([{"lat": 0, "lon": 0}], window=-3)


def test_smooth_course_custom_fields(fuji_course):
    """smooth_fields で elevation_m を指定 → elevation_m が変わり、 lat/lon は不変."""
    out = smooth_course(fuji_course[:50], window=5, smooth_fields=["elevation_m"])
    for orig, sm in zip(fuji_course[:50], out):
        assert sm["lat"] == orig["lat"]
        assert sm["lon"] == orig["lon"]
    # elevation_m はどこかしらで変わっている.
    diffs = [abs(sm["elevation_m"] - orig["elevation_m"])
             for orig, sm in zip(fuji_course[:50], out)]
    assert max(diffs) > 0


# ---------- cross-language fixture ----------

def test_dump_gpx_smooth_fixture_for_js(fuji_course):
    """JS 側 test (web/tests/gpx_smooth.test.js) が読む cross-language fixture.

    Python で smooth_course を実行した結果と、 movingAverage の単純列を
    JSON にダンプ. JS test が同 input で同 output を出すことを担保する.
    """
    # course の先頭 100 点 (= fixture サイズを抑える) で smoothing.
    head_course = fuji_course[:100]
    smoothed_w5 = smooth_course(head_course, window=5)
    smoothed_w11 = smooth_course(head_course, window=11)

    simple_in = [1.0, 2.0, 3.0, 4.0, 5.0]
    payload = {
        "schema": "py_gpx_smooth/v2",
        "course_input_len": len(head_course),
        "course_input": head_course,
        "course_smoothed_window5": smoothed_w5,
        "course_smoothed_window11": smoothed_w11,
        "simple_input": simple_in,
        "simple_window3": moving_average(simple_in, 3),
        "simple_window1": moving_average(simple_in, 1),
        "simple_window6": moving_average(simple_in, 6),  # window > length
    }

    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    with FIXTURE_PATH.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2, sort_keys=True)

    # round-trip sanity.
    reloaded = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    assert reloaded["schema"] == "py_gpx_smooth/v2"
    assert reloaded["course_input_len"] == 100
    assert len(reloaded["course_smoothed_window5"]) == 100
    assert len(reloaded["course_smoothed_window11"]) == 100
    assert reloaded["simple_window3"] == pytest.approx([1.5, 2.0, 3.0, 4.0, 4.5])
    assert reloaded["simple_window1"] == [1.0, 2.0, 3.0, 4.0, 5.0]
    assert reloaded["simple_window6"] == pytest.approx([3.0] * 5)
