"""b120 = LFM 2km GPV から cloud_score 3D を計算する純関数 module。

plot3d_cloud.py (= scratch の探索 script) の物理計算部分を切り出し、
plotly 描画から分離した。 SoT 単一: sandbox 向け export (= export_lfm_to_viewer.py)
も将来の本体 viewer 向け export (= b121) も この module を import する。

依存: numpy + eccodes + scipy のみ (= plotly / matplotlib 不要)。

ref:
  - brief: ~/.agents/scratch/fujihc-trainer-project/b120-lfm-cloud-score-atlas-export.md
  - 探索元: ~/.agents/scratch/fujihc-trainer-project/lfm-sample/plot3d_cloud.py
"""
from __future__ import annotations
from pathlib import Path

import eccodes
import numpy as np
from scipy.interpolate import RegularGridInterpolator

eccodes.codes_grib_multi_support_on()


# === geometry / band const (= plot3d_cloud.py:20-47 から踏襲) ===
FUJI_LAT = 35.36
FUJI_LON = 138.73
BBOX = 0.3                    # +/- deg around Fuji
NX = 90                       # ~670m horizontal grid
NY = 90
Z_TARGETS_M = np.arange(0, 12001, 100)  # 121 layers, 100m step

# LFM L-pall has 16 isobaric levels (RH only exists 300..1000hPa = 12 levels).
LEVELS_HPA = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100]

# Lsurf cloud-coverage vertical bands (m).
CLOUD_BANDS = {
    "lcc": (500,   2000),     # low: cumulus / stratus
    "mcc": (2500,  5000),     # mid: altocumulus / altostratus
    "hcc": (9000,  11500),    # high: cirrus
}

CLOUD_RH_THRESHOLD = 70.0     # %
LSURF_CLOUD_THRESHOLD = 30.0  # %
SCORE_FLOOR = 55.0            # rendering threshold for cloud voxels


# === grib2 read helpers (= plot3d_cloud.py:50-79 から踏襲、 path を引数化) ===

def read_field(path: Path, short_name: str, type_of_level: str, level: int):
    """Read a single GRIB2 field. Returns (lats, lons, vals) for full grid."""
    with Path(path).open("rb") as f:
        while True:
            gid = eccodes.codes_grib_new_from_file(f)
            if gid is None:
                break
            try:
                if (eccodes.codes_get(gid, "shortName") == short_name
                        and eccodes.codes_get(gid, "typeOfLevel") == type_of_level
                        and eccodes.codes_get(gid, "level") == level):
                    nx = eccodes.codes_get(gid, "Ni")
                    ny = eccodes.codes_get(gid, "Nj")
                    lat1 = eccodes.codes_get(gid, "latitudeOfFirstGridPointInDegrees")
                    lat2 = eccodes.codes_get(gid, "latitudeOfLastGridPointInDegrees")
                    lon1 = eccodes.codes_get(gid, "longitudeOfFirstGridPointInDegrees")
                    lon2 = eccodes.codes_get(gid, "longitudeOfLastGridPointInDegrees")
                    vals = eccodes.codes_get_values(gid).reshape(ny, nx)
                    lats = np.linspace(lat1, lat2, ny)
                    lons = np.linspace(lon1, lon2, nx)
                    return lats, lons, vals
            finally:
                eccodes.codes_release(gid)
    raise KeyError(f"not found: {short_name} @ {type_of_level}={level}")


def crop(lats, lons, vals):
    """Crop to Fuji area BBOX."""
    lat_mask = (lats > FUJI_LAT - BBOX) & (lats < FUJI_LAT + BBOX)
    lon_mask = (lons > FUJI_LON - BBOX) & (lons < FUJI_LON + BBOX)
    return lats[lat_mask], lons[lon_mask], vals[np.ix_(lat_mask, lon_mask)]


def load_pl_data(lpall_path: Path):
    """Load LFM pressure-level data for the Fuji crop.

    Returns (lats, lons, dict_of_3d) where dict has keys gh/t/u/v/w/r,
    each (n_levels, ny, nx). RH ('r') only exists 300..1000hPa; upper
    levels are filled with NaN and handled in vertical interp."""
    lats = lons = None
    out = {"gh": [], "t": [], "u": [], "v": [], "w": [], "r": []}
    rh_levels = {1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300}
    for lvl in LEVELS_HPA:
        for short in ("gh", "t", "u", "v", "w"):
            la, lo, vv = read_field(lpall_path, short, "isobaricInhPa", lvl)
            la, lo, vv = crop(la, lo, vv)
            if lats is None:
                lats = la
                lons = lo
            out[short].append(vv)
        if lvl in rh_levels:
            la, lo, vv = read_field(lpall_path, "r", "isobaricInhPa", lvl)
            la, lo, vv = crop(la, lo, vv)
            out["r"].append(vv)
        else:
            out["r"].append(np.full_like(out["t"][-1], np.nan))
    for k in out:
        out[k] = np.array(out[k])
    return lats, lons, out


def vertical_interp_to_height(gh_3d, var_3d, target_z_m):
    """Interpolate var(gh) per (lat, lon) column onto target absolute heights (m).
    gh_3d/var_3d: (n_levels, ny, nx). Returns (nz, ny, nx)."""
    n_lev, ny, nx = gh_3d.shape
    nz = len(target_z_m)
    out = np.full((nz, ny, nx), np.nan, dtype=np.float64)
    for j in range(ny):
        for i in range(nx):
            gh_col = gh_3d[:, j, i]
            v_col = var_3d[:, j, i]
            order = np.argsort(gh_col)
            gh_sorted = gh_col[order]
            v_sorted = v_col[order]
            valid = ~np.isnan(v_sorted)
            if valid.sum() < 2:
                continue
            out[:, j, i] = np.interp(target_z_m, gh_sorted[valid], v_sorted[valid],
                                     left=np.nan, right=np.nan)
    return out


def horizontal_resample(lats_src, lons_src, field_zyx, lats_dst, lons_dst):
    """Bilinear-resample (nz, ny_src, nx_src) onto (nz, ny_dst, nx_dst)."""
    nz, _, _ = field_zyx.shape
    LA_dst, LO_dst = np.meshgrid(lats_dst, lons_dst, indexing="ij")
    pts = np.stack([LA_dst.ravel(), LO_dst.ravel()], axis=-1)
    out = np.empty((nz, len(lats_dst), len(lons_dst)))
    for k in range(nz):
        rgi = RegularGridInterpolator(
            (lats_src, lons_src), field_zyx[k],
            method="linear", bounds_error=False, fill_value=np.nan,
        )
        out[k] = rgi(pts).reshape(len(lats_dst), len(lons_dst))
    return out


# === main: cloud_score 3D field ===

def compute_cloud_score(lpall_path: Path, lsurf_path: Path) -> dict:
    """Build the 3D cloud development score field from LFM 2km GPV.

    Returns dict with:
      cloud_score: (nz=121, ny=90, nx=90) float64, range 0..100
      lats_dst, lons_dst, z_targets_m: 1D coord arrays
      rh_ice: (nz, ny, nx) ice-saturated RH (for debug / test)
      cover_3d: (nz, ny, nx) Lsurf cover broadcast over bands
      w_pa: (nz, ny, nx) vertical velocity in Pa/s

    Recipe (= plot3d_cloud.py:222-247 と同型):
      1. Vertical interp pressure-level (gh/t/w/r) to Z_TARGETS_M absolute height
      2. Horizontal resample to (NY, NX) at Fuji BBOX
      3. Lsurf cover (lcc/mcc/hcc) broadcast vertically into CLOUD_BANDS
      4. Ice-saturation correction: at T<0 degC, multiply RH by es_w/es_i
      5. Score = max(RH_ice, cover_3d * 0.6) + ascent_bonus - subsid_penalty,
         clipped to 0..100. ascent = clip(-w*5, 0, 25), subsid = clip(w*3, 0, 15).
    """
    lats_src, lons_src, pl = load_pl_data(lpall_path)

    T_h  = vertical_interp_to_height(pl["gh"], pl["t"], Z_TARGETS_M)
    W_h  = vertical_interp_to_height(pl["gh"], pl["w"], Z_TARGETS_M)
    RH_h = vertical_interp_to_height(pl["gh"], pl["r"], Z_TARGETS_M)

    lats_dst = np.linspace(FUJI_LAT - BBOX, FUJI_LAT + BBOX, NY)
    lons_dst = np.linspace(FUJI_LON - BBOX, FUJI_LON + BBOX, NX)
    T_1km  = horizontal_resample(lats_src, lons_src, T_h, lats_dst, lons_dst)
    W_1km  = horizontal_resample(lats_src, lons_src, W_h, lats_dst, lons_dst)
    RH_1km = horizontal_resample(lats_src, lons_src, RH_h, lats_dst, lons_dst)

    # Lsurf cover broadcast vertically into bands
    cover_3d = np.zeros_like(RH_1km, dtype=np.float64)
    for short, (z_lo, z_hi) in CLOUD_BANDS.items():
        la, lo, cov = read_field(lsurf_path, short, "surface", 0)
        la, lo, cov = crop(la, lo, cov)
        rgi = RegularGridInterpolator(
            (la, lo), cov, method="linear",
            bounds_error=False, fill_value=0.0,
        )
        LA, LO = np.meshgrid(lats_dst, lons_dst, indexing="ij")
        cov_1km = rgi(np.stack([LA.ravel(), LO.ravel()], axis=-1)).reshape(NY, NX)
        z_mask = (Z_TARGETS_M >= z_lo) & (Z_TARGETS_M < z_hi)
        for k in np.where(z_mask)[0]:
            cover_3d[k] = np.maximum(cover_3d[k], cov_1km)

    # Ice-saturation correction (Magnus)
    T_c = T_1km - 273.15
    with np.errstate(invalid="ignore"):
        es_w = 6.112 * np.exp(17.67 * T_c / (T_c + 243.5))
        es_i = 6.112 * np.exp(22.46 * T_c / (T_c + 272.62))
        ice_factor = np.where(T_c < 0, np.where(es_i > 0, es_w / es_i, 1.0), 1.0)
    RH_ice = np.where(np.isfinite(RH_1km), RH_1km * ice_factor, 0.0)
    RH_ice = np.clip(RH_ice, 0.0, 100.0)

    # Ascent / subsidence (w in Pa/s, negative=up)
    w_pa = np.where(np.isfinite(W_1km), W_1km, 0.0)
    ascent_bonus = np.clip(-w_pa * 5.0, 0.0, 25.0)
    subsid_penalty = np.clip(w_pa * 3.0, 0.0, 15.0)
    cover_weighted = cover_3d * 0.60

    cloud_score = np.clip(
        np.maximum(RH_ice, cover_weighted) + ascent_bonus - subsid_penalty,
        0.0, 100.0,
    )

    return {
        "cloud_score": cloud_score,
        "lats_dst": lats_dst,
        "lons_dst": lons_dst,
        "z_targets_m": Z_TARGETS_M,
        "rh_ice": RH_ice,
        "cover_3d": cover_3d,
        "w_pa": w_pa,
    }
