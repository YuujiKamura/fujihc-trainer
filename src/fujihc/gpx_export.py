"""Ride CSV → Strava 互換 GPX 変換。

CSV format (bridge.py で書き出される):
    time_iso, distance_m, lat, lon, elevation_m,
    speed_mps, power_w, cadence_rpm, slope_sent_pct

GPX 1.1 の本体に lat/lon/ele/time を、 Garmin TrackPointExtension 名前空間で
power と cadence を載せる。 Strava はこの形式を理解する。
"""
from __future__ import annotations

import csv
from pathlib import Path
from typing import Optional


def _esc(s: str) -> str:
    return (
        s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def csv_to_gpx(
    csv_path: Path,
    gpx_path: Path,
    name: str = "fujihc ride",
    activity_type: str = "Virtual Ride",
) -> int:
    """CSV を読んで GPX を書く。 返り値は書き出した trackpoint 数。
    lat / lon が無い行は skip する。
    activity_type は GPX の `<trk><type>` に入る。 default "Virtual Ride" は
    Strava の "Virtual Trainer Activities" にマッチさせるための値 (= 室内扱い相当)。
    """
    csv_path = Path(csv_path)
    gpx_path = Path(gpx_path)
    with csv_path.open("r", encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gpx version="1.1" creator="fujihc-trainer" '
        'xmlns="http://www.topografix.com/GPX/1/1" '
        'xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" '
        'xmlns:gpxpx="http://www.garmin.com/xmlschemas/PowerExtension/v1">',
        "  <trk>",
        f"    <name>{_esc(name)}</name>",
        f"    <type>{_esc(activity_type)}</type>",
        "    <trkseg>",
    ]
    count = 0
    for r in rows:
        lat = _f(r.get("lat"))
        lon = _f(r.get("lon"))
        if lat is None or lon is None:
            continue
        ele = _f(r.get("elevation_m"))
        time_iso = (r.get("time_iso") or "").strip()
        power = _f(r.get("power_w"))
        cad = _f(r.get("cadence_rpm"))
        hr = _f(r.get("hr_bpm"))

        lines.append(f'      <trkpt lat="{lat:.7f}" lon="{lon:.7f}">')
        if ele is not None:
            lines.append(f"        <ele>{ele:.2f}</ele>")
        if time_iso:
            lines.append(f"        <time>{_esc(time_iso)}</time>")
        # extensions:
        # - cadence / hr は Garmin TrackPointExtension (gpxtpx) → Strava 公式対応
        # - power は Garmin PowerExtension (gpxpx:PowerInWatts) + Strava 独自 <power> の両方を出す
        #   gpxtpx:power は Strava が読まないため power グラフが NaN になる (実測)
        tpx_parts: list[str] = []
        if cad is not None:
            tpx_parts.append(f"<gpxtpx:cad>{int(round(cad))}</gpxtpx:cad>")
        if hr is not None:
            tpx_parts.append(f"<gpxtpx:hr>{int(round(hr))}</gpxtpx:hr>")
        ext_blocks: list[str] = []
        if tpx_parts:
            ext_blocks.append(
                "<gpxtpx:TrackPointExtension>" + "".join(tpx_parts) + "</gpxtpx:TrackPointExtension>"
            )
        if power is not None:
            ext_blocks.append(f"<gpxpx:PowerInWatts>{int(round(power))}</gpxpx:PowerInWatts>")
            # Strava 独自の simple <power> 要素も併記 (extensions 内、 namespace なし)
            ext_blocks.append(f"<power>{int(round(power))}</power>")
        if ext_blocks:
            lines.append("        <extensions>" + "".join(ext_blocks) + "</extensions>")
        lines.append("      </trkpt>")
        count += 1

    lines.extend(["    </trkseg>", "  </trk>", "</gpx>", ""])
    gpx_path.write_text("\n".join(lines), encoding="utf-8")
    return count


def _f(s) -> Optional[float]:
    """空文字 / None / 非数値を None に丸める float 変換。"""
    if s is None or s == "":
        return None
    try:
        return float(s)
    except (ValueError, TypeError):
        return None
