# b11-phase4-physics 完了レポート

## 概要
branch: `b11-phase4-physics`
commit: `d9dc002` (Phase 4) + `0d56b65` (tiles)
push: 禁止 (ローカルのみ)
tests: 74 files / 1100 tests — ALL PASSED

---

## Phase 4 実装内容

### 物理ループ (terrain3d.html)
- `integratePhysics(v, dt, power_w, slope_pct)` を 250W 定常パワーで毎フレーム呼び出し
- `riderPlacementAtDistance(ribbon.positions, course, rider.distanceTraveled)` でコースリボン上の position/forward を算出
- `bike.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,-1), forward)` で前進方向に向きを揃え
- タイル範囲: 動的 `courseBounds(course, 1500m)` ≈ 35 tiles (旧 240 tiles から 86% 削減)

### rider_placement.js
- `ribbonCenterAt(positions, i)` — リボン頂点配列の左右中点を返す
- `riderPlacementAtDistance(positions, course, distanceM)` — 任意距離での補間 position + forward ベクトル
- RangeError: 範囲外インデックス・不正配列で throw

### テスト
- `rider_placement.test.js`: 11 tests (ribbonCenterAt 3 + riderPlacementAtDistance 8)
- 全 74 test files / 1100 tests 緑

### テクスチャ変更
- `buildModeTexture()` / `switchMode()` / `texCache` / `#layers` UI を全削除
- `buildPhotoTexture()` (seamlessphoto のみ) に一本化
- GSI 配布元への負荷: 旧 240 tiles → 35 tiles / per-machine IndexedDB cache のみ / git 同梱なし

---

## tile_constants.py 変更 (別 commit)

| 項目 | 旧 | 新 |
|---|---|---|
| FUJI_TERRAIN_BBOX | (138.562, 35.226, 138.893, 35.495) | (138.660, 35.340, 138.790, 35.480) |
| z=14 tiles | ~240 | ~35 |
| 理由 | 旧 JS FUJI_TERRAIN_BBOX と同期 | JS が courseBounds 動的算出に変わったため Python 側も縮小 |

---

## 画面検証結果

- 手段: headless-shot.ps1 + Read tool 目視
- 地形 3D + seamlessphoto テクスチャ: PASS
- コースリボン (橙→赤グラデ): PASS
- タイル範囲縮小 (山の裏側まで取得していない): PASS
- 自転車メッシュの前進: 前 session ユーザ確認済み「自転車は動いてる」。headless 静止画では rAF ループ非進行で批評不能 (既知制約)

---

## 未解決 / 次 phase 候補

- IndexedDB TileCache (b11-phase5 brief CONVERGED) — per-machine cache 実装
- `scripts/fix_gpx_lat.mjs` — unstaged、用途未確認
- 俯瞰カメラではなくライダー追従カメラへの切替
