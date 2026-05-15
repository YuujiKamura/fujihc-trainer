"""Mock BleakClient で _ftms_loop の handshake 順序 + 命令 byte を verify する。

実 trainer 無しで「PC が trainer に送る opcode 順 + payload」が FTMS spec 通りか
チェックする。Wahoo / Tacx の機種別問題と切り分け可能。
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

SRC = Path(__file__).resolve().parent.parent / "src"
sys.path.insert(0, str(SRC))

from fujihill.bridge import (  # noqa: E402
    Bridge,
    FITNESS_MACHINE_CONTROL_POINT_UUID,
    INDOOR_BIKE_DATA_UUID,
    FTMS_OP_REQUEST_CONTROL,
    FTMS_OP_RESET,
    FTMS_OP_START,
)


@pytest.mark.asyncio
async def test_ftms_loop_handshake_order(monkeypatch, tmp_path):
    """_ftms_loop で BleakClient が呼ばれる順序を pin。

    期待順序:
      1. connect()
      2. start_notify(INDOOR_BIKE_DATA_UUID, ...)
      3. start_notify(FITNESS_MACHINE_CONTROL_POINT_UUID, ...)
      4. write_gatt_char(CP, [REQUEST_CONTROL])
      5. write_gatt_char(CP, [START])
    """
    # mock BleakClient: connect 成功、 notify subscribe 成功、write 成功
    mock_client = MagicMock()
    mock_client.is_connected = True
    mock_client.connect = AsyncMock()
    mock_client.disconnect = AsyncMock()
    mock_client.start_notify = AsyncMock()
    mock_client.stop_notify = AsyncMock()
    mock_client.write_gatt_char = AsyncMock()

    monkeypatch.setattr("fujihill.bridge.BleakClient", lambda addr, timeout: mock_client)

    bridge = Bridge(
        device="AA:BB:CC:DD:EE:FF",
        dummy=False,
        port=18765,         # use a port we won't actually listen on
        log_dir=tmp_path,
    )
    # _ftms_loop を 0.5 秒走らせて畳む (_stopping or _mode_change 発火で抜ける)
    task = asyncio.create_task(bridge._ftms_loop())
    await asyncio.sleep(0.5)
    bridge._stopping.set()
    bridge._mode_change.set()  # _ftms_loop は _stopping を await している
    await asyncio.wait_for(task, timeout=3.0)

    # 順序検証
    mock_client.connect.assert_awaited_once()

    subscribe_uuids = [call.args[0] for call in mock_client.start_notify.call_args_list]
    assert INDOOR_BIKE_DATA_UUID in subscribe_uuids, "Indoor Bike Data に subscribe してない"
    assert FITNESS_MACHINE_CONTROL_POINT_UUID in subscribe_uuids, "Control Point に subscribe してない"

    write_payloads = [bytes(call.args[1]) for call in mock_client.write_gatt_char.call_args_list]
    assert bytes([FTMS_OP_REQUEST_CONTROL]) in write_payloads, "Request Control (0x00) を書いてない"
    assert bytes([FTMS_OP_RESET]) in write_payloads, "Reset (0x01) を書いてない (前 session の trainer 状態を clear するため必要)"
    # Start (0x07) は省略する仕様: 多くの trainer で Operation-Failed を返して
    # HUD ack 行を赤で固まらせる、 spec 上必須でもないため投げない。
    assert bytes([FTMS_OP_START]) not in write_payloads, "Start (0x07) は投げない方針"
    # 順序 verify: Request Control → Reset
    indices = {bytes([op]): write_payloads.index(bytes([op])) for op in
               (FTMS_OP_REQUEST_CONTROL, FTMS_OP_RESET)}
    assert indices[bytes([FTMS_OP_REQUEST_CONTROL])] < indices[bytes([FTMS_OP_RESET])]


@pytest.mark.asyncio
async def test_send_slope_writes_encoded_payload(monkeypatch, tmp_path):
    """_send_slope は encode した 7-byte payload を Control Point に書く。
    response=True を先に試す (FTMS spec の標準、 trainer が indication で ack を返す)。"""
    mock_client = MagicMock()
    mock_client.is_connected = True
    mock_client.write_gatt_char = AsyncMock()

    bridge = Bridge(device=None, dummy=True, port=28765, log_dir=tmp_path)
    bridge._ble_client = mock_client

    await bridge._send_slope(5.5)

    # 1 回以上 write されてる、最初は response=True (ack を期待する spec 通りの送り方)
    assert mock_client.write_gatt_char.await_count >= 1
    first_call = mock_client.write_gatt_char.await_args_list[0]
    uuid_arg = first_call.args[0]
    payload = bytes(first_call.args[1])
    response_kw = first_call.kwargs.get("response", False)
    assert uuid_arg == FITNESS_MACHINE_CONTROL_POINT_UUID
    assert payload[0] == 0x11           # Indoor Bike Simulation opcode
    assert len(payload) == 7
    assert response_kw is True, "spec 通り With-Response を先に試すはず"


@pytest.mark.asyncio
async def test_send_slope_skipped_when_disconnected(tmp_path):
    """BLE 切断時は write を投げない、ただ state.slope_sent_pct は反映される。"""
    bridge = Bridge(device=None, dummy=True, port=38765, log_dir=tmp_path)
    bridge._ble_client = None   # 切断状態

    await bridge._send_slope(3.0)

    assert bridge.state.slope_sent_pct == 3.0
