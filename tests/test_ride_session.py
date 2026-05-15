"""ride_start → 数サンプル CSV 書き → ride_end → GPX 生成の end-to-end。"""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parent.parent / "src"
sys.path.insert(0, str(SRC))

from fujihill.bridge import Bridge   # noqa: E402

GPX_NS = "{http://www.topografix.com/GPX/1/1}"


@pytest.mark.asyncio
async def test_ride_start_end_writes_gpx(tmp_path: Path):
    """ride_start で CSV を開き、 数サンプル積んだ後 ride_end で GPX が出る。"""
    bridge = Bridge(
        device=None, dummy=True, port=48765, log_dir=tmp_path,
    )
    # 起動時 CSV を開かない設計、 ride_start で初めて開く
    assert bridge._csv_writer is None

    await bridge._handle_ride_start()
    assert bridge._csv_writer is not None
    csv_path = bridge._csv_path
    assert csv_path is not None and csv_path.exists()

    # ride 中の位置 + power / cadence を 3 サンプル積む
    for i in range(3):
        bridge.state.lat = 35.4521 - i * 0.0001
        bridge.state.lon = 138.7586 - i * 0.0001
        bridge.state.elevation_m = 1061.3 + i
        bridge.state.distance_m = 30.0 * (i + 1)
        bridge.state.speed_mps = 5.0
        bridge.state.power_w = 150 + i * 10
        bridge.state.cadence_rpm = 80.0
        bridge.state.slope_sent_pct = 5.5
        bridge._append_csv()

    await bridge._handle_ride_end()

    # GPX が同じ basename で出てる
    gpx_path = csv_path.with_suffix(".gpx")
    assert gpx_path.exists(), f"GPX 出来てない: {gpx_path}"

    tree = ET.parse(gpx_path)
    trkpts = tree.getroot().findall(f".//{GPX_NS}trkpt")
    assert len(trkpts) == 3, f"trkpt 数が違う: {len(trkpts)}"


@pytest.mark.asyncio
async def test_ride_end_without_start_is_noop(tmp_path: Path):
    """ride_start を経ずに ride_end が来ても落ちない (state notification だけ送って終わり)。"""
    bridge = Bridge(
        device=None, dummy=True, port=48766, log_dir=tmp_path,
    )
    # 例外なく完了する事を確認
    await bridge._handle_ride_end()
    assert bridge._csv_writer is None


@pytest.mark.asyncio
async def test_ride_start_resets_distance(tmp_path: Path):
    """ride_start 時に state.distance_m と lat/lon が reset される。"""
    bridge = Bridge(
        device=None, dummy=True, port=48767, log_dir=tmp_path,
    )
    bridge.state.distance_m = 12345.6
    bridge.state.lat = 35.0
    bridge.state.lon = 138.0
    bridge.state.elevation_m = 1000.0

    await bridge._handle_ride_start()

    assert bridge.state.distance_m == 0.0
    assert bridge.state.lat is None
    assert bridge.state.lon is None
    assert bridge.state.elevation_m is None


@pytest.mark.asyncio
async def test_ride_start_sends_slope_zero_to_trainer(tmp_path: Path):
    """ride_start で trainer と再同期するため slope=0 が 1 回送られる。"""
    from unittest.mock import AsyncMock, MagicMock
    bridge = Bridge(
        device=None, dummy=False, port=48768, log_dir=tmp_path,
    )
    mock_client = MagicMock()
    mock_client.is_connected = True
    mock_client.write_gatt_char = AsyncMock()
    bridge._ble_client = mock_client

    await bridge._handle_ride_start()

    # state.slope_sent_pct が 0 にリセットされてる
    assert bridge.state.slope_sent_pct == 0.0
    # trainer に write されてて、 最初の payload は Indoor Bike Simulation (opcode 0x11)
    assert mock_client.write_gatt_char.await_count >= 1
    payload = bytes(mock_client.write_gatt_char.await_args_list[0].args[1])
    assert payload[0] == 0x11
    assert len(payload) == 7
