"""field_terrain_snapshots.npz から、 富士山地形 overlay 付き 2D 2段プロット出力。

上段 = 鉛直風 w (= 山岳波 / 上昇下降 dipole が見える)
下段 = 温位偏差 θ' (= 山岳 lift 起源の偏差)
両方に富士山地形断面を黒線で重ねる、 「ここに山がある」 が一目で分かる
"""
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def main():
    here = Path(__file__).parent
    in_path = here / "output" / "field_terrain_snapshots.npz"
    data = np.load(in_path)

    steps = data["steps"]
    sim_times = data["sim_times"]
    dx = float(data["dx"][0])
    dz = float(data["dz"][0])
    theta_env = data["theta_env"]
    terrain_h = data["terrain_h"]
    n_snap = len(steps)
    print(f"snapshots: {n_snap}, dx={dx}m dz={dz}m, terrain max={terrain_h.max():.0f}m")

    idx = np.linspace(0, n_snap - 1, 6).round().astype(int)
    x_km = np.arange(len(terrain_h)) * dx / 1000

    for var, scale, unit, cmap, vmax_explicit in (
        ("w", 1.0, "m/s", "RdBu_r", None),
        ("theta_prime", 1.0, "K (anomaly)", "RdBu_r", None),
        ("q_l", 1e3, "g/kg", "Blues", None),
    ):
        fig, axes = plt.subplots(1, 6, figsize=(18, 3.5), sharey=True)
        if var == "theta_prime":
            arrs = [(data[f"theta_{i:03d}"] - theta_env[np.newaxis, :]) * scale for i in idx]
        else:
            keymap = {"w": "w", "q_l": "q_l"}
            arrs = [data[f"{keymap[var]}_{i:03d}"] * scale for i in idx]
        gmax = max(np.nanmax(np.abs(a)) for a in arrs)
        gmax = max(gmax, 1e-6)
        if vmax_explicit is None:
            vmax = gmax
        else:
            vmax = vmax_explicit
        vmin = -vmax if var != "q_l" else 0

        for ax, i, arr in zip(axes, idx, arrs):
            im = ax.imshow(arr.T, origin="lower", cmap=cmap, vmin=vmin, vmax=vmax,
                           aspect="auto",
                           extent=[0, arr.shape[0] * dx / 1000, 0, arr.shape[1] * dz / 1000])
            # 富士山地形を黒線で重ねる
            ax.plot(x_km, terrain_h / 1000, "k-", linewidth=2, alpha=0.9)
            ax.fill_between(x_km, 0, terrain_h / 1000, color="black", alpha=0.4)
            ax.set_title(f"t={sim_times[i]:.0f}s")
            ax.set_xlabel("x [km]")
            ax.set_ylim(0, arr.shape[1] * dz / 1000)
        axes[0].set_ylabel("z [km]")
        cbar = fig.colorbar(im, ax=axes, shrink=0.8, pad=0.02)
        cbar.set_label(f"{var} [{unit}]")
        fig.suptitle(f"Field2D + Fuji terrain + west wind 5m/s: {var}")
        out_png = here / "output" / f"field_terrain_{var}.png"
        fig.savefig(out_png, dpi=110, bbox_inches="tight")
        plt.close(fig)
        print(f"  {var:12s} -> {out_png.name}  range=[{vmin:+.2g}, {vmax:+.2g}] {unit}")


if __name__ == "__main__":
    main()
