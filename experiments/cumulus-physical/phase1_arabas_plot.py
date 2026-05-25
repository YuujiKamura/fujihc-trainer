"""Phase 1 可視化: Arabas 2015 storage の 2D 雲水場を時系列で並べる。

phase1_arabas2015.py が吐く storage (= output/phase1_arabas_storage/*.npy) から、
"cloud water mixing ratio" (= ql、 雲水質量比) と "effective radius" (= 雲粒半径) を
代表 step で取り出し、 2D heatmap で並べた PNG を生成する。 user 目視用の最初の
雲場、 ノイズではなく PySDM 微物理計算の素出力。
"""
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


PRODUCT_LABELS = {
    "cloud water mixing ratio": ("ql", "g/kg", 1e3, "Blues"),
    "effective radius": ("r_eff", "um", 1.0, "viridis"),
    "RH_env": ("RH", "%", 100.0, "RdBu_r"),
    "rain water mixing ratio": ("qr", "g/kg", 1e3, "Greens"),
}


def collect_steps(storage_dir: Path, product: str) -> list[tuple[int, Path]]:
    prefix = f"{product}_"
    out = []
    for f in storage_dir.glob(f"{prefix}*.npy"):
        step_str = f.stem[len(prefix):]
        if step_str.isdigit():
            out.append((int(step_str), f))
    return sorted(out)


def pick_representative(steps: list[tuple[int, Path]], n: int = 6) -> list[tuple[int, Path]]:
    if len(steps) <= n:
        return steps
    idx = np.linspace(0, len(steps) - 1, n).round().astype(int)
    return [steps[i] for i in idx]


def plot_product(storage_dir: Path, product: str, out_png: Path, dt: float):
    steps = collect_steps(storage_dir, product)
    if not steps:
        print(f"  skip {product}: no data")
        return
    short, unit, scale, cmap = PRODUCT_LABELS.get(product, (product, "", 1.0, "viridis"))
    repr_steps = pick_representative(steps, 6)

    fig, axes = plt.subplots(1, len(repr_steps), figsize=(3 * len(repr_steps), 3), sharey=True)
    if len(repr_steps) == 1:
        axes = [axes]

    vmax = max(np.nanmax(np.load(p)) for _, p in repr_steps) * scale
    if vmax <= 0:
        vmax = 1.0

    for ax, (step, npy_path) in zip(axes, repr_steps):
        arr = np.load(npy_path) * scale
        im = ax.imshow(arr.T, origin="lower", cmap=cmap, vmin=0, vmax=vmax, aspect="auto")
        ax.set_title(f"t={step*dt:.0f}s")
        ax.set_xlabel("x grid")
    axes[0].set_ylabel("z grid")

    cbar = fig.colorbar(im, ax=axes, shrink=0.8, pad=0.02)
    cbar.set_label(f"{short} [{unit}]")
    fig.suptitle(f"Arabas 2015 2D Kinematic: {product}  (PySDM SDM, physics-based)")
    fig.savefig(out_png, dpi=110, bbox_inches="tight")
    plt.close(fig)
    print(f"  {product:35s} -> {out_png.name}  (steps={len(steps)}, vmax={vmax:.3g} {unit})")


def main():
    storage_dir = Path(__file__).parent / "output" / "phase1_arabas_storage"
    out_dir = Path(__file__).parent / "output"
    if not storage_dir.exists():
        print(f"storage 無し: {storage_dir}")
        return

    npy_count = len(list(storage_dir.glob("*.npy")))
    print(f"storage : {storage_dir}  ({npy_count} npy files)")

    dt = 60.0  # Arabas 2015 default = steps_per_output_interval × dt_simulation; 安全側 60s
    for product in PRODUCT_LABELS:
        out_png = out_dir / f"phase1_arabas_{product.replace(' ', '_').replace('/', '_')}.png"
        plot_product(storage_dir, product, out_png, dt)


if __name__ == "__main__":
    main()
