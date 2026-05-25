"""field_2d 結果 (= snapshots.npz) を可視化、 6 時点の q_l と w を 2D heatmap で並べる。

雲水 q_l = 凝結状態の空気、 鉛直風 w = 上昇 / 下降の場、 user 概念モデル「空気が動いて
雲という凝結状態になる」 が時系列で見えるか目視批評する。
"""
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def main():
    here = Path(__file__).parent
    in_path = here / "output" / "field_2d_snapshots.npz"
    if not in_path.exists():
        raise SystemExit(f"npz 無し: {in_path}")
    data = np.load(in_path)

    steps = data["steps"]
    sim_times = data["sim_times"]
    dx = float(data["dx"][0])
    dz = float(data["dz"][0])
    theta_env = data["theta_env"]
    n_snap = len(steps)
    print(f"snapshots: {n_snap}, dx={dx}m dz={dz}m")

    # 6 時点 (= 開始 / 20 / 40 / 60 / 80 / 100%)
    if n_snap < 2:
        print("snapshot 不足")
        return
    idx = np.linspace(0, n_snap - 1, 6).round().astype(int)
    print(f"selected snap idx: {idx}")

    # q_l と w を 2D heatmap
    for var, scale, unit, cmap, vmin, vmax in (
        ("q_l", 1e3, "g/kg", "Blues", 0.0, None),
        ("w", 1.0, "m/s", "RdBu_r", None, None),
        ("theta", 1.0, "K", "viridis", None, None),
    ):
        fig, axes = plt.subplots(1, 6, figsize=(18, 3.5), sharey=True)
        arrs = [np.load(in_path)[f"{var}_{i:03d}"] * scale for i in idx]
        if var == "theta":
            # theta は theta_env を引いて偏差で見せる
            arrs = [a - theta_env[np.newaxis, :] * scale for a in arrs]
            unit = "K (anomaly)"
            cmap = "RdBu_r"
        gmax = max(np.nanmax(np.abs(a)) for a in arrs)
        gmax = max(gmax, 1e-6)
        if vmax is None:
            vmax = gmax
        if vmin is None:
            vmin = -gmax

        for ax, i, arr in zip(axes, idx, arrs):
            im = ax.imshow(arr.T, origin="lower", cmap=cmap, vmin=vmin, vmax=vmax,
                           aspect="auto",
                           extent=[0, arr.shape[0] * dx / 1000, 0, arr.shape[1] * dz / 1000])
            ax.set_title(f"t={sim_times[i]:.0f}s")
            ax.set_xlabel("x [km]")
        axes[0].set_ylabel("z [km]")
        cbar = fig.colorbar(im, ax=axes, shrink=0.8, pad=0.02)
        cbar.set_label(f"{var} [{unit}]")
        fig.suptitle(f"Field2D warm bubble: {var} (Eulerian, no projection)")
        out_png = here / "output" / f"field_2d_{var}.png"
        fig.savefig(out_png, dpi=110, bbox_inches="tight")
        plt.close(fig)
        print(f"  {var:5s} -> {out_png.name}  range=[{arrs[0].min():.3g}, max @ final={arrs[-1].max():.3g}]")


if __name__ == "__main__":
    main()
