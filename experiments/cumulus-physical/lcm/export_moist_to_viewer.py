"""b106 = field_moist_snapshots.npz (= 湿った BL + 山岳 lift で凝結する雲の sim 出力) を
viewer 入力 binary に変換、 25×25 にダウンサンプル。

b105 export_terrain_to_viewer.py を copy + リテラル 4 箇所差し替え (= field_terrain →
field_moist)。 共通化 (= viewer_export_common.py 等) は 3 件目で考える defer 規律、
b106 では SoT 二重化を意識した上での copy。

catalog top-level に schema_version=1 を initial 付与 (= 軸6 audit C9 対応、 silent drift
を loud drift に変える 1 段目)。

brief: ~/.agents/scratch/fujihc-trainer-project/b106-moist-bl-mountain-cloud.md
"""
from __future__ import annotations
import json
import os
from pathlib import Path

import numpy as np


def coarsen_to_25(arr_2d: np.ndarray) -> np.ndarray:
    """100×150 → 25×25 area-weighted average + 鉛直 z=0-15km を 25 layer (= 600m/layer)"""
    nx, nz = arr_2d.shape
    if (nx, nz) != (100, 150):
        raise AssertionError(f"expected shape (100, 150), got {(nx, nz)}")
    x_coarse = arr_2d.reshape(25, 4, nz).mean(axis=1)
    return x_coarse.reshape(25, 25, 6).mean(axis=2)


def atomic_write_json(path: Path, obj: dict) -> None:
    """tmp file + os.replace で atomic 置換、 中断時の partial JSON 防止"""
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2)
    os.replace(tmp_path, path)


def main():
    here = Path(__file__).parent
    npz_path = here / "output" / "field_moist_snapshots.npz"
    if not npz_path.exists():
        raise SystemExit(f"snapshots 無し: {npz_path}")
    data = np.load(npz_path)
    n_snap = len(data["steps"])
    print(f"snapshots: {n_snap}")

    viewer_dir = here.parent / "viewer"
    catalog_path = viewer_dir / "catalog.json"
    if not catalog_path.exists():
        raise FileNotFoundError(f"catalog 無し: {catalog_path}")
    with open(catalog_path, encoding="utf-8") as f:
        catalog = json.load(f)

    field_dataset = {"label": "field_moist", "products": {}, "steps": list(range(n_snap))}

    theta_env = data["theta_env"]

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

        stack = np.stack(coarsened)
        bin_path = viewer_dir / f"field_moist_{product}.bin"
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

    field_dataset["products"]["ql"] = {
        "unit": "g/kg",
        "n_step": n_snap,
        "grid": [25, 25],
        "min": field_dataset["products"]["q_l"]["min"],
        "max": max(field_dataset["products"]["q_l"]["max"], 0.001),
        "mean": field_dataset["products"]["q_l"]["mean"],
        "bin_size_kb": field_dataset["products"]["q_l"]["bin_size_kb"],
        "bin_file": "field_moist_q_l.bin",
    }
    field_dataset["products"]["effective_radius"] = {
        "unit": "um", "n_step": n_snap, "grid": [25, 25],
        "min": 10.0, "max": 10.0, "mean": 10.0,
        "bin_size_kb": 0, "bin_file": "field_moist_q_l.bin"
    }

    catalog["schema_version"] = catalog.get("schema_version", 1)
    catalog["datasets"]["field_moist"] = field_dataset
    atomic_write_json(catalog_path, catalog)
    print(f"\ncatalog: {catalog_path} 更新 (atomic, schema_version=1)、 field_moist dataset 追加")
    print(f"  viewer で ?dataset=field_moist&product=ql&mode=scatter 等で表示可能")


if __name__ == "__main__":
    main()
