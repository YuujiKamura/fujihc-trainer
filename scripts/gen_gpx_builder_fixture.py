"""brief 33: web/tests/gpx_builder.test.js 用 fixture を Python 側 gpx_export.py で生成.

Python 版と JS 版 (web/lib/gpx_builder.js) の出力 byte-level 一致を担保するため、
固定 trkpts 一式を CSV にして csv_to_gpx で書き、 GPX 出力を fixture JSON に保存する。

usage:
    python scripts/gen_gpx_builder_fixture.py
出力: web/tests/fixtures/py_gpx_builder_basic.json
"""
from __future__ import annotations

import csv
import json
import tempfile
from pathlib import Path

from fujihill.gpx_export import csv_to_gpx


def main() -> None:
    rows = [
        # 全フィールドあり
        {"time_iso": "2026-05-15T07:30:00Z", "distance_m": "0", "lat": "35.4000000", "lon": "138.7000000",
         "elevation_m": "1000.00", "speed_mps": "5.5", "power_w": "210", "cadence_rpm": "85",
         "slope_sent_pct": "5.0", "hr_bpm": "142"},
        # power のみ
        {"time_iso": "2026-05-15T07:30:01Z", "distance_m": "5", "lat": "35.4010000", "lon": "138.7000000",
         "elevation_m": "1010.50", "speed_mps": "5.5", "power_w": "215", "cadence_rpm": "",
         "slope_sent_pct": "5.1", "hr_bpm": ""},
        # cad のみ
        {"time_iso": "2026-05-15T07:30:02Z", "distance_m": "10", "lat": "35.4020000", "lon": "138.7000000",
         "elevation_m": "1021.00", "speed_mps": "5.5", "power_w": "", "cadence_rpm": "88",
         "slope_sent_pct": "5.2", "hr_bpm": ""},
        # 全 null
        {"time_iso": "2026-05-15T07:30:03Z", "distance_m": "15", "lat": "35.4030000", "lon": "138.7000000",
         "elevation_m": "1031.50", "speed_mps": "5.5", "power_w": "", "cadence_rpm": "",
         "slope_sent_pct": "5.3", "hr_bpm": ""},
        # ele なし
        {"time_iso": "2026-05-15T07:30:04Z", "distance_m": "20", "lat": "35.4040000", "lon": "138.7000000",
         "elevation_m": "", "speed_mps": "5.5", "power_w": "200", "cadence_rpm": "80",
         "slope_sent_pct": "5.4", "hr_bpm": "140"},
        # time なし
        {"time_iso": "", "distance_m": "25", "lat": "35.4050000", "lon": "138.7000000",
         "elevation_m": "1052.00", "speed_mps": "5.5", "power_w": "200", "cadence_rpm": "80",
         "slope_sent_pct": "5.5", "hr_bpm": "140"},
        # lat 欠落 → skip 対象
        {"time_iso": "2026-05-15T07:30:06Z", "distance_m": "30", "lat": "", "lon": "138.7000000",
         "elevation_m": "1060.00", "speed_mps": "5.5", "power_w": "200", "cadence_rpm": "80",
         "slope_sent_pct": "5.6", "hr_bpm": "140"},
    ]

    # 対応する trkpts (= JS 側 buildGpxXml 入力). lat 欠落の row は除外、
    # JS 側でも `lat === null` で skip するので fixture 配列も skip 後の形にする。
    trkpts_for_js = [
        {"t": "2026-05-15T07:30:00Z", "lat": 35.4, "lon": 138.7, "ele": 1000.0, "power": 210, "cad": 85, "hr": 142},
        {"t": "2026-05-15T07:30:01Z", "lat": 35.401, "lon": 138.7, "ele": 1010.5, "power": 215, "cad": None, "hr": None},
        {"t": "2026-05-15T07:30:02Z", "lat": 35.402, "lon": 138.7, "ele": 1021.0, "power": None, "cad": 88, "hr": None},
        {"t": "2026-05-15T07:30:03Z", "lat": 35.403, "lon": 138.7, "ele": 1031.5, "power": None, "cad": None, "hr": None},
        {"t": "2026-05-15T07:30:04Z", "lat": 35.404, "lon": 138.7, "ele": None, "power": 200, "cad": 80, "hr": 140},
        {"t": "", "lat": 35.405, "lon": 138.7, "ele": 1052.0, "power": 200, "cad": 80, "hr": 140},
    ]

    with tempfile.TemporaryDirectory() as td:
        csv_path = Path(td) / "in.csv"
        gpx_path = Path(td) / "out.gpx"
        fields = ["time_iso", "distance_m", "lat", "lon", "elevation_m", "speed_mps",
                  "power_w", "cadence_rpm", "slope_sent_pct", "hr_bpm"]
        with csv_path.open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fields)
            w.writeheader()
            for r in rows:
                w.writerow(r)
        count = csv_to_gpx(csv_path, gpx_path, name="fujihill ride", activity_type="Virtual Ride")
        gpx_text = gpx_path.read_text(encoding="utf-8")

    out = {
        "input_trkpts": trkpts_for_js,
        "opts": {"name": "fujihill ride", "activity_type": "Virtual Ride"},
        "expected_gpx": gpx_text,
        "count": count,
    }
    target = Path(__file__).resolve().parents[1] / "web" / "tests" / "fixtures" / "py_gpx_builder_basic.json"
    target.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {target} count={count} bytes={len(gpx_text)}")


if __name__ == "__main__":
    main()
