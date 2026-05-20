"""csv_to_gpx の契約 test。 出力 GPX を XML parse して内容を検証する。"""
from __future__ import annotations

import csv
import xml.etree.ElementTree as ET
from pathlib import Path
import sys

SRC = Path(__file__).resolve().parent.parent / "src"
sys.path.insert(0, str(SRC))

from fujihc.gpx_export import csv_to_gpx   # noqa: E402

GPX_NS = "{http://www.topografix.com/GPX/1/1}"
TPX_NS = "{http://www.garmin.com/xmlschemas/TrackPointExtension/v1}"
PWR_NS = "{http://www.garmin.com/xmlschemas/PowerExtension/v1}"


def _write_csv(path: Path, rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=[
            "time_iso", "distance_m", "lat", "lon", "elevation_m",
            "speed_mps", "power_w", "cadence_rpm", "slope_sent_pct",
        ])
        w.writeheader()
        for r in rows:
            w.writerow(r)


def test_csv_to_gpx_basic_structure(tmp_path: Path):
    """3 サンプル CSV → GPX で trkpt が 3 つ書かれる。"""
    csv_path = tmp_path / "ride.csv"
    gpx_path = tmp_path / "ride.gpx"
    _write_csv(csv_path, [
        {"time_iso": "2026-05-14T20:51:45+09:00", "distance_m": "0",
         "lat": "35.45215", "lon": "138.75866", "elevation_m": "1061.3",
         "speed_mps": "0", "power_w": "150", "cadence_rpm": "80",
         "slope_sent_pct": "0"},
        {"time_iso": "2026-05-14T20:51:46+09:00", "distance_m": "5",
         "lat": "35.45210", "lon": "138.75860", "elevation_m": "1062.0",
         "speed_mps": "5.0", "power_w": "180", "cadence_rpm": "85",
         "slope_sent_pct": "5.5"},
        {"time_iso": "2026-05-14T20:51:47+09:00", "distance_m": "12",
         "lat": "35.45205", "lon": "138.75855", "elevation_m": "1063.0",
         "speed_mps": "6.0", "power_w": "200", "cadence_rpm": "90",
         "slope_sent_pct": "6.0"},
    ])
    n = csv_to_gpx(csv_path, gpx_path, name="test ride")
    assert n == 3
    assert gpx_path.exists()
    tree = ET.parse(gpx_path)
    root = tree.getroot()
    assert root.tag == f"{GPX_NS}gpx"
    trkpts = root.findall(f"./{GPX_NS}trk/{GPX_NS}trkseg/{GPX_NS}trkpt")
    assert len(trkpts) == 3
    # 最初の trkpt
    assert trkpts[0].attrib["lat"] == "35.4521500"
    assert trkpts[0].attrib["lon"] == "138.7586600"
    ele = trkpts[0].find(f"{GPX_NS}ele")
    assert ele is not None and abs(float(ele.text) - 1061.3) < 0.01
    time_el = trkpts[0].find(f"{GPX_NS}time")
    assert time_el is not None
    assert "2026-05-14T20:51:45+09:00" in time_el.text


def test_csv_to_gpx_power_cadence_extensions(tmp_path: Path):
    """cadence は Garmin TrackPointExtension、 power は Garmin PowerExtension + Strava 独自 <power> の両方。
    (gpxtpx:power は Strava が読まないため使わない)。"""
    csv_path = tmp_path / "ride.csv"
    gpx_path = tmp_path / "ride.gpx"
    _write_csv(csv_path, [
        {"time_iso": "2026-05-14T20:51:46+09:00", "distance_m": "5",
         "lat": "35.45210", "lon": "138.75860", "elevation_m": "1062.0",
         "speed_mps": "5.0", "power_w": "180", "cadence_rpm": "85",
         "slope_sent_pct": "5.5"},
    ])
    csv_to_gpx(csv_path, gpx_path)
    tree = ET.parse(gpx_path)
    root = tree.getroot()
    trkpt = root.find(f"./{GPX_NS}trk/{GPX_NS}trkseg/{GPX_NS}trkpt")
    ext = trkpt.find(f"{GPX_NS}extensions")
    assert ext is not None
    # cadence は gpxtpx 名前空間内
    tpx = ext.find(f"{TPX_NS}TrackPointExtension")
    assert tpx is not None
    cad = tpx.find(f"{TPX_NS}cad")
    assert cad is not None and cad.text == "85"
    # power は gpxpx:PowerInWatts (Garmin PowerExtension) + Strava 独自 <power>
    pwr_garmin = ext.find(f"{PWR_NS}PowerInWatts")
    assert pwr_garmin is not None and pwr_garmin.text == "180"
    # Strava 独自 <power> は GPX default namespace で書かれる (parent から inherit)
    pwr_simple = ext.find(f"{GPX_NS}power")
    assert pwr_simple is not None and pwr_simple.text == "180"


def test_csv_to_gpx_hr_extension(tmp_path: Path):
    """heart rate は Garmin TrackPointExtension の <gpxtpx:hr> で書き出される。"""
    csv_path = tmp_path / "ride.csv"
    gpx_path = tmp_path / "ride.gpx"
    # hr_bpm カラムを含む 1 行
    with csv_path.open("w", encoding="utf-8", newline="") as f:
        import csv as _csv
        w = _csv.DictWriter(f, fieldnames=[
            "time_iso", "distance_m", "lat", "lon", "elevation_m",
            "speed_mps", "power_w", "cadence_rpm", "hr_bpm", "slope_sent_pct",
        ])
        w.writeheader()
        w.writerow({"time_iso": "2026-05-14T20:51:46+09:00", "distance_m": "5",
                    "lat": "35.45210", "lon": "138.75860", "elevation_m": "1062.0",
                    "speed_mps": "5.0", "power_w": "180", "cadence_rpm": "85",
                    "hr_bpm": "142", "slope_sent_pct": "5.5"})
    csv_to_gpx(csv_path, gpx_path)
    tree = ET.parse(gpx_path)
    trkpt = tree.getroot().find(f"./{GPX_NS}trk/{GPX_NS}trkseg/{GPX_NS}trkpt")
    tpx = trkpt.find(f"{GPX_NS}extensions/{TPX_NS}TrackPointExtension")
    assert tpx is not None
    hr = tpx.find(f"{TPX_NS}hr")
    assert hr is not None and hr.text == "142"


def test_csv_to_gpx_skips_rows_without_position(tmp_path: Path):
    """lat / lon が空の行は trkpt として出さない。"""
    csv_path = tmp_path / "ride.csv"
    gpx_path = tmp_path / "ride.gpx"
    _write_csv(csv_path, [
        {"time_iso": "2026-05-14T20:51:45+09:00", "distance_m": "0",
         "lat": "", "lon": "", "elevation_m": "",
         "speed_mps": "0", "power_w": "", "cadence_rpm": "",
         "slope_sent_pct": "0"},
        {"time_iso": "2026-05-14T20:51:46+09:00", "distance_m": "5",
         "lat": "35.45210", "lon": "138.75860", "elevation_m": "1062.0",
         "speed_mps": "5.0", "power_w": "180", "cadence_rpm": "85",
         "slope_sent_pct": "5.5"},
    ])
    n = csv_to_gpx(csv_path, gpx_path)
    assert n == 1   # lat/lon 揃ってる 1 行のみ


def test_csv_to_gpx_activity_type_default_virtual_ride(tmp_path: Path):
    """default で <trk><type>Virtual Ride</type> を書く (Strava 室内扱い相当)。"""
    csv_path = tmp_path / "ride.csv"
    gpx_path = tmp_path / "ride.gpx"
    _write_csv(csv_path, [
        {"time_iso": "2026-05-14T20:51:45+09:00", "distance_m": "0",
         "lat": "35.45215", "lon": "138.75866", "elevation_m": "1061.3",
         "speed_mps": "0", "power_w": "150", "cadence_rpm": "80",
         "slope_sent_pct": "0"},
    ])
    csv_to_gpx(csv_path, gpx_path)
    tree = ET.parse(gpx_path)
    type_el = tree.getroot().find(f"./{GPX_NS}trk/{GPX_NS}type")
    assert type_el is not None
    assert type_el.text == "Virtual Ride"


def test_csv_to_gpx_activity_type_override(tmp_path: Path):
    """activity_type 引数で override できる。"""
    csv_path = tmp_path / "ride.csv"
    gpx_path = tmp_path / "ride.gpx"
    _write_csv(csv_path, [
        {"time_iso": "2026-05-14T20:51:45+09:00", "distance_m": "0",
         "lat": "35.45215", "lon": "138.75866", "elevation_m": "1061.3",
         "speed_mps": "0", "power_w": "", "cadence_rpm": "",
         "slope_sent_pct": "0"},
    ])
    csv_to_gpx(csv_path, gpx_path, activity_type="cycling")
    tree = ET.parse(gpx_path)
    type_el = tree.getroot().find(f"./{GPX_NS}trk/{GPX_NS}type")
    assert type_el is not None
    assert type_el.text == "cycling"


def test_csv_to_gpx_empty_rows(tmp_path: Path):
    """空 CSV は trkpt ゼロの GPX を吐いて落ちない。"""
    csv_path = tmp_path / "empty.csv"
    gpx_path = tmp_path / "empty.gpx"
    _write_csv(csv_path, [])
    n = csv_to_gpx(csv_path, gpx_path)
    assert n == 0
    assert gpx_path.exists()
    tree = ET.parse(gpx_path)
    trkseg = tree.getroot().find(f"./{GPX_NS}trk/{GPX_NS}trkseg")
    assert trkseg is not None
    assert len(trkseg.findall(f"{GPX_NS}trkpt")) == 0


def test_csv_to_gpx_handles_missing_power_cadence(tmp_path: Path):
    """power / cadence が空でも trkpt は書かれる、 extensions が省略されるだけ。"""
    csv_path = tmp_path / "ride.csv"
    gpx_path = tmp_path / "ride.gpx"
    _write_csv(csv_path, [
        {"time_iso": "2026-05-14T20:51:45+09:00", "distance_m": "0",
         "lat": "35.45215", "lon": "138.75866", "elevation_m": "1061.3",
         "speed_mps": "0", "power_w": "", "cadence_rpm": "",
         "slope_sent_pct": "0"},
    ])
    n = csv_to_gpx(csv_path, gpx_path)
    assert n == 1
    tree = ET.parse(gpx_path)
    trkpt = tree.getroot().find(f"./{GPX_NS}trk/{GPX_NS}trkseg/{GPX_NS}trkpt")
    ext = trkpt.find(f"{GPX_NS}extensions")
    # extensions は無いか、 あっても TPX 要素がなくて空っぽ
    if ext is not None:
        tpx = ext.find(f"{TPX_NS}TrackPointExtension")
        assert tpx is None or len(list(tpx)) == 0
