"""Arabas 2015 を強上昇流 (= rhod_w_max=2.0) で再走、 cumulus 寄り設定。

Arabas 2015 標準 setting (= rhod_w_max=0.6) は層積雲 (stratocumulus)、 結果は
「水平 slab」 だが、 rhod_w_max を 3.3 倍に上げて鉛直流速を強める → より垂直性の
強い雲 (= cumulus に近い) を狙う。 stream_function 自体は同じ 2 渦解析だが流速が
大きくなる、 結果として上昇気流コアでの凝結量増 + 下降気流で雲水流れ出し が顕著に。
"""
import time
from pathlib import Path

from PySDM_examples.Arabas_et_al_2015 import Settings, SpinUp
from PySDM_examples.utils.kinematic_2d import Simulation, Storage

from PySDM import Formulae
from PySDM.physics import si


def main():
    out_dir = Path(__file__).parent / "output"
    out_dir.mkdir(exist_ok=True)
    storage_dir = out_dir / "phase1_arabas_cumulus_storage"
    storage_dir.mkdir(exist_ok=True)

    # rhod_w_max を 0.6 → 2.0 に強化、 強い上昇流 = 積雲寄り
    settings = Settings(Formulae(), rhod_w_max=2.0 * si.metres / si.seconds * (si.kilogram / si.metre**3))
    settings.n_sd_per_gridbox = 25
    settings.grid = (25, 25)
    settings.simulation_time = 5400 * si.second

    n_sd = settings.n_sd_per_gridbox * settings.grid[0] * settings.grid[1]
    print(f"=== Arabas 2015 強上昇流 (rhod_w_max=2.0) 試走 ===")
    print(f"grid    : {settings.grid}  ({settings.grid[0] * settings.grid[1]} cells)")
    print(f"size    : {settings.size}")
    print(f"n_sd    : {n_sd} super droplets ({settings.n_sd_per_gridbox} sd/cell)")
    print(f"dt      : {settings.dt}s")
    print(f"sim_time: {settings.simulation_time}s ({settings.simulation_time/60:.0f} min)")
    print(f"storage : {storage_dir}")
    print(flush=True)

    for f in storage_dir.glob("*.npy"):
        f.unlink()

    storage = Storage(path=str(storage_dir))
    simulation = Simulation(settings, storage, SpinUp)

    t0 = time.time()
    simulation.reinit()
    t_init = time.time() - t0
    print(f"reinit: {t_init:.2f}s", flush=True)

    t1 = time.time()
    simulation.run()
    t_run = time.time() - t1

    total = t_init + t_run
    print(f"\n=== 完了 ===")
    print(f"run wall: {t_run:.2f}s")
    print(f"total   : {total:.2f}s  (sim_time/wall = {settings.simulation_time / total:.2f}x realtime)")

    npy_files = sorted(storage_dir.glob("*.npy"))
    print(f"npy files: {len(npy_files)}")
    if npy_files:
        import numpy as np
        ql_files = sorted(storage_dir.glob("cloud water mixing ratio_*.npy"))
        if ql_files:
            stack = np.stack([np.load(p) for p in ql_files])
            print(f"ql shape: {stack.shape}")
            print(f"ql max  : {stack.max()*1e3:.4f} g/kg (stratocumulus 比較: 1.17 g/kg)")
            print(f"ql mean : {stack.mean()*1e3:.4f} g/kg")


if __name__ == "__main__":
    main()
