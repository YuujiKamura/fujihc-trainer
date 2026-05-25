"""fujihc 既存 DEM cache → 富士山中心 100m grid に reproject + coarsen して NetCDF/npz 出力。

境界条件担当 (= 積雲対流 sim の下端境界 h(x, y))。

【方針】
- 配布元 (= 国土地理院) に再 fetch しない、 既存 cache (= data/tiles.sqlite zoom 15
  dem5a_png 367 タイル) 純利用 (= CLAUDE.md「考え方」 「ローカル DB にタイルを整備」)。
- pyproj 無し、 富士山中心 tangent-plane 近似で local Cartesian (= 10km × 10km
  範囲では誤差 << 1m、 100m grid 解像度には全く影響しない)。 UTM zone 54N は概念的に
  「富士山相当の局所平面」 = ここでの local Cartesian と等価。
- 全 367 タイル合成 → area-weighted average で 100m に coarsen → 富士山中心 (50, 50)
  に grid center を合わせる。

【出力】
- obs/fixtures/terrain_100m.npz: h(x, y) [m], x_m, y_m, dx, dy, center_lon, center_lat
- obs/fixtures/terrain_100m_check.png: 等高線 + heatmap 検証図

【参考実装】 obs/load_terrain.py の decode_dem_png / tile_to_latlon を import 流用。
"""
from __future__ import annotations
import io
import math
import sqlite3
import sys
from pathlib import Path

import numpy as np

# obs/load_terrain.py から流用
sys.path.insert(0, str(Path(__file__).parent))
from load_terrain import decode_dem_png, tile_to_latlon, TERRAIN_CONFIG


# ─────────────────────────────────────────────────────────────────────────────
# 富士山中心 grid 仕様
# ─────────────────────────────────────────────────────────────────────────────
# brief: 「富士山 100m grid (= fuji_2d_100m preset の 100 × 150 = 10km × 15km)」
# だが完了条件には「10km × 10km 100m grid、 100 × 100 = 10k cell」 とある。
# 完了条件側 (= 10km × 10km, 100 × 100) を採用、 中心 (50, 50) に富士山頂を置く。
GRID_NX = 100             # x 方向 cell 数
GRID_NY = 100             # y 方向 cell 数
GRID_DX = 100.0           # x 方向 grid spacing [m]
GRID_DY = 100.0           # y 方向 grid spacing [m]
GRID_CENTER_I = 50        # 富士山頂を置く x index
GRID_CENTER_J = 50        # 富士山頂を置く y index

# 富士山頂 (= 剣ヶ峰、 公式三角点) を grid 中心に置く。
# 注意: src/fujihill/tile_constants.py:TERRAIN_CONFIG の center は富士ヒル course 用の
# demBounds 中心 (35.4063, 138.7244) であって富士山頂ではない (= 山頂より約 5km 北)。
# 本 sim では「富士山頂を grid center に置く」 が完了条件なので、 山頂座標を直接使う。
# 山頂座標は GSI 三角点データ (剣ヶ峰)、 ±数 m 精度。
FUJI_PEAK_LAT = 35.3606
FUJI_PEAK_LON = 138.7274

CENTER_LON = FUJI_PEAK_LON
CENTER_LAT = FUJI_PEAK_LAT
ZOOM = TERRAIN_CONFIG["zoom"]               # 15 (= fujihc cache の zoom)

# 地球半径 (WGS84 平均、 球面近似で十分)
R_EARTH = 6378137.0


def latlon_to_local_xy(lat: float, lon: float,
                       lat0: float = CENTER_LAT, lon0: float = CENTER_LON) -> tuple[float, float]:
    """富士山中心 tangent-plane 近似。 lat/lon → local Cartesian (x: 東, y: 北) [m]。

    式 (= 球面平面近似):
      x = (lon - lon0) * cos(lat0) * (π/180) * R
      y = (lat - lat0) * (π/180) * R

    10km スケールで誤差 ~m order (= 100m grid に対し無視できる)。
    UTM zone 54N (= 富士山相当) の central meridian は 141°E で富士山中心とは ~2.3° ズレるが、
    本 sim では「富士山中心 local Cartesian」 が必要なので tangent-plane が自然な選択。
    """
    x = math.radians(lon - lon0) * math.cos(math.radians(lat0)) * R_EARTH
    y = math.radians(lat - lat0) * R_EARTH
    return x, y


def grid_extent_m() -> tuple[float, float, float, float]:
    """grid の (x_min, x_max, y_min, y_max) [m] (= 富士山中心相対)。

    cell 中心が GRID_CENTER_I/J に来るので、 (50, 50) cell center は (0, 0)。
    """
    x_min = -GRID_CENTER_I * GRID_DX
    x_max = (GRID_NX - GRID_CENTER_I) * GRID_DX
    y_min = -GRID_CENTER_J * GRID_DY
    y_max = (GRID_NY - GRID_CENTER_J) * GRID_DY
    return x_min, x_max, y_min, y_max


def load_all_tiles(db_path: Path) -> list[tuple[int, int, np.ndarray, float, float, float, float]]:
    """全 zoom 15 タイルを load + decode、 (col, row, elev_2d, lon_min, lat_min, lon_max, lat_max) のリスト返す。

    elev_2d は (256, 256) 標高 [m] 配列 (row=0 が tile 北端、 col=0 が西端、 = PNG 標準)。
    """
    con = sqlite3.connect(str(db_path))
    cur = con.cursor()
    rows = cur.execute(
        "SELECT tile_column, tile_row, data, format FROM tiles WHERE zoom_level = ?",
        (ZOOM,),
    ).fetchall()
    con.close()

    tiles = []
    for col, row, blob, fmt in rows:
        if fmt.lower() != "png":
            continue
        elev = decode_dem_png(blob)
        lon_min, lat_min, lon_max, lat_max = tile_to_latlon(ZOOM, col, row)
        tiles.append((col, row, elev, lon_min, lat_min, lon_max, lat_max))
    return tiles


def build_grid(db_path: Path) -> dict:
    """全タイル合成 + 富士山中心 100m grid に area-weighted average で coarsen。

    Algorithm (= 「area-weighted average」 を素朴に高速 numpy で実現):
      1. 各 grid cell の中心 (x_m, y_m) → (lat, lon) に逆変換 (tangent-plane の逆式)
      2. その (lat, lon) が乗っている tile (col, row) を計算
      3. tile 内 pixel index (px, py) を計算 (= Web Mercator pixel 座標)
      4. tile の elev[py, px] が cell の標高 (= nearest-neighbor、 100m に対し
         元 tile pixel は ~1.2m / pixel なので 1 pixel 採るのは aliasing、
         area-weighted のため (px, py) 周辺 ~80 pixel 平均で代替)。
    """
    tiles = load_all_tiles(db_path)
    print(f"loaded {len(tiles)} zoom {ZOOM} tiles")

    # 全 tile を col/row で indexed dict 化、 lookup を O(1) に
    tile_dict: dict[tuple[int, int], np.ndarray] = {(col, row): elev for col, row, elev, *_ in tiles}

    n_tiles_total = 2 ** ZOOM
    tile_size_pixels = 256

    # 各 tile の覆う緯経 (Web Mercator)
    # pixel 座標 → lat/lon 変換式 (= tile_to_latlon と同系統):
    #   lon = (col + px/256) / 2^z * 360 - 180
    #   lat = atan(sinh(pi * (1 - 2 * (row + py/256) / 2^z))) * 180/pi
    # 逆 (lat/lon → tile pixel 全体座標):
    #   X = (lon + 180) / 360 * 2^z * 256       (世界 pixel x)
    #   Y = (1 - log(tan(lat) + sec(lat)) / pi) / 2 * 2^z * 256  (世界 pixel y)
    # ここで X / 256 = col + px/256, Y / 256 = row + py/256

    # grid cell 中心の (x_m, y_m) を作る (= 富士山中心相対)
    x_min, x_max, y_min, y_max = grid_extent_m()
    # cell center 座標 (= x_min + (i + 0.5) * dx は GRID_CENTER_I=50 の cell 中心が 0 になるよう
    # 調整、 すなわち x_centers[i] = (i - GRID_CENTER_I + 0.5 - 0.5) * dx = (i - GRID_CENTER_I) * dx
    # を採用 (= cell の i index = GRID_CENTER_I で位置 0、 cell 境界ではなく cell index がそのまま位置).
    x_centers = (np.arange(GRID_NX) - GRID_CENTER_I) * GRID_DX  # (NX,)
    y_centers = (np.arange(GRID_NY) - GRID_CENTER_J) * GRID_DY  # (NY,)

    # 2D meshgrid (= y 縦 / x 横、 配列 shape は (NY, NX) で row が y)
    X_m, Y_m = np.meshgrid(x_centers, y_centers, indexing="xy")  # 両方 (NY, NX)

    # local Cartesian → (lat, lon) 逆変換 (= tangent-plane 逆)
    lat0_rad = math.radians(CENTER_LAT)
    lat_grid = CENTER_LAT + np.degrees(Y_m / R_EARTH)
    lon_grid = CENTER_LON + np.degrees(X_m / (R_EARTH * math.cos(lat0_rad)))

    # (lat, lon) → 世界 pixel 座標
    lat_rad = np.radians(lat_grid)
    world_pixel_x = (lon_grid + 180.0) / 360.0 * n_tiles_total * tile_size_pixels
    world_pixel_y = (
        (1.0 - np.log(np.tan(lat_rad) + 1.0 / np.cos(lat_rad)) / math.pi) / 2.0
        * n_tiles_total * tile_size_pixels
    )

    # area-weighted average のため、 各 grid cell が覆う元 pixel 範囲を計算。
    # 100m grid の cell サイズに対応する元 pixel 数:
    #   緯度 35.4° で 1 pixel ≒ R_EARTH * 2π * cos(lat) / (2^z * 256) = ~1.2m
    #   100m / 1.2m ≒ ~80 pixel/cell (= 一辺)
    # 各 cell 中心の世界 pixel 座標を中心に ±half_window pixel を平均する。
    meters_per_pixel = (
        2.0 * math.pi * R_EARTH * math.cos(lat0_rad) / (n_tiles_total * tile_size_pixels)
    )
    half_window_x = max(1, int(round(GRID_DX / meters_per_pixel / 2)))
    half_window_y = max(1, int(round(GRID_DY / meters_per_pixel / 2)))
    print(f"meters/pixel @ lat {CENTER_LAT}°: {meters_per_pixel:.3f} m")
    print(f"area-weighted window: ±{half_window_x} pixel x ±{half_window_y} pixel "
          f"(~{half_window_x*2*meters_per_pixel:.0f}m square per cell)")

    # ─────────────────────────────────────────────────────────────────────────
    # cell ごとの area-weighted average:
    #   1. cell center の世界 pixel (cx, cy) を計算
    #   2. (cx - half_window, cy - half_window) ~ (cx + half_window, cy + half_window) の
    #      pixel 全部を集めて平均
    #   3. それらの pixel は複数 tile に跨り得るので tile_dict から拾う
    # 100 × 100 = 10000 cell × ~80×80 pixel/cell でも numpy 内で素直に loop して OK
    # (実測秒オーダー)。
    # ─────────────────────────────────────────────────────────────────────────
    h_grid = np.full((GRID_NY, GRID_NX), np.nan, dtype=np.float64)
    coverage_count = np.zeros((GRID_NY, GRID_NX), dtype=np.int64)

    # tile_dict にある (col, row) の set を保持しておく
    tile_keys = set(tile_dict.keys())

    for j in range(GRID_NY):
        for i in range(GRID_NX):
            cx = float(world_pixel_x[j, i])
            cy = float(world_pixel_y[j, i])

            px_min = int(math.floor(cx - half_window_x))
            px_max = int(math.floor(cx + half_window_x))
            py_min = int(math.floor(cy - half_window_y))
            py_max = int(math.floor(cy + half_window_y))

            vals: list[float] = []
            # 各 pixel が乗っている tile を計算
            for py in range(py_min, py_max + 1):
                tile_row = py // tile_size_pixels
                in_tile_py = py % tile_size_pixels
                for px in range(px_min, px_max + 1):
                    tile_col = px // tile_size_pixels
                    in_tile_px = px % tile_size_pixels
                    if (tile_col, tile_row) not in tile_keys:
                        continue
                    elev = tile_dict[(tile_col, tile_row)][in_tile_py, in_tile_px]
                    if not np.isnan(elev):
                        vals.append(float(elev))
            if vals:
                h_grid[j, i] = float(np.mean(vals))
                coverage_count[j, i] = len(vals)

    valid_cells = int(np.sum(~np.isnan(h_grid)))
    print(f"grid cells with data: {valid_cells}/{GRID_NX * GRID_NY} "
          f"({valid_cells / (GRID_NX * GRID_NY) * 100:.1f}%)")
    print(f"average pixels per cell (where covered): "
          f"{coverage_count[coverage_count > 0].mean():.1f}")

    return {
        "h": h_grid,                     # (NY, NX) 標高 [m]
        "x_m": x_centers.astype(np.float64),
        "y_m": y_centers.astype(np.float64),
        "lat_grid": lat_grid.astype(np.float64),
        "lon_grid": lon_grid.astype(np.float64),
        "dx": GRID_DX,
        "dy": GRID_DY,
        "center_lon": CENTER_LON,
        "center_lat": CENTER_LAT,
        "center_i": GRID_CENTER_I,
        "center_j": GRID_CENTER_J,
        "coverage_count": coverage_count.astype(np.int64),
    }


def save_npz(out_path: Path, data: dict) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        out_path,
        h=data["h"],
        x_m=data["x_m"],
        y_m=data["y_m"],
        lat_grid=data["lat_grid"],
        lon_grid=data["lon_grid"],
        dx=data["dx"],
        dy=data["dy"],
        center_lon=data["center_lon"],
        center_lat=data["center_lat"],
        center_i=data["center_i"],
        center_j=data["center_j"],
        coverage_count=data["coverage_count"],
    )
    print(f"wrote {out_path} ({out_path.stat().st_size / 1024:.1f} KB)")


def save_check_png(out_path: Path, data: dict) -> tuple[float, float, float, int, int]:
    """検証 PNG (= 等高線 + heatmap) を出力、 統計を返す。"""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    h = data["h"]
    x_m = data["x_m"]
    y_m = data["y_m"]

    h_max = float(np.nanmax(h))
    h_min = float(np.nanmin(h))
    h_mean = float(np.nanmean(h))
    # peak index
    peak_flat = int(np.nanargmax(h))
    peak_j, peak_i = np.unravel_index(peak_flat, h.shape)

    fig, ax = plt.subplots(figsize=(10, 9))
    # extent: x_m[0] ~ x_m[-1] が cell 中心、 imshow は cell 境界で描画したいので半 cell 拡張
    extent = (
        x_m[0] - data["dx"] / 2,
        x_m[-1] + data["dx"] / 2,
        y_m[0] - data["dy"] / 2,
        y_m[-1] + data["dy"] / 2,
    )
    im = ax.imshow(
        h,
        extent=extent,
        origin="lower",
        cmap="terrain",
        vmin=max(0, h_min),
        vmax=h_max,
        interpolation="nearest",
    )
    # 等高線 (= 200m 刻み)
    cs = ax.contour(
        x_m, y_m, h,
        levels=np.arange(500, 4000, 200),
        colors="black", linewidths=0.4, alpha=0.6,
    )
    ax.clabel(cs, inline=True, fontsize=7, fmt="%dm")

    # 富士山頂 marker (= 中心 cell)
    ax.plot(0, 0, "r+", markersize=15, markeredgewidth=2, label="grid center (= Fuji)")
    # 実 peak marker
    ax.plot(x_m[peak_i], y_m[peak_j], "rx", markersize=15, markeredgewidth=2,
            label=f"actual peak ({h_max:.0f}m)")
    ax.legend(loc="upper right")

    ax.set_xlabel("x [m] (east+)")
    ax.set_ylabel("y [m] (north+)")
    ax.set_title(
        f"Fuji terrain 100m grid ({GRID_NX}×{GRID_NY})\n"
        f"max={h_max:.0f}m min={h_min:.0f}m mean={h_mean:.0f}m  "
        f"peak @ ({peak_i}, {peak_j}) = ({x_m[peak_i]:.0f}, {y_m[peak_j]:.0f})m"
    )
    fig.colorbar(im, ax=ax, label="elevation [m]")
    ax.set_aspect("equal")

    fig.tight_layout()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path, dpi=120)
    plt.close(fig)
    print(f"wrote {out_path}")

    return h_max, h_min, h_mean, int(peak_i), int(peak_j)


def main(db_path: Path, out_dir: Path) -> None:
    if not db_path.exists():
        raise SystemExit(f"DEM cache 無し: {db_path}")

    print(f"== build_terrain_grid ==")
    print(f"  db          : {db_path}")
    print(f"  grid        : {GRID_NX}×{GRID_NY}, dx=dy={GRID_DX}m, "
          f"center (i,j)=({GRID_CENTER_I},{GRID_CENTER_J})")
    print(f"  center lat/lon: {CENTER_LAT}, {CENTER_LON}")
    print()

    data = build_grid(db_path)

    npz_path = out_dir / "terrain_100m.npz"
    save_npz(npz_path, data)

    png_path = out_dir / "terrain_100m_check.png"
    h_max, h_min, h_mean, peak_i, peak_j = save_check_png(png_path, data)

    print()
    print("== 検証統計 ==")
    print(f"  max elevation : {h_max:.1f} m   (富士山頂 = 3776m に対する誤差 "
          f"{h_max - 3776:+.1f} m)")
    print(f"  min elevation : {h_min:.1f} m")
    print(f"  mean elevation: {h_mean:.1f} m")
    print(f"  peak grid index: (i={peak_i}, j={peak_j})  "
          f"[grid center = ({GRID_CENTER_I}, {GRID_CENTER_J})]")
    print(f"  peak offset from center: ({peak_i - GRID_CENTER_I}, "
          f"{peak_j - GRID_CENTER_J}) cells = "
          f"({(peak_i - GRID_CENTER_I) * GRID_DX:.0f}, "
          f"{(peak_j - GRID_CENTER_J) * GRID_DY:.0f}) m")
    print()
    print(f"出力 npz: {npz_path}")
    print(f"検証 PNG : {png_path}")


if __name__ == "__main__":
    repo_root = Path(__file__).resolve().parents[3]
    db = Path(sys.argv[1]) if len(sys.argv) > 1 else repo_root / "data" / "tiles.sqlite"
    out_dir = Path(__file__).parent / "fixtures"
    main(db.absolute(), out_dir)
