"""Phase 3 viewer 用 voxel export: PySDM 計算結果 (= ql / 粒子数 / 雲粒半径) を
全時間 step で voxel として書き出す。

user 訂正 (= 2026-05-25 「表面の表現はこれでいいんで、 裏側をキッチリ作れ」、
+ 「裏側に流体シミュの粒子があるのを VOB で表現するようにしろ」):
「らしさ」 を shader で fake せず、 SDM の super droplet (= 粒子) を voxel として
素直に出す。 viewer 側はそれを線形 sampling して表示するだけ。

export 内容:
- ql                = 雲水質量比 (g/kg)、 雲水の存在を見せる
- n_c_cm3           = 雲粒数密度 (1/cm^3)、 super droplet が凝結した結果の粒子分布
- effective_radius  = 雲粒の代表半径 (um)、 雲粒のサイズ
- super_dropletcount = cell あたりの super droplet 数、 粒子追跡の生密度

全 91 step、 3 product × 91 × 25 × 25 float32 = 約 2.2 MB / dataset (= ql のみ binary、
他は補助 stats のみ JSON)。 主体 = ql の時間 voxel binary、 viewer から fetch + 時間軸再生。
"""
import argparse
import json
import struct
from pathlib import Path
import numpy as np


PRODUCTS = {
    "ql": ("cloud water mixing ratio", "g/kg", 1e3),
    "n_c_cm3": ("n_c_cm3", "1/cm^3", 1.0),
    "effective_radius": ("effective radius", "um", 1.0),
    "super_droplet_count": ("super droplet count per gridbox", "count", 1.0),
}


def export_dataset(storage_dir: Path, out_dir: Path, label: str):
    """1 dataset (= storage_dir) を product 全種類 × 全 step で binary 化。"""
    meta = {"label": label, "products": {}, "steps": []}

    # 主体 product = ql の全 step を binary に
    for short, (raw_name, unit, scale) in PRODUCTS.items():
        files = sorted(storage_dir.glob(f"{raw_name}_*.npy"))
        if not files:
            print(f"  [{label}] {short:25s}: 無し (skip)")
            continue

        # 全 step を 3D float32 binary に (= n_step × 25 × 25 行優先)
        stack = np.stack([np.load(p).astype(np.float32) * scale for p in files])
        n_step, nx, nz = stack.shape

        bin_path = out_dir / f"{label}_{short}.bin"
        stack.tofile(bin_path)

        # NaN を 0 に置換 (= JSON で stat 出すため)
        clean = np.nan_to_num(stack, nan=0.0)
        meta["products"][short] = {
            "unit": unit,
            "n_step": int(n_step),
            "grid": [int(nx), int(nz)],
            "min": round(float(clean.min()), 6),
            "max": round(float(clean.max()), 6),
            "mean": round(float(clean.mean()), 6),
            "bin_size_kb": round(bin_path.stat().st_size / 1024, 1),
            "bin_file": bin_path.name,
        }
        print(f"  [{label}] {short:25s}: {n_step} step × {nx}×{nz} float32"
              f"  -> {bin_path.name} ({bin_path.stat().st_size/1024:.1f} KB)"
              f"  min={clean.min():.4g} max={clean.max():.4g} mean={clean.mean():.4g} {unit}")

        if short == "ql":
            meta["steps"] = list(range(n_step))

    return meta


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", default=None, help="viewer 出力ディレクトリ (= default viewer/)")
    args = parser.parse_args()

    here = Path(__file__).parent
    out_dir = Path(args.out_dir) if args.out_dir else (here / "viewer")
    out_dir.mkdir(exist_ok=True)

    # 2 dataset (= stratocumulus / cumulus) 両方処理
    datasets = [
        ("stratocumulus", here / "output" / "phase1_arabas_storage"),
        ("cumulus",       here / "output" / "phase1_arabas_cumulus_storage"),
    ]

    catalog = {"datasets": {}}
    for label, storage_dir in datasets:
        if not storage_dir.exists():
            print(f"skip {label}: storage 無し ({storage_dir})")
            continue
        print(f"\n=== {label} export ===  ({storage_dir})")
        meta = export_dataset(storage_dir, out_dir, label)
        catalog["datasets"][label] = meta

    catalog_path = out_dir / "catalog.json"
    with open(catalog_path, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2)
    print(f"\ncatalog: {catalog_path}  ({catalog_path.stat().st_size/1024:.1f} KB)")
    for label, meta in catalog["datasets"].items():
        prods = list(meta["products"].keys())
        print(f"  {label}: {len(prods)} products, {meta['products'].get('ql', {}).get('n_step', 0)} steps")


if __name__ == "__main__":
    main()
