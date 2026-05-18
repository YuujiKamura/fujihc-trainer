// brief b11-Phase4: rider の 3D 自転車 mesh の配置を任意距離で pin する.
//
// 各 test は「落ちたら何のバグを捕まえたことになるか」を 1 行で言える形にする。
// 自転車 mesh の組み立て (Three.js primitive) は terrain3d.html 側で実画面目視に
// 委ね、 ここでは純粋なデータ変換 (リボン頂点 + course 距離 → 配置) だけを検証する。

import { describe, it, expect } from 'vitest';
import { ribbonCenterAt, riderPlacementAtDistance } from '../lib/rider_placement.js';

// course 点 i ごとに 左端(2i) / 右端(2i+1)、 各 3 float。
// 点0: 左(0,10,0) 右(4,10,0) → 中心 (2,10,0)
// 点1: 左(0,10,-8) 右(4,10,-8) → 中心 (2,10,-8)  (= 点0 の真北 8m 先)
// 点2: 左(0,12,-16) 右(4,12,-16) → 中心 (2,12,-16)
const ribbon = new Float32Array([
  0, 10, 0,   4, 10, 0,    // 点0
  0, 10, -8,  4, 10, -8,   // 点1
  0, 12, -16, 4, 12, -16,  // 点2
]);
const course = [
  { distance_m: 0 },
  { distance_m: 8 },
  { distance_m: 16 },
];

// === ribbonCenterAt ===

describe('ribbonCenterAt', () => {
  it('左右頂点の中点を返す (= 中心算出の取り違えを検出)', () => {
    expect(ribbonCenterAt(ribbon, 0)).toEqual([2, 10, 0]);
    expect(ribbonCenterAt(ribbon, 1)).toEqual([2, 10, -8]);
    expect(ribbonCenterAt(ribbon, 2)).toEqual([2, 12, -16]);
  });

  it('負 index は RangeError (= 配列を後ろから読む取り違えを弾く)', () => {
    expect(() => ribbonCenterAt(ribbon, -1)).toThrow(RangeError);
  });

  it('点数以上の index は RangeError (= 末尾頂点の数え落としを検出)', () => {
    expect(() => ribbonCenterAt(ribbon, 3)).toThrow(RangeError);  // 点は 0,1,2 の3つ
  });
});

// === riderPlacementAtDistance ===

describe('riderPlacementAtDistance', () => {
  it('distance 0 → 始点リボン中心 (= 始点に置き損なうのを検出)', () => {
    const p = riderPlacementAtDistance(ribbon, course, 0);
    expect(p.position).toEqual([2, 10, 0]);
  });

  it('distance 0 → 始点→次点 forward (= 進行方向の取り違えを検出)', () => {
    const p = riderPlacementAtDistance(ribbon, course, 0);
    expect(p.forward[0]).toBeCloseTo(0, 9);
    expect(p.forward[2]).toBeCloseTo(-1, 9);
  });

  it('course 点ちょうどの距離 → その点のリボン中心 (= 区間境界で位置が飛ぶバグを検出)', () => {
    const p = riderPlacementAtDistance(ribbon, course, 8);
    expect(p.position).toEqual([2, 10, -8]);
  });

  it('区間途中 → 線形補間位置 (= 補間式の間違いを検出)', () => {
    // distance=4 は区間 [0,8] の中点 → center0 と center1 の中点
    const p = riderPlacementAtDistance(ribbon, course, 4);
    expect(p.position[0]).toBeCloseTo(2, 9);
    expect(p.position[1]).toBeCloseTo(10, 9);
    expect(p.position[2]).toBeCloseTo(-4, 9);
  });

  it('forward が単位ベクトル (= 正規化漏れで mesh が伸び縮みするのを検出)', () => {
    const p = riderPlacementAtDistance(ribbon, course, 4);
    expect(Math.hypot(p.forward[0], p.forward[1], p.forward[2])).toBeCloseTo(1, 9);
  });

  it('forward.Y は常に 0 (= 勾配で自転車が路面に対し傾くのを防ぐ)', () => {
    // 点0→点1 で Y が大きく変わる ribbon でも forward.Y は 0 に倒す
    const slopedRibbon = new Float32Array([
      0, 10, 0,  4, 10, 0,
      0, 90, -8, 4, 90, -8,
    ]);
    const twoPtCourse = [{ distance_m: 0 }, { distance_m: 8 }];
    expect(riderPlacementAtDistance(slopedRibbon, twoPtCourse, 4).forward[1]).toBe(0);
  });

  it('distance 負 → 始点へ clamp (= 始点前で範囲外アクセスするバグを検出)', () => {
    const p = riderPlacementAtDistance(ribbon, course, -10);
    expect(p.position).toEqual([2, 10, 0]);
  });

  it('distance 総距離超 → 終点へ clamp (= 終点後で範囲外アクセスするバグを検出)', () => {
    const p = riderPlacementAtDistance(ribbon, course, 100);
    expect(p.position).toEqual([2, 12, -16]);
  });

  it('distance 総距離超 → 最終区間 forward (= 終端で forward が消えるバグを検出)', () => {
    // 最終区間 center1→center2: XZ = (0,−8) → [0,0,−1]
    const p = riderPlacementAtDistance(ribbon, course, 100);
    expect(p.forward[0]).toBeCloseTo(0, 9);
    expect(p.forward[2]).toBeCloseTo(-1, 9);
  });

  it('退化区間 → forward [0,0,-1] (= XZ 退化で NaN が出るバグを検出)', () => {
    // 点0 と点1 が XZ 同一 (Y のみ異なる) → forward XZ = 0 → fallback
    const degRibbon = new Float32Array([
      2, 10, 5,  6, 10, 5,   // 点0: center (4,10,5)
      2, 15, 5,  6, 15, 5,   // 点1: center (4,15,5)
    ]);
    const degCourse = [{ distance_m: 0 }, { distance_m: 5 }];
    expect(riderPlacementAtDistance(degRibbon, degCourse, 2.5).forward).toEqual([0, 0, -1]);
  });

  it('course 2 点未満 → RangeError (= 進行方向を出せない状態の呼び出しを検出)', () => {
    expect(() => riderPlacementAtDistance(ribbon, [], 0)).toThrow(RangeError);
    expect(() => riderPlacementAtDistance(ribbon, [{ distance_m: 0 }], 0)).toThrow(RangeError);
  });
});
