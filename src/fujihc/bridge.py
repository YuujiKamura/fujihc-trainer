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

log = logging.getLogger("fujihc.bridge")

FTMS_SERVICE_UUID = "00001826-0000-1000-8000-00805f9b34fb"
INDOOR_BIKE_DATA_UUID = "00002ad2-0000-1000-8000-00805f9b34fb"
FITNESS_MACHINE_CONTROL_POINT_UUID = "00002ad9-0000-1000-8000-00805f9b34fb"

FTMS_OP_REQUEST_CONTROL = 0x00
FTMS_OP_START = 0x07
FTMS_OP_SET_INDOOR_BIKE_SIMULATION = 0x11

CONNECT_TIMEOUT_S = 5.0
PUSH_HZ = 1.0


@dataclass
class RideState:
    """One sample of ride state. fields stay None until we know better."""
    distance_m: float = 0.0
    speed_mps: float = 0.0
    power_w: Optional[int] = None
    cadence_rpm: Optional[float] = None
    slope_sent_pct: float = 0.0

    def to_payload(self) -> dict:
        return {
            "distance_m": round(self.distance_m, 2),
            "speed_mps": round(self.speed_mps, 3),
            "power_w": self.power_w,
            "cadence_rpm": (
                round(self.cadence_rpm, 1) if self.cadence_rpm is not None else None
            ),
            "slope_sent_pct": round(self.slope_sent_pct, 2),
        }


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
    def __init__(self, *, device: Optional[str], dummy: bool, port: int, log_dir: Path):
        self.device = device
        self.dummy = dummy
        self.port = port
        self.log_dir = log_dir

        self.state = RideState()
        self._state_lock = asyncio.Lock()
        self._clients: set[websockets.WebSocketServerProtocol] = set()

        self._ble_client: Optional[BleakClient] = None
        self._csv_path: Optional[Path] = None
        self._csv_writer = None
        self._csv_file = None
        self._stopping = asyncio.Event()

    # ---------- BLE ----------

    async def _resolve_device(self) -> Optional[str]:
        if self.device:
            return self.device
        log.info("no --device given, scanning for FTMS for 6s...")
        try:
            found = await BleakScanner.discover(timeout=6.0, return_adv=True)
        except BleakError as exc:
            log.warning("BLE scan failed (%s) - falling back to dummy mode", exc)
            return None
        for addr, (_dev, adv) in found.items():
            services = [s.lower() for s in (adv.service_uuids or [])]
            if FTMS_SERVICE_UUID in services:
                log.info("picked FTMS device %s (%s)", addr, _dev.name or "?")
                return addr
        log.warning("no FTMS device found in scan - falling back to dummy mode")
        return None

    async def _ftms_loop(self) -> None:
        """Connect to the trainer and feed self.state from notifications.

        Any failure here (timeout, BleakError) flips us into dummy mode and
        exits cleanly - the WebSocket server keeps running with the dummy
        producer task instead.
        """
        addr = await self._resolve_device()
        if addr is None:
            self.dummy = True
            return

        log.info("connecting to %s (timeout %.0fs)...", addr, CONNECT_TIMEOUT_S)
        try:
            client = BleakClient(addr, timeout=CONNECT_TIMEOUT_S)
            await asyncio.wait_for(client.connect(), timeout=CONNECT_TIMEOUT_S)
        except (asyncio.TimeoutError, BleakError, OSError) as exc:
            log.warning("connect failed (%s) - falling back to dummy mode", exc)
            self.dummy = True
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
            log.warning("subscribe failed (%s) - falling back to dummy mode", exc)
            with contextlib.suppress(Exception):
                await client.disconnect()
            self.dummy = True
            return

        # Try (but do not require) to request control + start; some trainers
        # refuse simulation writes without this handshake, others ignore it.
        for opcode in (FTMS_OP_REQUEST_CONTROL, FTMS_OP_START):
            try:
                await client.write_gatt_char(
                    FITNESS_MACHINE_CONTROL_POINT_UUID, bytes([opcode]), response=True
                )
            except BleakError as exc:
                log.warning("FTMS control op 0x%02X failed: %s", opcode, exc)

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

    async def _ws_handler(self, ws: websockets.WebSocketServerProtocol) -> None:
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
                if msg.get("type") == "set_slope":
                    pct = float(msg.get("slope_pct", 0.0))
                    await self._send_slope(pct)
        except ConnectionClosed:
            pass
        finally:
            self._clients.discard(ws)
            log.info("viewer disconnected (%d remain)", len(self._clients))

    async def _send_slope(self, slope_pct: float) -> None:
        self.state.slope_sent_pct = slope_pct
        if self._ble_client is None or not self._ble_client.is_connected:
            return
        payload = _encode_set_indoor_bike_simulation(slope_pct)
        try:
            await self._ble_client.write_gatt_char(
                FITNESS_MACHINE_CONTROL_POINT_UUID, payload, response=True
            )
        except BleakError as exc:
            log.warning("set-slope %.2f%% failed: %s", slope_pct, exc)

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
            "time_iso", "distance_m", "speed_mps",
            "power_w", "cadence_rpm", "slope_sent_pct",
        ])
        log.info("ride log: %s", self._csv_path)

    def _append_csv(self) -> None:
        if self._csv_writer is None:
            return
        s = self.state
        self._csv_writer.writerow([
            _dt.datetime.now().isoformat(timespec="seconds"),
            round(s.distance_m, 2),
            round(s.speed_mps, 3),
            s.power_w if s.power_w is not None else "",
            round(s.cadence_rpm, 1) if s.cadence_rpm is not None else "",
            round(s.slope_sent_pct, 2),
        ])
        self._csv_file.flush()

    def _close_csv(self) -> None:
        if self._csv_file is not None:
            with contextlib.suppress(Exception):
                self._csv_file.close()

    # ---------- top-level ----------

    async def run(self) -> None:
        self._open_csv()
        try:
            async with websockets.serve(self._ws_handler, "localhost", self.port):
                log.info("WebSocket server listening on ws://localhost:%d", self.port)

                source_task: asyncio.Task
                if self.dummy:
                    log.info("dummy mode: emitting 20 km/h constant speed")
                    source_task = asyncio.create_task(self._dummy_loop())
                else:
                    source_task = asyncio.create_task(self._ftms_loop())

                push_task = asyncio.create_task(self._push_loop())

                # If FTMS fell back to dummy, _ftms_loop returns and we start
                # the dummy producer instead - keeps the WebSocket server up.
                await source_task
                if self.dummy and not push_task.done():
                    fallback = asyncio.create_task(self._dummy_loop())
                    try:
                        await self._stopping.wait()
                    finally:
                        fallback.cancel()
                        with contextlib.suppress(asyncio.CancelledError):
                            await fallback

                push_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await push_task
        finally:
            self._close_csv()

    def stop(self) -> None:
        self._stopping.set()


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="fujihc.bridge", description=__doc__)
    parser.add_argument("--device", help="BLE device address; if absent, scan + pick first FTMS")
    parser.add_argument("--dummy", action="store_true", help="skip BLE, emit constant speed")
    parser.add_argument("--port", type=int, default=8765, help="WebSocket port (default 8765)")
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
    )

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
