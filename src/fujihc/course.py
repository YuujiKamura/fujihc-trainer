"""GPX → course profile (distance / elevation / slope).

Pure-Python, no BLE. Loads any GPX file and produces a sequence of
(cumulative_distance_m, elevation_m, slope_pct) samples that the trainer
bridge will replay during a ride.

usage:
    python -m fujihc.course ~/Downloads/fujihc/fujihc-course.gpx
"""
from __future__ import annotations

import math
import sys
from dataclasses import dataclass
from pathlib import Path

import gpxpy


@dataclass(frozen=True)
class CoursePoint:
    distance_m: float       # cumulative from start
    elevation_m: float
    slope_pct: float        # smoothed slope leading into this point
    lat: float
    lon: float


def _haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    """great-circle distance in meters between (lat, lon) pairs."""
    R = 6_371_000.0
    p1 = math.radians(a[0])
    p2 = math.radians(b[0])
    dp = p2 - p1
    dl = math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def load_course(path: Path, smooth_window_m: float = 50.0) -> list[CoursePoint]:
    """Parse GPX file, return a list of CoursePoint sampled at every trkpt.

    Slope is smoothed over `smooth_window_m` meters (default 50m) so that
    noisy elevation jumps from GPS don't slam the trainer with garbage.
    """
    gpx = gpxpy.parse(path.read_text(encoding="utf-8"))
    raw: list[tuple[float, float, float]] = []  # (cum_dist, ele, lat, lon)
    points: list[tuple[float, float, float, float]] = []

    cum = 0.0
    prev: tuple[float, float] | None = None
    for trk in gpx.tracks:
        for seg in trk.segments:
            for p in seg.points:
                if p.elevation is None:
                    continue
                if prev is not None:
                    cum += _haversine_m((p.latitude, p.longitude), prev)
                prev = (p.latitude, p.longitude)
                points.append((cum, p.elevation, p.latitude, p.longitude))

    if len(points) < 2:
        return []

    # slope: rise_over_run over a backward window of ~smooth_window_m
    out: list[CoursePoint] = []
    for i, (d, e, lat, lon) in enumerate(points):
        # find earliest j such that d - points[j][0] >= smooth_window_m
        j = i
        while j > 0 and (d - points[j][0]) < smooth_window_m:
            j -= 1
        run = d - points[j][0]
        rise = e - points[j][1]
        slope = (rise / run * 100.0) if run > 0 else 0.0
        out.append(CoursePoint(d, e, slope, lat, lon))
    return out


def summary(course: list[CoursePoint]) -> dict:
    if not course:
        return {"n": 0}
    eles = [p.elevation_m for p in course]
    slopes = [p.slope_pct for p in course]
    return {
        "n": len(course),
        "distance_km": course[-1].distance_m / 1000.0,
        "elevation_min_m": min(eles),
        "elevation_max_m": max(eles),
        "elevation_gain_m": max(eles) - min(eles),
        "slope_min_pct": min(slopes),
        "slope_max_pct": max(slopes),
        "slope_avg_pct": sum(slopes) / len(slopes),
        "start": (course[0].lat, course[0].lon),
        "end": (course[-1].lat, course[-1].lon),
    }


def export_json(course: list[CoursePoint], out: Path) -> None:
    """Dump course points as JSON for the web viewer."""
    import json
    data = [
        {
            "distance_m": round(p.distance_m, 2),
            "elevation_m": round(p.elevation_m, 2),
            "slope_pct": round(p.slope_pct, 3),
            "lat": p.lat,
            "lon": p.lon,
        }
        for p in course
    ]
    out.write_text(json.dumps(data), encoding="utf-8")


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: python -m fujihc.course <gpx-path> [--export-json <path>]")
        return 1
    path = Path(argv[1]).expanduser()
    if not path.exists():
        print(f"not found: {path}")
        return 1
    course = load_course(path)
    s = summary(course)
    if s["n"] == 0:
        print("empty course (no trkpt with elevation)")
        return 2
    print(f"trkpt:           {s['n']}")
    print(f"distance:        {s['distance_km']:.2f} km")
    print(f"elevation:       {s['elevation_min_m']:.0f} -> {s['elevation_max_m']:.0f} m (gain {s['elevation_gain_m']:.0f} m)")
    print(f"slope range:     {s['slope_min_pct']:+.2f}% .. {s['slope_max_pct']:+.2f}%  (avg {s['slope_avg_pct']:+.2f}%)")
    print(f"start coord:     {s['start'][0]:.4f}, {s['start'][1]:.4f}")
    print(f"end coord:       {s['end'][0]:.4f}, {s['end'][1]:.4f}")
    print(f"sample first 5:")
    for p in course[:5]:
        print(f"  {p.distance_m:8.1f} m  ele {p.elevation_m:6.1f} m  slope {p.slope_pct:+5.2f}%")

    if "--export-json" in argv:
        idx = argv.index("--export-json")
        if idx + 1 < len(argv):
            out = Path(argv[idx + 1]).expanduser()
            export_json(course, out)
            print(f"exported {len(course)} points -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
