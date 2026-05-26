"""b113 = PySDM cumulus_widened (= grid 100×100、 domain 6km 四方) を viewer 用 bin に export。

既存 phase3_export.py との違い:
- 対象 = cumulus_widened のみ (= 1 dataset)、 既存 cumulus / stratocumulus は触らない
- **catalog.json は touch しない** (= viewer 統合は b109 で atomic、 b113 は素材のみ)
- 出力 = viewer/cumulus_widened_{ql,n_c_cm3,effective_radius,super_droplet_count}.bin

bin size = sim 実走の step 数 × 100 × 100 × 4 byte。 4 倍 domain では雲が大きく育ち、
雨粒 6mm 上限 (= Gunn-Kinzer 落下速度補間範囲) に sim 中盤で到達して PySDM が
正常停止する。 b113 の実走は 65 step (= 5400s 目標の 70%)、 各 bin 2.48 MB、 4 product 9.9 MB。

brief: ~/.agents/scratch/fujihc-trainer-project/b113-pysdm-cumulus-4x-domain.md
"""
from pathlib import Path
import numpy as np


PRODUCTS = {
    "ql": ("cloud water mixing ratio", "g/kg", 1e3),
    "n_c_cm3": ("n_c_cm3", "1/cm^3", 1.0),
    "effective_radius": ("effective radius", "um", 1.0),
    "super_droplet_count": ("super droplet count per gridbox", "count", 1.0),
}

LABEL = "cumulus_widened"


def main():
    here = Path(__file__).parent
    storage_dir = here / "output" / "phase1_arabas_cumulus_widened_storage"
    if not storage_dir.exists():
        raise SystemExit(f"storage 無し: {storage_dir}、 phase1_arabas_cumulus_widened.py を先に実行")

    out_dir = here / "viewer"
    out_dir.mkdir(exist_ok=True)

    for short, (raw_name, unit, scale) in PRODUCTS.items():
        files = sorted(storage_dir.glob(f"{raw_name}_*.npy"))
        if not files:
            print(f"  {short:25s}: 無し (skip)")
            continue
        stack = np.stack([np.load(p).astype(np.float32) * scale for p in files])
        n_step, nx, nz = stack.shape

        bin_path = out_dir / f"{LABEL}_{short}.bin"
        stack.tofile(bin_path)
        clean = np.nan_to_num(stack, nan=0.0)
        print(f"  {short:25s}: {n_step} step × {nx}×{nz} float32  -> {bin_path.name} "
              f"({bin_path.stat().st_size/1024/1024:.2f} MB)  "
              f"min={clean.min():.4g} max={clean.max():.4g} {unit}")

    print(f"\ncumulus_widened bin 4 件生成、 catalog.json は touch せず")
    print(f"viewer 統合 (= catalog 登録 + 画面表示) は b109 で atomic 1 commit")


if __name__ == "__main__":
    main()
