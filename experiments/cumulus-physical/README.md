# 気象学本道 雲シミュ (= b98、 物理ベース粒子追跡)

ノイズで「もこもこ」 を fake する takram / Nubis 路線は user 真意ではないと確定 (= 2026-05-25 訂正)。
水分子の物理的扱い + 気象学を総動員する路線に乗り直し、 ここで python の **Super-Droplet Method
(= SDM、 PySDM 実装)** を使って雲微物理を直接計算する。

## 全体 path

```
[python オフライン計算]
   PySDM で雲解像モデル run
       ↓
   出力: 3D 雲水質量場の時系列 (= npy / zstd)
       ↓
[fujihc viewer replay]
   3D texture として fetch
       ↓
   既存 volumetric_clouds.js を置換、 ray-march で密度可視化
```

## Phase 分割

- **Phase 0** (= 本 setup): PySDM hello world、 1-D parcel example をローカル run、 物理が動く確認
- **Phase 1**: 2D 富士山周辺 (= 8km × 高度 6km、 解像度 50m) の地形性対流シミュ
- **Phase 2**: 3D 拡張 (= 富士山周辺 LES、 SDM 粒子数 増加)
- **Phase 3**: 結果を fujihc viewer に統合、 既存 noise (= b80-95) 全廃棄

詳細 brief: `~/.agents/scratch/fujihc-trainer-project/b98-cumulus-physical-microphysics.md`

## Phase 0 セットアップ手順

```bash
cd experiments/cumulus-physical
python -m venv .venv
.venv/Scripts/python.exe -m pip install --upgrade pip
.venv/Scripts/python.exe -m pip install PySDM
.venv/Scripts/python.exe phase0_hello.py
```

期待出力 (= `output/phase0_parcel.npy`): 1-D parcel が上昇しながら凝結 → 雲水質量が増える時系列。

## 廃棄方針

- 既存 fujihc-trainer の `web/lib/map3d/volumetric_clouds.js` (= b80-95 の noise 実装) は
  Phase 3 で完全置換、 Phase 0-2 中は触らない (= viewer 本体は壊さず並行進行)
- Phase 0-2 の python 計算結果 (= output/ 配下の npy) は .gitignore で除外、
  commit しない (= 数十〜数百 MB、 fujihc 本体への汚染を避ける)

## 参照

- Super-Droplet Method (= Shima et al. 2009): https://arxiv.org/pdf/physics/0701103
- PySDM (= python 実装): https://github.com/open-atmos/PySDM
- 業界標準微物理: Morrison 2 moment (WRF / CM1 で採用)
