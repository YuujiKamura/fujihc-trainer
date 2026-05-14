"""trainer <-> viewer bridge.

One process. Holds a BLE FTMS connection to a smart trainer (or runs in
``--dummy`` mode), runs a WebSocket server on port 8765, pushes ride state
to the viewer at 1 Hz, accepts slope commands from the viewer and writes
them back to the trainer, and appends every state tick to a CSV log.

usage:
    python -m fujihc.bridge [--device <addr>] [--dummy] [--port 8765]
"""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import csv
import datetime as _dt
import json
import logging
import os
import struct
import sys
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional

from bleak import BleakClient, BleakScanner
from bleak.exc import BleakError
import websockets
from websockets.exceptions import ConnectionClosed

from aiohttp import web

from fujihc.gpx_export import csv_to_gpx
from fujihc.http_app import make_http_app

log = logging.getLogger("fujihc.bridge")

FTMS_SERVICE_UUID = "00001826-0000-1000-8000-00805f9b34fb"
INDOOR_BIKE_DATA_UUID = "00002ad2-0000-1000-8000-00805f9b34fb"
FITNESS_MACHINE_CONTROL_POINT_UUID = "00002ad9-0000-1000-8000-00805f9b34fb"

# Heart Rate Service (HRM = Heart Rate Monitor)
HEART_RATE_SERVICE_UUID = "0000180d-0000-1000-8000-00805f9b34fb"
HEART_RATE_MEASUREMENT_UUID = "00002a37-0000-1000-8000-00805f9b34fb"

FTMS_OP_REQUEST_CONTROL = 0x00
FTMS_OP_RESET = 0x01
FTMS_OP_START = 0x07
FTMS_OP_SET_INDOOR_BIKE_SIMULATION = 0x11

CONNECT_TIMEOUT_S = 10.0   # Wahoo 系の初回 connect が遅いので余裕を取る (review 11-pair-tech)
SCAN_TIMEOUT_S = 7.0
PUSH_HZ = 1.0


@dataclass
class RideState:
    """One sample of ride state. fields stay None until we know better."""
    distance_m: float = 0.0
    speed_mps: float = 0.0
    power_w: Optional[int] = None
    cadence_rpm: Optional[float] = None
    slope_sent_pct: float = 0.0

    last_ack: Optional[str] = None     # trainer の最新応答 (= "OK"、 "Op-Not-Supported" 等)
    # ride 中の現在地 (viewer の position メッセージで更新、 GPX 書き出しに使う)
    lat: Optional[float] = None
    lon: Optional[float] = None
    elevation_m: Optional[float] = None
    # 心拍計 (HRM、 別 BLE 接続経由)
    hr_bpm: Optional[int] = None

    def to_payload(self) -> dict:
        return {
            "distance_m": round(self.distance_m, 2),
            "speed_mps": round(self.speed_mps, 3),
            "power_w": self.power_w,
            "cadence_rpm": (
                round(self.cadence_rpm, 1) if self.cadence_rpm is not None else None
            ),
            "slope_sent_pct": round(self.slope_sent_pct, 2),
            "last_ack": self.last_ack,
            "hr_bpm": self.hr_bpm,
        }


def _parse_heart_rate(data: bytes) -> dict:
    """BLE Heart Rate Measurement (UUID 0x2A37) を decode する。
    flags byte の bit0 で BPM が uint8 か uint16 か判別、 bit3 で energy、 bit4 で RR-interval を含む。
    返り値: {"hr_bpm": int} もしくは空 dict (parse 不可)。
    """
    if not data:
        return {}
    flags = data[0]
    offset = 1
    out: dict = {}
    if flags & 0x01:
        # uint16 little-endian
        if len(data) >= offset + 2:
            out["hr_bpm"] = struct.unpack_from("<H", data, offset)[0]
            offset += 2
    else:
        if len(data) >= offset + 1:
            out["hr_bpm"] = data[offset]
            offset += 1
    return out


def _parse_indoor_bike_data(data: bytes) -> dict:
    """Decode a FTMS Indoor Bike Data notification (UUID 0x2AD2).

    Bluetooth SIG spec FTMS 1.0 § 4.9: 16-bit flags followed by optional
    fields. Returns whatever we managed to extract from this packet; missing
    fields are simply absent from the dict.
    """
    if len(data) < 2:
        return {}
    flags = struct.unpack_from("<H", data, 0)[0]
    offset = 2
    out: dict = {}

    # Instantaneous Speed is the only field present when its inverse flag
    # ("more data") is 0 - that is, the default case.
    more_data = bool(flags & 0x0001)
    if not more_data and len(data) >= offset + 2:
        raw = struct.unpack_from("<H", data, offset)[0]
        offset += 2
        speed_kmh = raw / 100.0
        out["speed_mps"] = speed_kmh / 3.6

    if (flags & 0x0002) and len(data) >= offset + 2:  # Average Speed
        offset += 2
    if (flags & 0x0004) and len(data) >= offset + 2:  # Instantaneous Cadence
        raw = struct.unpack_from("<H", data, offset)[0]
        offset += 2
        out["cadence_rpm"] = raw * 0.5
    if (flags & 0x0008) and len(data) >= offset + 2:  # Average Cadence
        offset += 2
    if (flags & 0x0010) and len(data) >= offset + 3:  # Total Distance (uint24)
        b0, b1, b2 = data[offset], data[offset + 1], data[offset + 2]
        offset += 3
        out["distance_m"] = float(b0 | (b1 << 8) | (b2 << 16))
    if (flags & 0x0020) and len(data) >= offset + 2:  # Resistance Level
        offset += 2
    if (flags & 0x0040) and len(data) >= offset + 2:  # Instantaneous Power (sint16)
        raw = struct.unpack_from("<h", data, offset)[0]
        offset += 2
        out["power_w"] = raw
    return out


class FakeBleakClient:
    """Test 用の trainer emulator。bleak 互換 API、 BLE には繋がない。
    Indoor Bike Data を 1Hz で notify、Control Point write を受けたら ack を即返す。
    yuuji の手を介さず viewer ↔ bridge ↔ fake-trainer の full loop を走らせるため。
    """

    def __init__(self, address: str, timeout: float = 10.0):
        self.address = address
        self.is_connected = False
        self._notify_callbacks: dict = {}
        self._tasks: list[asyncio.Task] = []
        self._stopping = False
        self._current_slope_pct = 0.0

    async def connect(self) -> None:
        await asyncio.sleep(0.1)
        self.is_connected = True

    async def disconnect(self) -> None:
        self.is_connected = False
        self._stopping = True
        for t in self._tasks:
            t.cancel()

    async def start_notify(self, uuid: str, callback) -> None:
        self._notify_callbacks[uuid.lower()] = callback
        # Indoor Bike Data なら定期 push を開始
        if uuid.lower() == INDOOR_BIKE_DATA_UUID.lower():
            self._tasks.append(asyncio.create_task(self._indoor_bike_pump(callback)))

    async def stop_notify(self, uuid: str) -> None:
        self._notify_callbacks.pop(uuid.lower(), None)

    async def write_gatt_char(self, uuid: str, data, response: bool = False) -> None:
        # Control Point に書かれた opcode を即 ack で返す (= 模擬 trainer)
        if uuid.lower() != FITNESS_MACHINE_CONTROL_POINT_UUID.lower():
            return
        if not data:
            return
        opcode = data[0]
        # slope 設定なら内部状態を更新
        if opcode == FTMS_OP_SET_INDOOR_BIKE_SIMULATION and len(data) >= 5:
            grade_raw = struct.unpack_from("<h", bytes(data), 3)[0]
            self._current_slope_pct = grade_raw / 100.0
        # ack を 50ms 遅延で notify (= 実機の往復遅延に近い)
        cb = self._notify_callbacks.get(FITNESS_MACHINE_CONTROL_POINT_UUID.lower())
        if cb:
            self._tasks.append(asyncio.create_task(self._delayed_ack(cb, opcode)))

    async def _delayed_ack(self, cb, opcode: int) -> None:
        await asyncio.sleep(0.05)
        try:
            cb(0, bytearray([0x80, opcode, 0x01]))  # Result=OK
        except Exception:
            pass

    async def _indoor_bike_pump(self, cb) -> None:
        """毎秒 Indoor Bike Data を notify。 slope が大きいほど speed が落ちる単純モデル。"""
        try:
            while not self._stopping:
                # 25 km/h ベース、勾配 1% ごとに -1 km/h、 power は slope に比例
                speed_kmh = max(5.0, 25.0 - self._current_slope_pct * 1.0)
                speed_raw = int(speed_kmh * 100)
                power_w = int(150 + self._current_slope_pct * 12)
                cadence_raw = int(85 * 2)   # FTMS は 0.5 rpm 単位
                # flag bit2 = instantaneous cadence, bit6 = instantaneous power、bit が 0 で速度プレゼント
                flags = 0x0044
                payload = struct.pack("<HHHh", flags, speed_raw, cadence_raw, power_w)
                try:
                    cb(0, bytearray(payload))
                except Exception:
                    pass
                await asyncio.sleep(1.0)
        except asyncio.CancelledError:
            pass


def _parse_control_response(data: bytes) -> Optional[tuple[int, int, str]]:
    """FTMS Control Point indication payload を (req_op, result, result_name) に分解。

    spec § 4.16: Response Op Code 0x80, Request Op Code, Result Code [, ...].
    spec に合わない packet は None を返す (落ちない)。
    """
    if len(data) < 3 or data[0] != 0x80:
        return None
    req_op = data[1]
    result = data[2]
    result_name = {
        0x01: "OK",
        0x02: "Op-Not-Supported",
        0x03: "Invalid-Parameter",
        0x04: "Operation-Failed",
        0x05: "Control-Not-Permitted",
    }.get(result, f"Result=0x{result:02X}")
    return (req_op, result, result_name)


def _encode_set_indoor_bike_simulation(
    grade_pct: float,
    wind_mps: float = 0.0,
    crr: float = 0.004,
    cw: float = 0.51,
) -> bytes:
    """Pack FTMS Set Indoor Bike Simulation Parameters payload (opcode 0x11)."""
    grade_pct = max(-32.0, min(32.0, grade_pct))
    grade_raw = int(round(grade_pct * 100.0))      # 0.01% units
    wind_raw = int(round(wind_mps * 1000.0))       # 0.001 m/s units
    crr_raw = max(0, min(255, int(round(crr / 0.0001))))
    cw_raw = max(0, min(255, int(round(cw / 0.01))))
    return struct.pack(
        "<BhhBB",
        FTMS_OP_SET_INDOOR_BIKE_SIMULATION,
        wind_raw,
        grade_raw,
        crr_raw,
        cw_raw,
    )


class Bridge:
    def __init__(self, *, device: Optional[str], dummy: bool, port: int, log_dir: Path,
                 fake_trainer: bool = False, http_port: int = 8000,
                 db_path: Optional[Path] = None):
        self.device = device
        self.dummy = dummy
        self.port = port
        self.log_dir = log_dir
        self.fake_trainer = fake_trainer
        # brief 17a: ローカル tile DB を HTTP で配信 (= 127.0.0.1 限定)
        self.http_port = http_port
        self.db_path = db_path or Path("data/tiles.sqlite")

        self.state = RideState()
        self._state_lock = asyncio.Lock()
        self._clients: set[websockets.WebSocketServerProtocol] = set()

        self._ble_client: Optional[BleakClient] = None
        self._csv_path: Optional[Path] = None
        self._csv_writer = None
        self._csv_file = None
        self._stopping = asyncio.Event()
        self._mode_change = asyncio.Event()   # source-task 再起動シグナル
        self._scan_busy = False
        self.device_addr = device              # _handle_connect で更新
        self._last_control_result: Optional[tuple[int, int, str]] = None   # 最後の trainer ack
        # HRM (心拍計) 並行接続 ── trainer と別 BLE client
        self._hrm_client: Optional[BleakClient] = None
        self._hrm_task: Optional[asyncio.Task] = None
        self._hrm_addr: Optional[str] = None

    # ---------- BLE ----------

    async def _resolve_device(self) -> Optional[str]:
        # 明示指定された device しか使わない。 viewer 由来の scan/connect 命令で
        # self.device が後から埋まる流れ。 起動時の auto-scan は廃止 (明示 ON しない限り走らせない方針)。
        return self.device if self.device else None

    async def _ftms_loop(self) -> None:
        """Connect to the trainer and feed self.state from notifications.

        ポリシー: 明示 ON されたとき (=device 指定 / fake-trainer / viewer から
        connect 命令) のみ走る。 失敗時は dummy に勝手に落とさず、 viewer に通知
        して mode_change を待つ (= idle)。
        """
        addr = await self._resolve_device()
        if addr is None:
            log.info("no device specified, awaiting connect command from viewer")
            await self._mode_change.wait()
            return

        log.info("connecting to %s (timeout %.0fs)...", addr, CONNECT_TIMEOUT_S)
        ClientCls = FakeBleakClient if self.fake_trainer else BleakClient
        try:
            client = ClientCls(addr, timeout=CONNECT_TIMEOUT_S)
            await asyncio.wait_for(client.connect(), timeout=CONNECT_TIMEOUT_S)
        except (asyncio.TimeoutError, BleakError, OSError) as exc:
            log.warning("connect failed (%s) - awaiting next connect command", exc)
            # viewer に failure 通知は出さない (user 指示: タイムアウト/失敗表示は不要)。
            # ftms_loop が次の connect 命令で起こされるまで idle に入る。
            await self._mode_change.wait()
            return

        self._ble_client = client
        log.info("connected, subscribing to Indoor Bike Data")

        def _notify(_handle, data: bytearray) -> None:
            parsed = _parse_indoor_bike_data(bytes(data))
            if not parsed:
                return
            # state updated by callback - no await available here, use the
            # synchronous attribute assignment; the 1Hz pusher is the only
            # reader and is fine with eventual consistency.
            if "speed_mps" in parsed:
                self.state.speed_mps = parsed["speed_mps"]
            if "cadence_rpm" in parsed:
                self.state.cadence_rpm = parsed["cadence_rpm"]
            if "power_w" in parsed:
                self.state.power_w = parsed["power_w"]
            if "distance_m" in parsed:
                self.state.distance_m = parsed["distance_m"]

        try:
            await client.start_notify(INDOOR_BIKE_DATA_UUID, _notify)
        except BleakError as exc:
            log.warning("subscribe failed (%s) - awaiting next connect command", exc)
            with contextlib.suppress(Exception):
                await client.disconnect()
            await self._mode_change.wait()
            return

        # subscribe 段階では「接続中、 ハンドシェイク進行中」を通知するに留める。
        # 正式な connected はハンドシェイク (Request Control + Reset + Start) 完了後に出す。
        await self._send_to_all({
            "type": "connect_status", "state": "handshaking", "address": addr,
        })

        # Control Point Indication subscribe: 勾配 write 毎に trainer が
        # 「受けた / Result Code XX」を返してくる、これを log + state に反映する。
        def _on_control_response(_handle, data: bytearray) -> None:
            parsed = _parse_control_response(bytes(data))
            if parsed is None:
                log.debug("trainer control-point notify (unparsed): %s", bytes(data).hex())
                return
            req_op, result, result_name = parsed
            self._last_control_result = (req_op, result, result_name)
            # state にも乗せて viewer に即時通知 (1Hz push 待ちで遅延を出さない)
            self.state.last_ack = f"op=0x{req_op:02X} {result_name}"
            log.info("trainer ack: req=0x%02X result=%s", req_op, result_name)
            # 即時 push (callback は sync なので task に切り出して送る)
            try:
                loop = asyncio.get_running_loop()
                payload = {"type": "state", **self.state.to_payload()}
                loop.create_task(self._send_to_all(payload))
            except RuntimeError:
                # event loop が無いとき (test 等) は次の 1Hz push に任せる
                pass

        try:
            await client.start_notify(
                FITNESS_MACHINE_CONTROL_POINT_UUID, _on_control_response
            )
            log.info("subscribed to control-point indications")
        except BleakError as exc:
            log.warning("control-point notify subscribe failed: %s", exc)

        # Request Control → Reset の 2 段。 Start (0x07) は省略。
        # 実機 (Elite Direto / Wahoo / Tacx 他) では Start を投げると Operation-Failed
        # を返す事が多い、 trainer が既に started 状態だから。 これで HUD の ack 行が
        # 赤の Operation-Failed で止まり「ハンドシェイク未完了」に見える誤解を生んでた。
        # spec § 4.16 上も Start は必須ではない (Reset で activated state に入る)。
        for opcode in (FTMS_OP_REQUEST_CONTROL, FTMS_OP_RESET):
            try:
                await client.write_gatt_char(
                    FITNESS_MACHINE_CONTROL_POINT_UUID, bytes([opcode]), response=True
                )
            except BleakError as exc:
                log.warning("FTMS control op 0x%02X failed: %s", opcode, exc)

        # 3 段ハンドシェイク投げ終わって初めて「接続完了」を viewer に通知。
        # viewer 側はこの通知でライド開始ボタンを有効化する仕様 (走り始めないと前回握りが残ってると分かる)。
        await self._send_to_all({
            "type": "connect_status", "state": "connected", "address": addr,
        })

        await self._stopping.wait()

        with contextlib.suppress(Exception):
            await client.stop_notify(INDOOR_BIKE_DATA_UUID)
        with contextlib.suppress(Exception):
            await client.disconnect()

    async def _dummy_loop(self) -> None:
        """In dummy mode, pretend the rider is doing a steady 20 km/h."""
        speed_mps = 20.0 / 3.6
        last = time.monotonic()
        while not self._stopping.is_set():
            now = time.monotonic()
            dt = now - last
            last = now
            self.state.speed_mps = speed_mps
            self.state.distance_m += speed_mps * dt
            self.state.cadence_rpm = 80.0
            self.state.power_w = 150
            try:
                await asyncio.wait_for(self._stopping.wait(), timeout=0.25)
            except asyncio.TimeoutError:
                pass

    # ---------- WebSocket ----------

    async def _ws_handler(self, ws) -> None:
        # Origin ヘッダ check (review 11-pair-security): localhost のみ許可
        # websockets 12.x (legacy) と 15.x (asyncio) で API が違うので両対応
        origin = ""
        if hasattr(ws, "request_headers"):
            origin = ws.request_headers.get("Origin") or ws.request_headers.get("origin") or ""
        elif hasattr(ws, "request") and hasattr(ws.request, "headers"):
            origin = ws.request.headers.get("Origin") or ws.request.headers.get("origin") or ""
        if origin and not (origin.startswith("http://localhost") or origin.startswith("http://127.0.0.1")):
            log.warning("rejecting WebSocket from non-localhost Origin: %r", origin)
            await ws.close(code=4403, reason="origin not allowed")
            return

        self._clients.add(ws)
        peer = getattr(ws, "remote_address", "?")
        log.info("viewer connected (%s, %d total)", peer, len(self._clients))
        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    log.warning("non-JSON from viewer: %r", raw[:80])
                    continue
                t = msg.get("type")
                if t == "set_slope":
                    pct = float(msg.get("slope_pct", 0.0))
                    await self._send_slope(pct)
                elif t == "scan":
                    asyncio.create_task(self._handle_scan(ws))
                elif t == "connect":
                    addr = msg.get("address")
                    if isinstance(addr, str) and addr:
                        asyncio.create_task(self._handle_connect(ws, addr))
                elif t == "disconnect":
                    asyncio.create_task(self._handle_disconnect())
                elif t == "hrm_connect":
                    addr = msg.get("address")
                    if isinstance(addr, str) and addr:
                        asyncio.create_task(self._handle_hrm_connect(addr))
                elif t == "hrm_disconnect":
                    asyncio.create_task(self._handle_hrm_disconnect())
                elif t == "ride_start":
                    asyncio.create_task(self._handle_ride_start())
                elif t == "ride_end":
                    asyncio.create_task(self._handle_ride_end())
                elif t == "position":
                    # viewer 由来の現在地 1Hz push。 GPX 書き出し用に state 更新
                    try:
                        if msg.get("lat") is not None:
                            self.state.lat = float(msg["lat"])
                        if msg.get("lon") is not None:
                            self.state.lon = float(msg["lon"])
                        if msg.get("elevation_m") is not None:
                            self.state.elevation_m = float(msg["elevation_m"])
                        if msg.get("distance_m") is not None:
                            self.state.distance_m = float(msg["distance_m"])
                    except (TypeError, ValueError):
                        log.warning("bad position payload: %r", msg)
                else:
                    log.debug("ignored unknown command: %r", t)
        except ConnectionClosed:
            pass
        finally:
            self._clients.discard(ws)
            log.info("viewer disconnected (%d remain)", len(self._clients))

    # ---------- pairing commands ----------

    async def _handle_scan(self, ws) -> None:
        """BLE scan and push scan_result to all viewers. busy flag で 2 重起動を防ぐ。"""
        if getattr(self, "_scan_busy", False):
            await self._send_to_all({"type": "scan_status", "state": "busy"})
            return
        self._scan_busy = True
        try:
            await self._send_to_all({"type": "scan_status", "state": "scanning"})
            log.info("BLE scan starting (%.1fs)...", SCAN_TIMEOUT_S)
            try:
                devices = await BleakScanner.discover(timeout=SCAN_TIMEOUT_S, return_adv=True)
            except Exception as exc:
                log.warning("scan failed: %s", exc)
                await self._send_to_all({"type": "scan_status", "state": "failed", "message": str(exc)})
                return
            results = []
            for addr, (dev, adv) in devices.items():
                services = [s.lower() for s in (adv.service_uuids or [])]
                is_ftms = FTMS_SERVICE_UUID in services
                is_hrm = HEART_RATE_SERVICE_UUID in services
                results.append({
                    "address": dev.address,
                    "name": dev.name or adv.local_name or "<no-name>",
                    "rssi": getattr(adv, "rssi", None),
                    "is_ftms": is_ftms,
                    "is_hrm": is_hrm,
                })
            # FTMS / HRM を先頭、 残りは rssi 順
            results.sort(key=lambda r: (not (r["is_ftms"] or r["is_hrm"]), -(r["rssi"] or -200)))
            await self._send_to_all({"type": "scan_result", "devices": results})
            log.info("scan complete: %d devices, %d FTMS", len(results), sum(1 for r in results if r["is_ftms"]))
        finally:
            self._scan_busy = False

    async def _handle_connect(self, ws, address: str) -> None:
        """与えられた device address に接続。 タイムアウト判定は廃止 (試行は ftms_loop で進む)。
        成功通知は ftms_loop 内で subscribe 完了時に push される。 ダメなら静かに待つだけ。"""
        log.info("connect requested: %s", address)
        await self._send_to_all({"type": "connect_status", "state": "connecting", "address": address})
        self.device_addr = address
        self.device = address
        self.dummy = False
        self._mode_change.set()

    async def _handle_disconnect(self) -> None:
        log.info("disconnect requested")
        if self._ble_client is not None:
            with contextlib.suppress(Exception):
                await self._ble_client.disconnect()
        await self._send_to_all({"type": "disconnected", "reason": "user request"})

    # ---------- HRM (心拍計) -----------------------------------------------

    async def _handle_hrm_connect(self, address: str) -> None:
        """心拍計に接続。 既に別 HRM が繋がってればまず切ってから接続。"""
        log.info("HRM connect requested: %s", address)
        await self._handle_hrm_disconnect()
        self._hrm_addr = address
        await self._send_to_all({
            "type": "hrm_status", "state": "connecting", "address": address,
        })
        self._hrm_task = asyncio.create_task(self._hrm_loop(address))

    async def _handle_hrm_disconnect(self) -> None:
        if self._hrm_task is not None and not self._hrm_task.done():
            self._hrm_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._hrm_task
        self._hrm_task = None
        if self._hrm_client is not None:
            with contextlib.suppress(Exception):
                await self._hrm_client.disconnect()
            self._hrm_client = None
        if self._hrm_addr is not None:
            log.info("HRM disconnected: %s", self._hrm_addr)
            await self._send_to_all({
                "type": "hrm_status", "state": "disconnected", "address": self._hrm_addr,
            })
            self._hrm_addr = None
        # state からも bpm を消す
        self.state.hr_bpm = None

    async def _hrm_loop(self, addr: str) -> None:
        """HRM 機器に接続して Heart Rate Measurement を購読、 self.state.hr_bpm に反映。"""
        try:
            client = BleakClient(addr, timeout=CONNECT_TIMEOUT_S)
            await asyncio.wait_for(client.connect(), timeout=CONNECT_TIMEOUT_S)
        except (asyncio.TimeoutError, BleakError, OSError) as exc:
            log.warning("HRM connect failed (%s)", exc)
            await self._send_to_all({
                "type": "hrm_status", "state": "failed", "address": addr,
                "message": str(exc),
            })
            return
        self._hrm_client = client
        log.info("HRM connected: %s", addr)

        def _on_hr(_handle, data: bytearray) -> None:
            parsed = _parse_heart_rate(bytes(data))
            if "hr_bpm" in parsed:
                self.state.hr_bpm = parsed["hr_bpm"]
                # ack と同じく即時 push (1Hz 待ちで遅延を出さない)
                try:
                    loop = asyncio.get_running_loop()
                    loop.create_task(self._send_to_all({
                        "type": "state", **self.state.to_payload(),
                    }))
                except RuntimeError:
                    pass

        try:
            await client.start_notify(HEART_RATE_MEASUREMENT_UUID, _on_hr)
        except BleakError as exc:
            log.warning("HRM subscribe failed: %s", exc)
            with contextlib.suppress(Exception):
                await client.disconnect()
            await self._send_to_all({
                "type": "hrm_status", "state": "failed", "address": addr,
                "message": f"subscribe failed: {exc}",
            })
            self._hrm_client = None
            return

        await self._send_to_all({
            "type": "hrm_status", "state": "connected", "address": addr,
        })
        try:
            # 接続が切れるか cancel されるまで待機
            while client.is_connected:
                await asyncio.sleep(1.0)
        except asyncio.CancelledError:
            pass
        finally:
            with contextlib.suppress(Exception):
                await client.stop_notify(HEART_RATE_MEASUREMENT_UUID)
            with contextlib.suppress(Exception):
                await client.disconnect()

    async def _handle_ride_start(self) -> None:
        """ライド開始: 新規 CSV ファイル + 状態 reset。
        trainer 側との同期のため、 開始の合図として slope=0 を 1 回送る
        (前 ride で握ってた grade をクリアして flat から始まる)。"""
        # 旧 ride が開いてれば閉じる
        self._close_csv()
        self.state.distance_m = 0.0
        self.state.lat = None
        self.state.lon = None
        self.state.elevation_m = None
        self._open_csv()
        # trainer と再同期 (BLE 接続済なら slope=0、 切断中ならスキップ)
        await self._send_slope(0.0)
        log.info("ride started, logging to %s", self._csv_path)
        await self._send_to_all({
            "type": "ride_status", "state": "started",
            "csv_path": str(self._csv_path) if self._csv_path else None,
        })

    async def _handle_ride_end(self) -> None:
        """ライド終了: CSV を閉じて、 同じ basename で GPX を書く。 path を viewer に通知。"""
        if self._csv_path is None or self._csv_writer is None:
            log.info("ride_end requested but no active ride")
            await self._send_to_all({
                "type": "ride_status", "state": "no-active-ride",
            })
            return
        csv_path = self._csv_path
        self._close_csv()
        gpx_path = csv_path.with_suffix(".gpx")
        try:
            n = csv_to_gpx(csv_path, gpx_path, name=f"fujihc {csv_path.stem}")
            log.info("ride ended: %d points → %s", n, gpx_path)
            await self._send_to_all({
                "type": "ride_status", "state": "ended",
                "csv_path": str(csv_path), "gpx_path": str(gpx_path),
                "points": n,
            })
        except Exception as exc:
            log.warning("GPX export failed: %s", exc)
            await self._send_to_all({
                "type": "ride_status", "state": "export-failed",
                "csv_path": str(csv_path),
                "message": str(exc),
            })

    async def _send_to_all(self, payload: dict) -> None:
        data = json.dumps(payload)
        stale = []
        for client in list(self._clients):
            try:
                await client.send(data)
            except Exception:
                stale.append(client)
        for c in stale:
            self._clients.discard(c)

    async def _send_slope(self, slope_pct: float) -> None:
        self.state.slope_sent_pct = slope_pct
        if self._ble_client is None or not self._ble_client.is_connected:
            return
        payload = _encode_set_indoor_bike_simulation(slope_pct)
        # FTMS spec § 4.16: Control Point の Write は With-Response 想定。
        # ここで indication (ack) が返ってくる契約。 まず response=True で送って、
        # 機種が拒否したら no-resp に fallback する (一部 Wahoo の workaround 用)。
        try:
            await self._ble_client.write_gatt_char(
                FITNESS_MACHINE_CONTROL_POINT_UUID, payload, response=True
            )
            log.info("set-slope %.2f%% sent (resp, %d bytes hex=%s)",
                     slope_pct, len(payload), payload.hex())
        except BleakError as exc:
            log.warning("set-slope resp failed (%s), retrying with response=False", exc)
            try:
                await self._ble_client.write_gatt_char(
                    FITNESS_MACHINE_CONTROL_POINT_UUID, payload, response=False
                )
                log.info("set-slope %.2f%% sent (no-resp)", slope_pct)
            except BleakError as exc2:
                log.warning("set-slope %.2f%% failed both modes: %s", slope_pct, exc2)

    async def _push_loop(self) -> None:
        period = 1.0 / PUSH_HZ
        while not self._stopping.is_set():
            payload = json.dumps({"type": "state", **self.state.to_payload()})
            stale: list[websockets.WebSocketServerProtocol] = []
            for ws in list(self._clients):
                try:
                    await ws.send(payload)
                except ConnectionClosed:
                    stale.append(ws)
            for ws in stale:
                self._clients.discard(ws)
            self._append_csv()
            try:
                await asyncio.wait_for(self._stopping.wait(), timeout=period)
            except asyncio.TimeoutError:
                pass

    # ---------- CSV ----------

    def _open_csv(self) -> None:
        self.log_dir.mkdir(parents=True, exist_ok=True)
        stamp = _dt.datetime.now().strftime("%Y-%m-%d-%H%M%S")
        self._csv_path = self.log_dir / f"{stamp}.csv"
        self._csv_file = open(self._csv_path, "w", encoding="utf-8", newline="")
        self._csv_writer = csv.writer(self._csv_file)
        self._csv_writer.writerow([
            "time_iso", "distance_m", "lat", "lon", "elevation_m",
            "speed_mps", "power_w", "cadence_rpm", "hr_bpm", "slope_sent_pct",
        ])
        log.info("ride log: %s", self._csv_path)

    def _append_csv(self) -> None:
        if self._csv_writer is None:
            return
        s = self.state
        # tz 付き ISO 8601 (= GPX <time> としてそのまま使える)
        time_iso = _dt.datetime.now().astimezone().isoformat(timespec="seconds")
        self._csv_writer.writerow([
            time_iso,
            round(s.distance_m, 2),
            f"{s.lat:.7f}" if s.lat is not None else "",
            f"{s.lon:.7f}" if s.lon is not None else "",
            round(s.elevation_m, 2) if s.elevation_m is not None else "",
            round(s.speed_mps, 3),
            s.power_w if s.power_w is not None else "",
            round(s.cadence_rpm, 1) if s.cadence_rpm is not None else "",
            s.hr_bpm if s.hr_bpm is not None else "",
            round(s.slope_sent_pct, 2),
        ])
        self._csv_file.flush()

    def _close_csv(self) -> None:
        if self._csv_file is not None:
            with contextlib.suppress(Exception):
                self._csv_file.close()
            self._csv_file = None
            self._csv_writer = None

    # ---------- top-level ----------

    async def run(self) -> None:
        # CSV は ride_start で開く (起動だけでは log を作らない、 user 指示「明示 ON のみ」)
        # brief 17a: HTTP server (aiohttp) を WebSocket と並走、 127.0.0.1 限定
        http_app = make_http_app(self.db_path)
        http_runner = web.AppRunner(http_app)
        await http_runner.setup()
        http_site = web.TCPSite(http_runner, "127.0.0.1", self.http_port)
        await http_site.start()
        log.info("HTTP tile server listening on http://127.0.0.1:%d/tiles/", self.http_port)
        try:
            async with websockets.serve(self._ws_handler, "127.0.0.1", self.port):
                log.info("WebSocket server listening on ws://127.0.0.1:%d", self.port)

                push_task = asyncio.create_task(self._push_loop())

                # supervisor loop: dummy / ftms を mode_change で切替えながら回す。
                # _stopping が発火するまで bridge は生き続け、connect コマンド毎に source_task を作り直す。
                while not self._stopping.is_set():
                    if self.dummy:
                        log.info("dummy mode: emitting 20 km/h constant speed")
                        source_task = asyncio.create_task(self._dummy_loop())
                    else:
                        log.info("ftms mode: target device = %s", self.device_addr or "<scan>")
                        source_task = asyncio.create_task(self._ftms_loop())

                    # source_task が自然終了 (= ftms 失敗で dummy fallback)、
                    # または mode_change で再起動指示が来るまで wait
                    done, _ = await asyncio.wait(
                        [source_task, asyncio.create_task(self._mode_change.wait())],
                        return_when=asyncio.FIRST_COMPLETED,
                    )

                    if self._stopping.is_set():
                        source_task.cancel()
                        with contextlib.suppress(asyncio.CancelledError):
                            await source_task
                        break

                    if self._mode_change.is_set():
                        self._mode_change.clear()
                        source_task.cancel()
                        with contextlib.suppress(asyncio.CancelledError):
                            await source_task
                        # 既存 BLE があれば切断
                        if self._ble_client is not None:
                            with contextlib.suppress(Exception):
                                await self._ble_client.disconnect()
                            self._ble_client = None
                        # loop top で新 source_task 起動
                        continue

                    # source_task が自然に終わった (= ftms_loop が idle に入って mode_change で起きた)
                    # 次 loop 反復で再度 _ftms_loop を起動 (device 無しなら再び idle 待ち)

                push_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await push_task
        finally:
            self._close_csv()
            # brief 17a: HTTP server cleanup
            with contextlib.suppress(Exception):
                await http_runner.cleanup()

    def stop(self) -> None:
        self._stopping.set()


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="fujihc.bridge", description=__doc__)
    parser.add_argument("--device", help="BLE device address; if absent, scan + pick first FTMS")
    parser.add_argument("--dummy", action="store_true", help="skip BLE, emit constant speed")
    parser.add_argument("--fake-trainer", action="store_true",
                        help="BLE を使わず内蔵の fake trainer で full loop を simulate")
    parser.add_argument("--port", type=int, default=8765, help="WebSocket port (default 8765)")
    parser.add_argument("--http-port", type=int, default=8000,
                        help="HTTP tile server port (default 8000, 127.0.0.1 only)")
    parser.add_argument("--db-path", default="data/tiles.sqlite",
                        help="ローカル tile DB の path (brief 14)")
    parser.add_argument("--log-dir", default="~/fujihc-trainer/logs", help="CSV output dir")
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    bridge = Bridge(
        device=args.device,
        dummy=args.dummy,
        port=args.port,
        log_dir=Path(os.path.expanduser(args.log_dir)),
        fake_trainer=args.fake_trainer,
        http_port=args.http_port,
        db_path=Path(os.path.expanduser(args.db_path)),
    )
    if args.fake_trainer:
        # fake trainer は実 BLE 不要なので default device を fake address に
        if not bridge.device:
            bridge.device = "FA:KE:00:00:00:01"
        bridge.device_addr = bridge.device
        bridge.dummy = False   # supervisor を ftms_loop に向ける
        log.info("fake-trainer mode: simulated FTMS device at %s", bridge.device)

    async def _runner() -> int:
        loop = asyncio.get_running_loop()
        stop_fut = loop.create_future()

        def _on_signal() -> None:
            if not stop_fut.done():
                stop_fut.set_result(None)

        # Signal handlers only land on POSIX; on Windows we rely on KeyboardInterrupt.
        for sig_name in ("SIGINT", "SIGTERM"):
            try:
                import signal
                loop.add_signal_handler(getattr(signal, sig_name), _on_signal)
            except (NotImplementedError, AttributeError, ValueError):
                pass

        run_task = asyncio.create_task(bridge.run())
        try:
            done, _ = await asyncio.wait(
                {run_task, asyncio.ensure_future(stop_fut)},
                return_when=asyncio.FIRST_COMPLETED,
            )
            bridge.stop()
            await run_task
        except KeyboardInterrupt:
            bridge.stop()
            with contextlib.suppress(Exception):
                await run_task
        return 0

    try:
        return asyncio.run(_runner())
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    sys.exit(main())
