"""BLE scan for smart trainers (FTMS 0x1826) - the first runnable bit.

usage:
    python -m fujihc.discover

Prints all BLE devices visible during a 10s scan, flags those advertising the
Fitness Machine Service. Goal: identify yuuji's trainer's BLE address before
any control code is written.
"""
import asyncio
import sys
from bleak import BleakScanner

FTMS_UUID = "00001826-0000-1000-8000-00805f9b34fb"


async def scan(timeout: float = 10.0) -> int:
    print(f"Scanning BLE for {timeout:.0f}s (FTMS = Fitness Machine Service 0x1826)...")
    discovered = await BleakScanner.discover(timeout=timeout, return_adv=True)
    if not discovered:
        print("  no devices found. trainer awake? BLE adapter on? in pairing mode?")
        return 1

    ftms_count = 0
    for addr, (device, adv) in discovered.items():
        services = [s.lower() for s in (adv.service_uuids or [])]
        is_ftms = FTMS_UUID in services
        marker = "  <FTMS>" if is_ftms else ""
        name = device.name or adv.local_name or "<no-name>"
        rssi = getattr(adv, "rssi", None)
        rssi_str = f"rssi={rssi:>4}" if rssi is not None else "rssi=  ? "
        print(f"  {addr}  {rssi_str}  {name:30s}{marker}")
        if is_ftms:
            ftms_count += 1

    print(f"\n{len(discovered)} device(s) seen, {ftms_count} advertise FTMS")
    if ftms_count == 0:
        print("no FTMS trainer found. options:")
        print("  - turn trainer power on, spin a pedal stroke to wake it")
        print("  - re-pair / forget previous BT pairings")
        print("  - your trainer may speak FE-C ANT+ only, not BLE FTMS")
    return 0 if ftms_count > 0 else 2


def main() -> int:
    return asyncio.run(scan())


if __name__ == "__main__":
    sys.exit(main())
