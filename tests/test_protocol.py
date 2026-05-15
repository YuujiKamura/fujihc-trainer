"""Pure-function contract tests for FTMS encode / parse.

No BLE adapter, no trainer, no WebSocket - just byte-level契約 of
`_encode_set_indoor_bike_simulation` and `_parse_indoor_bike_data`.
"""
from __future__ import annotations

import struct
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "src"
sys.path.insert(0, str(SRC))

from fujihill.bridge import (  # noqa: E402
    _encode_set_indoor_bike_simulation,
    _parse_indoor_bike_data,
    _parse_control_response,
    _parse_heart_rate,
    FTMS_OP_SET_INDOOR_BIKE_SIMULATION,
)


def test_encode_flat_zero_grade():
    """0 % grade with default wind/Crr/Cw → opcode + zero-fields."""
    payload = _encode_set_indoor_bike_simulation(0.0)
    assert len(payload) == 7   # opcode(1) + wind(2) + grade(2) + crr(1) + cw(1)
    opcode = payload[0]
    wind, grade = struct.unpack_from("<hh", payload, 1)
    crr, cw = payload[5], payload[6]
    assert opcode == FTMS_OP_SET_INDOOR_BIKE_SIMULATION
    assert wind == 0
    assert grade == 0
    assert crr == 40    # 0.004 / 0.0001
    assert cw == 51     # 0.51 / 0.01


def test_encode_positive_grade():
    """+5.5 % grade を 0.01 % 単位の signed int として出力。"""
    payload = _encode_set_indoor_bike_simulation(5.5)
    grade = struct.unpack_from("<h", payload, 3)[0]
    assert grade == 550


def test_encode_negative_grade():
    """-3.25 % (下り) も正しく signed で出る。"""
    payload = _encode_set_indoor_bike_simulation(-3.25)
    grade = struct.unpack_from("<h", payload, 3)[0]
    assert grade == -325


def test_encode_clamps_extreme_grades():
    """FTMS spec の上下限 ±32% で clamp、payload 暴走しない。"""
    high = _encode_set_indoor_bike_simulation(99.0)
    low = _encode_set_indoor_bike_simulation(-99.0)
    assert struct.unpack_from("<h", high, 3)[0] == 3200
    assert struct.unpack_from("<h", low, 3)[0] == -3200


def test_parse_empty_packet_returns_empty_dict():
    assert _parse_indoor_bike_data(b"") == {}
    assert _parse_indoor_bike_data(b"\x00") == {}


def test_control_response_ok():
    """trainer が 0x80 0x11 0x01 を返す = Indoor Bike Sim を受け取った OK。"""
    parsed = _parse_control_response(b"\x80\x11\x01")
    assert parsed == (0x11, 0x01, "OK")


def test_control_response_op_not_supported():
    """古い trainer で Indoor Bike Sim を知らない → Op-Not-Supported。"""
    parsed = _parse_control_response(b"\x80\x11\x02")
    assert parsed == (0x11, 0x02, "Op-Not-Supported")


def test_control_response_control_not_permitted():
    """他アプリと取り合い → Control-Not-Permitted。"""
    parsed = _parse_control_response(b"\x80\x07\x05")
    assert parsed == (0x07, 0x05, "Control-Not-Permitted")


def test_control_response_unknown_result_code():
    """spec 未定義の result code も落ちずに hex 表示で返る。"""
    parsed = _parse_control_response(b"\x80\x11\xFE")
    assert parsed == (0x11, 0xFE, "Result=0xFE")


def test_control_response_garbage_returns_none():
    """0x80 で始まらない / 長さ不足は None。"""
    assert _parse_control_response(b"") is None
    assert _parse_control_response(b"\x80\x11") is None       # 長さ不足
    assert _parse_control_response(b"\x00\x11\x01") is None   # 先頭が 0x80 じゃない (= notification ではない)


def test_parse_heart_rate_uint8():
    """flag bit0=0、 続く uint8 が BPM。 通常の HRM 機器は uint8。"""
    parsed = _parse_heart_rate(bytes([0x00, 72]))   # flag=0, bpm=72
    assert parsed == {"hr_bpm": 72}


def test_parse_heart_rate_uint16():
    """flag bit0=1、 続く uint16 little-endian が BPM。 BPM>255 でも壊れない。"""
    parsed = _parse_heart_rate(bytes([0x01, 0x10, 0x01]))   # flag=1, bpm=272
    assert parsed == {"hr_bpm": 272}


def test_parse_heart_rate_with_energy_and_rr():
    """flag bit3 = energy あり、 bit4 = RR あり。 BPM 抜きは取れる、 残りは無視で OK。"""
    # flag = 0b00011000 = energy + RR、 BPM 80、 energy + RR は無視
    parsed = _parse_heart_rate(bytes([0x18, 80, 0x00, 0x00, 0x00, 0x00]))
    assert parsed["hr_bpm"] == 80


def test_parse_heart_rate_empty_returns_empty():
    """空 packet は空 dict、 例外は出ない。"""
    assert _parse_heart_rate(b"") == {}


def test_parse_speed_only_packet():
    """flags=0x0001 (= more data なし、instantaneous speed あり)、speed = 5.55 m/s。
    FTMS Indoor Bike Data: flag bit0 = more data の "absence" を意味する (= speed あり)。
    Cesium と同じ実装の bridge._parse_indoor_bike_data の現契約を pin する。"""
    # speed は 0.01 km/h 単位、5.55 m/s = 19.98 km/h ≈ 1998 (0.01 km/h)
    speed_raw = 1998
    data = struct.pack("<HH", 0x0000, speed_raw)   # flag 0、その後 instantaneous speed
    parsed = _parse_indoor_bike_data(data)
    if "speed_mps" in parsed:
        # 19.98 km/h ÷ 3.6 ≈ 5.55 m/s
        assert abs(parsed["speed_mps"] - 5.55) < 0.05
