"""Phase 0: PySDM hello world ── 1-D rising parcel example。

気塊 (= parcel) が一定速度 w で上昇すると、 断熱膨張で温度が下がり、 水蒸気の飽和水蒸気圧
を超えた瞬間に凝結が起きて雲水 (= ql) が増える。 これは雲形成の基本物理、 「上昇気流が
あれば雲ができる」 の最小実装。

PySDM の Super-Droplet Method で「個々の super droplet が凝結で半径が増える」 のを物理的に
解いており、 noise や fake は一切ない。 出力 (= output/phase0_parcel_lwc.npy) は液水質量比
(kg/kg) の時系列、 上昇 5 分で 0 から 数 g/kg に増えるはず。

参考: Arabas et al. 2015 「PySDM v1: particle-based cloud microphysics」 GMD、
PySDM-examples の "Arabas_and_Shima_2017" や "Pyrcel" 系の parcel example。
"""

from pathlib import Path
import numpy as np

from PySDM.physics import si
from PySDM.environments import Parcel
from PySDM.dynamics import AmbientThermodynamics, Condensation
from PySDM.builder import Builder
from PySDM.backends import CPU
from PySDM.products import WaterMixingRatio, ParcelDisplacement
from PySDM.initialisation.sampling.spectral_sampling import ConstantMultiplicity
from PySDM.initialisation.spectra import Lognormal


def run_parcel():
    # parcel 環境 ── 海面気圧 1000 hPa、 温度 300 K、 水蒸気混合比 0.02 (= 比較的湿った夏)、
    # 上昇速度 1 m/s で 360 秒 (= 6 分) シミュ、 6 分で 360 m 上昇する想定。
    env = Parcel(
        dt=1 * si.s,
        mass_of_dry_air=1e3 * si.kg,
        p0=1000 * si.hPa,
        initial_water_vapour_mixing_ratio=0.02,
        T0=300 * si.K,
        w=1 * si.m / si.s,
    )

    # super droplet 数 = 64 (= hello world、 物理が動く最小)
    n_sd = 64

    # 粒径分布 (= 凝結核 CCN の分布、 lognormal): norm_factor = 単位体積あたりの粒子数、
    # m_mode = 中心半径、 s_geom = 幅。 海洋エアロゾル典型値。
    spectrum = Lognormal(
        norm_factor=100 / si.cm**3,
        m_mode=0.04 * si.um,
        s_geom=1.5,
    )

    builder = Builder(n_sd=n_sd, backend=CPU(), environment=env)
    builder.add_dynamic(AmbientThermodynamics())
    builder.add_dynamic(Condensation())

    # super droplet を spectrum に従って sample
    r_dry, multiplicity = ConstantMultiplicity(spectrum).sample(n_sd)
    attributes = {
        "dry volume": builder.formulae.trivia.volume(radius=r_dry),
        "kappa times dry volume": 0.5 * builder.formulae.trivia.volume(radius=r_dry),
        "multiplicity": multiplicity,
        # 初期 wet radius = dry radius (= 凝結前)
        "volume": builder.formulae.trivia.volume(radius=r_dry),
    }

    particulator = builder.build(
        attributes,
        products=[
            WaterMixingRatio(
                name="ql",
                radius_range=(1 * si.um, 100 * si.um),
            ),
            ParcelDisplacement(name="z"),
        ],
    )

    # 6 分間 (= 360 step) 走らせて ql 時系列を取る
    lwc_series = []
    z_series = []
    for step in range(360):
        particulator.run(steps=1)
        ql = float(particulator.products["ql"].get()[0])  # kg/kg (= parcel 1 cell の値)
        z = float(particulator.products["z"].get()[0])  # m
        lwc_series.append(ql)
        z_series.append(z)
        if step % 30 == 0:
            print(f"step {step:3d}  z={z:6.1f} m  ql={ql*1e3:8.4f} g/kg")

    return np.array(lwc_series), np.array(z_series)


def main():
    out_dir = Path(__file__).parent / "output"
    out_dir.mkdir(exist_ok=True)

    print("=== PySDM 1-D rising parcel hello world ===")
    print("水蒸気混合比 0.02 / T0 300K / p0 1000hPa / w 1m/s / 360s")
    print()

    lwc, z = run_parcel()

    out_path = out_dir / "phase0_parcel_lwc.npy"
    np.save(out_path, np.stack([z, lwc]))
    print(f"\n=== 完了 ===")
    print(f"出力: {out_path}")
    print(f"  shape: {np.stack([z, lwc]).shape}  (= [z, lwc] × 360 step)")
    print(f"  最終 z = {z[-1]:.1f} m,  最終 ql = {lwc[-1]*1e3:.4f} g/kg")
    print(f"  最大 ql = {lwc.max()*1e3:.4f} g/kg  (= 凝結ピーク)")

    # 物理的 sanity: 上昇すれば ql は単調増加 (= 凝結のみ、 蒸発なし) のはず
    if lwc[-1] > lwc[0]:
        print(f"  物理 OK: ql が時間で増えてる (= 凝結が動いてる証)")
    else:
        print(f"  物理 NG: ql が増えてない、 PySDM 設定の問題")


if __name__ == "__main__":
    main()
