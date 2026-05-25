"""Phase 0 結果の可視化: phase0_parcel_lwc.npy から PNG 描画。

時間軸 (= 0..360 sec) で高度 z (= 上昇量) と雲水 ql の 2 段グラフ。 LCL (= 持ち上げ凝結
高度、 ql が 0 を抜ける瞬間) が一目で分かる、 物理ベース雲シミュの最小可視化。
"""

from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use("Agg")  # headless
import matplotlib.pyplot as plt


def main():
    out_dir = Path(__file__).parent / "output"
    data = np.load(out_dir / "phase0_parcel_lwc.npy")
    z, lwc = data[0], data[1]  # (z[m], ql[kg/kg])
    t = np.arange(len(z))  # 1 sec / step

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(8, 6), sharex=True)
    ax1.plot(t, z, color="tab:blue")
    ax1.set_ylabel("altitude z [m]")
    ax1.set_title("Phase 0: PySDM 1-D rising parcel (physics-based cloud formation, no noise)")
    ax1.grid(alpha=0.3)

    ax2.plot(t, lwc * 1e3, color="tab:orange")
    ax2.set_ylabel("cloud water ql [g/kg]")
    ax2.set_xlabel("time t [sec]")
    ax2.grid(alpha=0.3)

    # LCL marker (= ql が初めて 0 を抜けた step)
    lcl_idx = np.argmax(lwc > 1e-9)
    if lcl_idx > 0:
        for ax in (ax1, ax2):
            ax.axvline(lcl_idx, color="red", linestyle="--", alpha=0.6, label=f"LCL t={lcl_idx}s z={z[lcl_idx]:.0f}m")
            ax.legend(loc="upper left")

    fig.tight_layout()
    out_png = out_dir / "phase0_parcel_lwc.png"
    fig.savefig(out_png, dpi=120)
    print(f"保存: {out_png}")
    print(f"LCL = t={lcl_idx}s / z={z[lcl_idx]:.0f}m  (= 凝結開始点、 持ち上げ凝結高度)")
    print(f"最終 ql = {lwc[-1]*1e3:.4f} g/kg  (= 雲水質量の積算)")


if __name__ == "__main__":
    main()
