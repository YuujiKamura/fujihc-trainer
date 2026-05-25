"""field_moist_3d_snapshots.npz を読み、 matplotlib 3D scatter で multicell 雲塊を 3 視点 PNG 出力。

iso (= 俯瞰、 default 視点) / top (= 真上、 y 軸方向の雲分布) / side (= 真横、 雲層高度)
の 3 視点で q_l > 0.1 g/kg の cell を 3D 散布、 富士山 2D terrain を black wireframe で重ね、
雲底高度 + 多層構造を画面で確認。

brief: ~/.agents/scratch/fujihc-trainer-project/b107-3d-multicell-cumulus.md
"""
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


VIEWS = {
    "iso": (30, -60),
    "top": (89, -90),
    "side": (10, 0),
}


def main():
    here = Path(__file__).parent
    in_path = here / "output" / "field_moist_3d_snapshots.npz"
    if not in_path.exists():
        raise SystemExit(f"snapshots 無し: {in_path}")
    data = np.load(in_path)

    n_snap = len(data["steps"])
    last_idx = n_snap - 1
    q_l = data[f"q_l_{last_idx:03d}"]  # (nx, ny, nz)
    terrain_2d = data["terrain_2d"]
    dx = float(data["dx"][0])
    dy = float(data["dy"][0])
    dz = float(data["dz"][0])

    nx, ny, nz = q_l.shape
    print(f"snapshot {last_idx}: q_l shape={q_l.shape}, q_l max={q_l.max()*1e3:.3f} g/kg")

    threshold = 0.1e-3  # 0.1 g/kg
    cloud_mask = q_l > threshold
    cloud_idx = np.argwhere(cloud_mask)
    print(f"cloud cell (q_l > 0.1 g/kg): {len(cloud_idx)} / {q_l.size}")
    if len(cloud_idx) == 0:
        print("WARNING: 雲 cell ゼロ、 sim が凝結トリガーしてない可能性")

    cloud_x_km = cloud_idx[:, 0] * dx / 1000.0
    cloud_y_km = cloud_idx[:, 1] * dy / 1000.0
    cloud_z_km = cloud_idx[:, 2] * dz / 1000.0
    cloud_q_l = q_l[cloud_idx[:, 0], cloud_idx[:, 1], cloud_idx[:, 2]] * 1e3

    # terrain mesh for wireframe overlay
    x_mesh, y_mesh = np.meshgrid(
        np.arange(nx) * dx / 1000.0, np.arange(ny) * dy / 1000.0, indexing="ij"
    )
    terrain_km = terrain_2d / 1000.0

    for view_name, (elev, azim) in VIEWS.items():
        fig = plt.figure(figsize=(10, 8))
        ax = fig.add_subplot(111, projection="3d")

        if len(cloud_idx) > 0:
            scatter = ax.scatter(
                cloud_x_km, cloud_y_km, cloud_z_km,
                c=cloud_q_l, cmap="Blues", alpha=0.5, s=20,
                vmin=0.0, vmax=max(cloud_q_l.max(), 1.0),
            )
            cbar = fig.colorbar(scatter, ax=ax, shrink=0.6, pad=0.1)
            cbar.set_label("q_l [g/kg]")

        ax.plot_wireframe(
            x_mesh, y_mesh, terrain_km,
            color="black", linewidth=0.3, alpha=0.5, rstride=5, cstride=5,
        )

        ax.set_xlabel("x [km]")
        ax.set_ylabel("y [km]")
        ax.set_zlabel("z [km]")
        ax.set_xlim(0, nx * dx / 1000.0)
        ax.set_ylim(0, ny * dy / 1000.0)
        ax.set_zlim(0, nz * dz / 1000.0)
        ax.view_init(elev=elev, azim=azim)
        ax.set_title(
            f"Field3D moist (step {last_idx}): {view_name} view\n"
            f"q_l > 0.1 g/kg = {len(cloud_idx)} cell, max = {q_l.max()*1e3:.2f} g/kg"
        )

        out_png = here / "output" / f"field_moist_3d_{view_name}.png"
        fig.savefig(out_png, dpi=110, bbox_inches="tight")
        plt.close(fig)
        print(f"  {view_name:6s} -> {out_png.name}")


if __name__ == "__main__":
    main()
