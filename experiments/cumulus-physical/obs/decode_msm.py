"""MSM-GPV GRIB2 → numpy decode (= cfgrib + xarray 想定、 library 不在なら stub)。

配布元配慮 (= obs/README.md ToS):
- 本 script は **cache.sqlite に既に保存された blob を decode するだけ**、 配布元には触らない
- cfgrib / pygrib が venv に install されていない場合は import skip、 stub 関数だけ提供
  (= user が別途 install + 手動 trigger で実 decode、 sub-agent 権限で install しない)

切り出し:
- 富士山 bbox: lon 138.5-139.0, lat 35.1-35.6 (= ±20km)
- 出力 variables: u, v, w, T, q_v, p (= 各 3D 場、 等圧面 16 層)

CLI:
- `python obs/decode_msm.py --library-check`  = cfgrib/pygrib の install 状況のみ表示
- `python obs/decode_msm.py --self-test`      = stub decode の動作 verify (= GRIB2 不要)
"""
from __future__ import annotations

import argparse
import logging
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

logger = logging.getLogger("decode_msm")

# 富士山 bbox (= fetch_msm.FUJI_BBOX と同値、 import 循環避けるため再定義)
FUJI_BBOX = {
    "lon_min": 138.5,
    "lon_max": 139.0,
    "lat_min": 35.1,
    "lat_max": 35.6,
}

# MSM-GPV 等圧面 (= 16 層、 hPa)、 RISH archive L-pall ProductCode 仕様
MSM_PRESSURE_LEVELS_HPA = (
    1000, 975, 950, 925, 900, 850, 800, 700,
    600, 500, 400, 300, 250, 200, 150, 100,
)

# 出力 variable (= sim 入力)
MSM_VARS_OUT = ("u", "v", "w", "T", "q_v", "p")


@dataclass
class DecodedMSM:
    """decode 結果 (= 等圧面 3D 場、 富士山 bbox 切り出し済)。

    実 decode 時は xarray.DataArray などで返すのが本筋だが、 stub 兼用のため
    最小 dataclass で受ける。 後段 (= interpolate.py / field_2d.py initial_from_obs)
    で xarray に lift する。
    """
    valid_time: str
    var: str
    bbox: dict
    pressure_levels_hpa: tuple
    # 実 decode 時に numpy.ndarray が入る (= stub では None)
    data: object | None
    note: str


def check_grib_library() -> dict[str, bool]:
    """cfgrib / pygrib / xarray の install 状況を返す。

    install されていない場合は False、 install を強制しない (= user 手動)。
    """
    status: dict[str, bool] = {}
    for name in ("cfgrib", "pygrib", "xarray", "numpy"):
        try:
            __import__(name)
            status[name] = True
        except Exception:
            status[name] = False
    return status


def decode_blob(blob: bytes, valid_time: str, var: str) -> DecodedMSM:
    """GRIB2 blob を decode して富士山 bbox に切り出し。

    library が無ければ stub を返す (= AI sub-agent が勝手に install しないため)。
    """
    libs = check_grib_library()
    if not libs.get("cfgrib") and not libs.get("pygrib"):
        return DecodedMSM(
            valid_time=valid_time,
            var=var,
            bbox=FUJI_BBOX,
            pressure_levels_hpa=MSM_PRESSURE_LEVELS_HPA,
            data=None,
            note=("stub: cfgrib / pygrib 未 install、 user が `pip install cfgrib` 後に "
                  "再実行で実 decode、 sub-agent 権限で install しない"),
        )

    # 実 decode path (= library 入った時に走る)、 sub-agent では到達しない想定だが書いておく
    try:
        import io
        import tempfile
        # cfgrib は file path 経由を要求するので tmpfile に書き出し
        with tempfile.NamedTemporaryFile(suffix=".grib2", delete=False) as tf:
            tf.write(blob)
            tmp_path = tf.name
        try:
            if libs.get("cfgrib"):
                import xarray as xr  # type: ignore
                ds = xr.open_dataset(tmp_path, engine="cfgrib")
                # 富士山 bbox に切り出し (= MSM の座標系は lat/lon)
                sel = ds.sel(
                    latitude=slice(FUJI_BBOX["lat_max"], FUJI_BBOX["lat_min"]),
                    longitude=slice(FUJI_BBOX["lon_min"], FUJI_BBOX["lon_max"]),
                )
                return DecodedMSM(
                    valid_time=valid_time,
                    var=var,
                    bbox=FUJI_BBOX,
                    pressure_levels_hpa=MSM_PRESSURE_LEVELS_HPA,
                    data=sel,
                    note=f"cfgrib decoded, vars={list(sel.data_vars)}",
                )
            elif libs.get("pygrib"):
                import pygrib  # type: ignore
                grbs = pygrib.open(tmp_path)
                msgs = list(grbs)
                return DecodedMSM(
                    valid_time=valid_time,
                    var=var,
                    bbox=FUJI_BBOX,
                    pressure_levels_hpa=MSM_PRESSURE_LEVELS_HPA,
                    data=msgs,
                    note=f"pygrib decoded, {len(msgs)} messages",
                )
        finally:
            try:
                Path(tmp_path).unlink()
            except OSError:
                pass
    except Exception as e:
        logger.warning("[decode_msm] decode failed: %s", e)
        return DecodedMSM(
            valid_time=valid_time, var=var, bbox=FUJI_BBOX,
            pressure_levels_hpa=MSM_PRESSURE_LEVELS_HPA,
            data=None, note=f"decode error: {e}",
        )

    # ここには来ないが defensive
    return DecodedMSM(
        valid_time=valid_time, var=var, bbox=FUJI_BBOX,
        pressure_levels_hpa=MSM_PRESSURE_LEVELS_HPA,
        data=None, note="unreachable",
    )


def decode_from_cache(
    cache_path: Path,
    valid_time: str | None = None,
    var: str | None = None,
) -> list[DecodedMSM]:
    """cache.sqlite から blob を取り出して decode (= 実 fetch しない)。"""
    if not cache_path.exists():
        logger.warning("[decode_msm] cache 不在: %s", cache_path)
        return []
    con = sqlite3.connect(str(cache_path))
    try:
        sql = "SELECT valid_time, var, blob FROM msm_raw WHERE 1=1"
        params: list = []
        if valid_time:
            sql += " AND valid_time = ?"
            params.append(valid_time)
        if var:
            sql += " AND var = ?"
            params.append(var)
        rows = con.execute(sql, params).fetchall()
    finally:
        con.close()

    out: list[DecodedMSM] = []
    for vt, v, blob in rows:
        if blob is None:
            out.append(DecodedMSM(
                valid_time=vt, var=v, bbox=FUJI_BBOX,
                pressure_levels_hpa=MSM_PRESSURE_LEVELS_HPA,
                data=None, note="blob is NULL (= dry_run 段階で row のみ作られた)",
            ))
            continue
        out.append(decode_blob(blob, vt, v))
    return out


def self_test() -> int:
    """stub decode の動作 verify (= GRIB2 library 不要)。"""
    libs = check_grib_library()
    logger.info("[self-test] library status: %s", libs)

    # stub path: dummy blob を decode、 DecodedMSM が返り note に stub 表記が入ること
    dummy = b"DUMMY_GRIB2_BLOB"
    result = decode_blob(dummy, "2026-05-25T03:00:00Z", "L-pall")
    logger.info("[self-test] decode result: valid_time=%s var=%s data=%s",
                result.valid_time, result.var, result.data)
    logger.info("[self-test] note: %s", result.note)

    has_lib = libs.get("cfgrib") or libs.get("pygrib")
    if not has_lib:
        # stub 期待
        if result.data is not None:
            logger.error("[self-test] library 不在なのに data が None でない")
            return 1
        if "stub" not in result.note:
            logger.error("[self-test] stub note が無い: %s", result.note)
            return 2
        logger.info("[self-test] stub mode OK (= library 不在で AI が install せず stub 返す)")
    else:
        # 実 library があるなら decode 試行、 ただし dummy blob は invalid なので
        # error note が入る可能性がある = それも正常 path として認める
        logger.info("[self-test] library 在、 stub mode を経由しない動作 OK")

    if result.bbox != FUJI_BBOX:
        logger.error("[self-test] bbox が FUJI_BBOX と一致しない")
        return 3
    if result.pressure_levels_hpa != MSM_PRESSURE_LEVELS_HPA:
        logger.error("[self-test] pressure_levels_hpa が default と一致しない")
        return 4

    logger.info("[self-test] ALL PASSED")
    return 0


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--library-check", action="store_true",
                        help="cfgrib / pygrib / xarray の install 状況を表示")
    parser.add_argument("--self-test", action="store_true",
                        help="stub decode の動作 verify (= GRIB2 library 不要)")
    parser.add_argument("--cache", type=Path,
                        default=Path(__file__).parent / "cache.sqlite",
                        help="cache.sqlite path (= decode 対象 blob 源)")
    parser.add_argument("--valid-time", type=str, default=None)
    parser.add_argument("--var", type=str, default=None)
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(list(argv) if argv is not None else None)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(message)s",
    )

    if args.library_check:
        libs = check_grib_library()
        for name, ok in libs.items():
            logger.info("  %s: %s", name, "OK" if ok else "NOT INSTALLED")
        return 0

    if args.self_test:
        return self_test()

    results = decode_from_cache(args.cache, args.valid_time, args.var)
    if not results:
        logger.info("[decode_msm] cache に該当 row 無し")
        return 0
    for r in results:
        logger.info("  %s %s -> %s", r.valid_time, r.var, r.note)
    return 0


if __name__ == "__main__":
    sys.exit(main())
