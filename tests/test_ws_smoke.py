"""End-to-end smoke test against a running bridge on localhost:8765.

実 BLE / trainer 無しで、WebSocket protocol 契約だけを verify する。
bridge は事前に `python -m fujihill.bridge --dummy` で立ち上げておくこと
(supervisor は自動起動しない、本テストは「動いてる bridge を叩く」)。

実行:
    cd ~/fujihill-trainer
    pytest tests/test_ws_smoke.py -v -s
"""
from __future__ import annotations

import asyncio
import json
import os
import socket

import pytest
import websockets

BRIDGE_URL = "ws://localhost:8765"


def _bridge_running() -> bool:
    """port 8765 で listen してる process があるか軽く check。"""
    s = socket.socket()
    s.settimeout(0.5)
    try:
        s.connect(("127.0.0.1", 8765))
        return True
    except OSError:
        return False
    finally:
        s.close()


pytestmark = pytest.mark.skipif(
    not _bridge_running(),
    reason="bridge not running on localhost:8765 - start it first: python -m fujihill.bridge --dummy",
)


@pytest.mark.asyncio
async def test_state_push_arrives_in_dummy_mode():
    """dummy mode の bridge は ~1Hz で state push をくれる、20km/h ≈ 5.56 m/s。"""
    async with websockets.connect(
        BRIDGE_URL, origin="http://localhost:8000"
    ) as ws:
        deadline = asyncio.get_event_loop().time() + 3.0
        speeds = []
        while asyncio.get_event_loop().time() < deadline:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=1.5)
            except asyncio.TimeoutError:
                break
            msg = json.loads(raw)
            if msg.get("type") == "state" and isinstance(msg.get("speed_mps"), (int, float)):
                speeds.append(msg["speed_mps"])
        assert speeds, "no state messages within 3 s"
        # dummy mode は 20 km/h = 5.555 m/s 定速
        assert any(5.0 < s < 6.5 for s in speeds), f"unexpected speed values: {speeds}"


@pytest.mark.asyncio
async def test_scan_returns_status_and_result():
    """scan コマンドで scanning → result が来る (中身が空でも構わない)。"""
    async with websockets.connect(
        BRIDGE_URL, origin="http://localhost:8000"
    ) as ws:
        await ws.send(json.dumps({"type": "scan"}))
        saw_scanning = False
        saw_result = False
        deadline = asyncio.get_event_loop().time() + 12.0
        while asyncio.get_event_loop().time() < deadline:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=12.0)
            except asyncio.TimeoutError:
                break
            msg = json.loads(raw)
            if msg.get("type") == "scan_status" and msg.get("state") == "scanning":
                saw_scanning = True
            elif msg.get("type") == "scan_result":
                assert isinstance(msg.get("devices"), list)
                saw_result = True
                break
            elif msg.get("type") == "scan_status" and msg.get("state") == "failed":
                # adapter なし環境では failed が来る、それも妥当
                saw_result = True
                break
        assert saw_scanning, "scan_status:scanning が来なかった"
        assert saw_result, "scan_result も failed も来なかった"


@pytest.mark.asyncio
async def test_connect_with_bogus_address_returns_failed():
    """存在しない MAC に connect → fail が返ることを契約 pin。"""
    async with websockets.connect(
        BRIDGE_URL, origin="http://localhost:8000"
    ) as ws:
        await ws.send(json.dumps({
            "type": "connect", "address": "00:00:00:00:00:00"
        }))
        saw_failed = False
        deadline = asyncio.get_event_loop().time() + 20.0
        while asyncio.get_event_loop().time() < deadline:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=20.0)
            except asyncio.TimeoutError:
                break
            msg = json.loads(raw)
            if msg.get("type") == "connect_status" and msg.get("state") == "failed":
                saw_failed = True
                break
        assert saw_failed, "connect_status:failed が時間内に来なかった"


@pytest.mark.asyncio
async def test_origin_check_rejects_non_localhost():
    """悪意 page (Origin: https://evil.example) からの接続は拒否される。"""
    try:
        async with websockets.connect(
            BRIDGE_URL, origin="https://evil.example"
        ) as ws:
            # 接続できた場合、即 close されるはず
            try:
                await asyncio.wait_for(ws.recv(), timeout=1.0)
                # message が来ちゃったら origin check が効いてない
                assert False, "non-localhost origin が接続維持できてしまった"
            except (websockets.exceptions.ConnectionClosed, asyncio.TimeoutError):
                pass
    except websockets.exceptions.InvalidStatus:
        # close handshake で 4403 が返ってる、これが期待動作
        pass
