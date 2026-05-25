"""既存 fujihc DEM cache (= data/tiles.sqlite) から標高を取得する path。

user 指示 (= 2026-05-25): 「地形データが必要なら富士ヒルアプリのタイルを遣え」。
配布元 (= 国土地理院) に再 fetch しない、 既存 cache 416 タイル zoom 15 dem5a_png
を再利用、 配布元負荷ゼロ。

本 script は最小 verify = sqlite を開いて 1 タイル decode + 標高分布表示、
sim 入力用の 富士山 grid reproject は次段。
"""
from __future__ import annotations
import io
import math
import sqlite3
import sys
from pathlib import Path

import numpy as np


# fujihc 既存 (= src/fujihill/tile_constants.py:TERRAIN_CONFIG と同値、 後段で import に差替え)
TERRAIN_CONFIG = {
    "zoom": 15,
    "bbox_km": 12.0,
    "center_lon": 138.7244,
    "center_lat": 35.4063,
}


def decode_dem_png(png_bytes: bytes) -> np.ndarray:
    """国土地理院 DEM PNG decode、 標高 [m] の 2D 配列返す。

    エンコード式 (GSI 公式): x = R*65536 + G*256 + B
                              elevation = x * 0.01            (x <  8388608)
                              elevation = (x - 16777216) * 0.01 (x >= 8388608、 負値)
                              無効値 = x == 8388608 → NaN
    """
    from PIL import Image
    img = Image.open(io.BytesIO(png_bytes))
    arr = np.array(img)
    R = arr[..., 0].astype(np.int64)
    G = arr[..., 1].astype(np.int64)
    B = arr[..., 2].astype(np.int64)
    x = R * 65536 + G * 256 + B
    elevation = np.where(x < 8388608, x * 0.01, (x - 16777216) * 0.01)
    elevation = np.where(x == 8388608, np.nan, elevation)
    return elevation


def tile_to_latlon(zoom: int, col: int, row: int) -> tuple[float, float, float, float]:
    """tile (z, x, y) -> bbox (lon_min, lat_min, lon_max, lat_max)、 GSI / OSM 標準"""
    n = 2 ** zoom
    lon_min = col / n * 360.0 - 180.0
    lon_max = (col + 1) / n * 360.0 - 180.0
    lat_max = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * row / n))))
    lat_min = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (row + 1) / n))))
    return lon_min, lat_min, lon_max, lat_max


def main(db_path: Path):
    if not db_path.exists():
        raise SystemExit(f"DEM cache 無し: {db_path}")
    con = sqlite3.connect(str(db_path))
    cur = con.cursor()

    n = cur.execute("SELECT COUNT(*) FROM tiles WHERE zoom_level = ?",
                    (TERRAIN_CONFIG["zoom"],)).fetchone()[0]
    print(f"zoom {TERRAIN_CONFIG['zoom']} tiles in fujihc cache: {n}")
    if n == 0:
        return

    # 富士山中心に最も近いタイル sample
    n_tiles = 2 ** TERRAIN_CONFIG["zoom"]
    cx = (TERRAIN_CONFIG["center_lon"] + 180.0) / 360.0 * n_tiles
    lat_r = math.radians(TERRAIN_CONFIG["center_lat"])
    cy = (1 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2 * n_tiles
    center_col, center_row = int(cx), int(cy)
    print(f"富士山中心 tile (z={TERRAIN_CONFIG['zoom']}): col={center_col} row={center_row}")

    sample = cur.execute(
        "SELECT tile_column, tile_row, data, format FROM tiles "
        "WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?",
        (TERRAIN_CONFIG["zoom"], center_col, center_row)
    ).fetchone()
    if sample is None:
        # 中心 tile 無いので近傍を取る
        sample = cur.execute(
            "SELECT tile_column, tile_row, data, format FROM tiles "
            "WHERE zoom_level = ? LIMIT 1",
            (TERRAIN_CONFIG["zoom"],)
        ).fetchone()

    col, row, blob, fmt = sample
    lon_min, lat_min, lon_max, lat_max = tile_to_latlon(TERRAIN_CONFIG["zoom"], col, row)
    print(f"\nsample tile: col={col} row={row} format={fmt}")
    print(f"  bbox: lon [{lon_min:.4f}, {lon_max:.4f}], lat [{lat_min:.4f}, {lat_max:.4f}]")
    print(f"  size: {len(blob)} bytes")

    if fmt.lower() == "png":
        elev = decode_dem_png(blob)
        valid = ~np.isnan(elev)
        print(f"\n  elevation shape: {elev.shape}")
        print(f"  elevation: min={np.nanmin(elev):.1f}m max={np.nanmax(elev):.1f}m "
              f"mean={np.nanmean(elev):.1f}m")
        print(f"  valid pixels: {valid.sum()}/{elev.size} ({valid.mean()*100:.1f}%)")

    # 全 zoom 15 タイル統計
    all_rows = cur.execute(
        "SELECT tile_column, tile_row FROM tiles WHERE zoom_level = ?",
        (TERRAIN_CONFIG["zoom"],)
    ).fetchall()
    cols = [r[0] for r in all_rows]
    rows = [r[1] for r in all_rows]
    print(f"\n全 zoom 15 タイル:")
    print(f"  col range: [{min(cols)}, {max(cols)}]")
    print(f"  row range: [{min(rows)}, {max(rows)}]")
    print(f"  bbox 内タイル数: {len(all_rows)}")

    con.close()
    print(f"\n次段: 全タイル組み立て + 富士山 中心 UTM 100m grid reproject + area-weighted coarsen、")
    print(f"      sim 下端境界 h(x, y) として NetCDF 出力 (= obs/build_terrain_grid.py、 未実装)")


if __name__ == "__main__":
    db = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("data/tiles.sqlite")
    main(db.absolute())
