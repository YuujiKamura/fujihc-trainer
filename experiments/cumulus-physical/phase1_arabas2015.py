"""Phase 1 試走: PySDM Arabas et al. 2015 の 2D Kinematic 2D 層積雲 example。

ローカル PC の計算量限界を測る最初の踏み石、 25×25 grid (= 60m 解像度) × 15,625 sd、
90 分シミュ。 例題そのまま、 wall time 計測と固定パス出力だけ追加。 ノイズ路線ではなく
物理本道で「どこまで回せるか」 の実限界を露出するための走行。
"""
import sys
import time
from pathlib import Path

from PySDM_examples.Arabas_et_al_2015 import Settings, SpinUp
from PySDM_examples.utils.kinematic_2d import Simulation, Storage

from PySDM import Formulae
from PySDM.physics import si


def main():
    out_dir = Path(__file__).parent / "output"
    out_dir.mkdir(exist_ok=True)
    storage_dir = out_dir / "phase1_arabas_storage"
    storage_dir.mkdir(exist_ok=True)

    settings = Settings(Formulae())
    settings.n_sd_per_gridbox = 25
    settings.grid = (25, 25)
    settings.simulation_time = 5400 * si.second  # 90 分

    n_sd = settings.n_sd_per_gridbox * settings.grid[0] * settings.grid[1]
    print(f"=== Arabas 2015 2D Kinematic 試走 ===")
    print(f"grid    : {settings.grid}  ({settings.grid[0] * settings.grid[1]} cells)")
    print(f"size    : {settings.size}")
    print(f"n_sd    : {n_sd} super droplets ({settings.n_sd_per_gridbox} sd/cell)")
    print(f"dt      : {settings.dt}s")
    print(f"sim_time: {settings.simulation_time}s ({settings.simulation_time/60:.0f} min)")
    print(f"storage : {storage_dir}")
    print(flush=True)

    # 既存 step npy を消す (= 前回 run の残骸が混ざらないように)
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

    # storage に何が出来たか list
    npy_files = sorted(storage_dir.glob("*.npy"))
    print(f"npy files: {len(npy_files)}")
    if npy_files:
        # 最初の数件と全 product 名 (= prefix)
        prefixes = sorted(set(f.stem.rsplit("_", 1)[0] for f in npy_files if "_" in f.stem))
        print(f"products : {prefixes}")
        sample = npy_files[len(npy_files) // 2]
        import numpy as np
        arr = np.load(sample)
        print(f"sample   : {sample.name}  shape={arr.shape}  dtype={arr.dtype}")


if __name__ == "__main__":
    main()
