"""Phase 3 単体 demo 用 export: PySDM 結果 (= ql 場) を viewer 取り込み形式に変換。

Phase 1 が吐く storage の中から「雲が成熟した代表 step」 を 1 つ選び、 雲水質量比
(= ql、 25×25 float32) を JSON で書き出す。 viewer (= three.js ray-march) はこれを
density texture として fetch、 ノイズ無しで物理計算の雲を画面に出す。
"""
import json
from pathlib import Path
import numpy as np


def main():
    here = Path(__file__).parent
    storage_dir = here / "output" / "phase1_arabas_storage"
    if not storage_dir.exists():
        raise SystemExit(f"storage 無し: {storage_dir}")

    # ql ファイル群から雲が成熟した step を選ぶ (= 中央付近、 25920s = 7.2 hr 相当)
    ql_files = sorted(storage_dir.glob("cloud water mixing ratio_*.npy"))
    print(f"ql snapshots: {len(ql_files)}")
    if not ql_files:
        raise SystemExit("ql snapshot 無し")

    # 全 step を 3D 配列に積む (= [step, x, z]) して、 ピーク step を mid とする
    stack = np.stack([np.load(p) for p in ql_files])  # (n_step, 25, 25)
    print(f"stack shape: {stack.shape}")
    print(f"global max ql: {stack.max()*1e3:.4f} g/kg")

    # 雲水量で 4 step 選ぶ (= 20%, 40%, 60%, 80% pos)
    n_step = len(ql_files)
    sel = [int(n_step * f) for f in (0.2, 0.4, 0.6, 0.8)]

    out = {
        "grid": list(stack.shape[1:]),  # [x, z]
        "step_count": int(n_step),
        "global_max_ql_g_per_kg": float(stack.max() * 1e3),
        "snapshots": []
    }
    for s in sel:
        arr = stack[s]
        out["snapshots"].append({
            "step_index": int(s),
            "ql_max_g_per_kg": float(arr.max() * 1e3),
            "ql_mean_g_per_kg": float(arr.mean() * 1e3),
            # 25×25 float、 g/kg 単位に変換 + 行優先 flat
            "ql_g_per_kg": (arr * 1e3).flatten().tolist(),
        })

    out_json = here / "viewer" / "density.json"
    out_json.parent.mkdir(exist_ok=True)
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print(f"出力: {out_json}  ({out_json.stat().st_size/1024:.1f} KB)")
    for snap in out["snapshots"]:
        print(f"  step {snap['step_index']:4d}  max={snap['ql_max_g_per_kg']:.3f} g/kg  mean={snap['ql_mean_g_per_kg']:.4f} g/kg")


if __name__ == "__main__":
    main()
