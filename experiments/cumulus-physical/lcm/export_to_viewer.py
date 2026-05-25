"""field_2d_snapshots.npz を viewer 入力 binary に変換、 25×25 にダウンサンプル。

既存 viewer は uniform float 配列 625 個 (= 25×25) を 1 grid として描画。 field_2d は
100×150 で uniform 配列 limit を超えるため、 area-weighted average で 25×25 に
ダウンサンプル + viewer/ 配下 binary に書き出し + catalog.json に field_2d dataset を
追加する。

これで viewer の dataset selector で field_2d を選ぶと、 補償下降流 dipole + gravity
wave fan + warm bubble が画面に出る、 user 「ぜんぜんかわってない」 への直接応答。
"""
from __future__ import annotations
import json
from pathlib import Path

import numpy as np


def coarsen_to_25(arr_2d: np.ndarray) -> np.ndarray:
    """100×150 → 25×25 area-weighted average + 鉛直 z=15-150 を 25 等分 (cumulus 高度に絞る)"""
    nx, nz = arr_2d.shape  # (100, 150)
    # x: 100 → 25 (= 4 cell 平均)
    x_coarse = arr_2d.reshape(25, 4, nz).mean(axis=1)
    # z: 150 → 25 (= 6 cell 平均、 全高度の z=0-15km を 25 layer に圧縮)
    return x_coarse.reshape(25, 25, 6).mean(axis=2)


def main():
    here = Path(__file__).parent
    npz_path = here / "output" / "field_2d_snapshots.npz"
    if not npz_path.exists():
        raise SystemExit(f"snapshots 無し: {npz_path}")
    data = np.load(npz_path)
    n_snap = len(data["steps"])
    print(f"snapshots: {n_snap}")

    viewer_dir = here.parent / "viewer"
    catalog_path = viewer_dir / "catalog.json"
    with open(catalog_path, encoding="utf-8") as f:
        catalog = json.load(f)

    # field_2d dataset を追加、 product = w (= 鉛直風)、 theta_prime (= 温位偏差)、 ql
    field_dataset = {"label": "field_2d", "products": {}, "steps": list(range(n_snap))}

    theta_env = data["theta_env"]  # shape (150,)

    for product, scale, unit, source_keys in [
        ("w", 1.0, "m/s", [f"w_{i:03d}" for i in range(n_snap)]),
        ("theta_prime", 1.0, "K", [f"theta_{i:03d}" for i in range(n_snap)]),
        ("q_l", 1e3, "g/kg", [f"q_l_{i:03d}" for i in range(n_snap)]),
    ]:
        coarsened = []
        for key in source_keys:
            arr = data[key].astype(np.float64)
            if product == "theta_prime":
                arr = arr - theta_env[np.newaxis, :]
            coarse = coarsen_to_25(arr) * scale
            coarsened.append(coarse.astype(np.float32))

        stack = np.stack(coarsened)  # shape (n_snap, 25, 25)
        bin_path = viewer_dir / f"field_2d_{product}.bin"
        stack.tofile(bin_path)

        clean = np.nan_to_num(stack)
        field_dataset["products"][product] = {
            "unit": unit,
            "n_step": int(n_snap),
            "grid": [25, 25],
            "min": round(float(clean.min()), 6),
            "max": round(float(clean.max()), 6),
            "mean": round(float(clean.mean()), 6),
            "bin_size_kb": round(bin_path.stat().st_size / 1024, 1),
            "bin_file": bin_path.name,
        }
        print(f"  {product:12s} 25×25×{n_snap}step → {bin_path.name}  "
              f"({bin_path.stat().st_size/1024:.1f} KB)  "
              f"range=[{clean.min():+.3g}, {clean.max():+.3g}] {unit}")

    # ql の placeholder = ql product を強制 (= scatter mode で uQlMax_gkg 取得用)
    # field_2d の ql は雲水未発生で 0、 ただし viewer scatter mode で max を参照するため設定
    field_dataset["products"]["ql"] = {
        "unit": "g/kg",
        "n_step": n_snap,
        "grid": [25, 25],
        "min": field_dataset["products"]["q_l"]["min"],
        "max": max(field_dataset["products"]["q_l"]["max"], 0.001),
        "mean": field_dataset["products"]["q_l"]["mean"],
        "bin_size_kb": field_dataset["products"]["q_l"]["bin_size_kb"],
        "bin_file": "field_2d_q_l.bin",
    }
    field_dataset["products"]["effective_radius"] = {
        "unit": "um", "n_step": n_snap, "grid": [25, 25],
        "min": 10.0, "max": 10.0, "mean": 10.0,
        "bin_size_kb": 0, "bin_file": "field_2d_q_l.bin"  # placeholder
    }

    catalog["datasets"]["field_2d"] = field_dataset
    with open(catalog_path, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2)
    print(f"\ncatalog: {catalog_path} 更新、 field_2d dataset 追加完了")
    print(f"  viewer で ?dataset=field_2d&product=w&snap=10 等で表示可能")


if __name__ == "__main__":
    main()
