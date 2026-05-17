// brief b11-Phase3: rider の 3D 自転車 mesh の配置 (位置・進行方向) を pin する.
//
// 各 test は「落ちたら何のバグを捕まえたことになるか」を 1 行で言える形にする。
// 自転車 mesh の組み立て (Three.js primitive) は terrain3d.html 側で実画面目視に
// 委ね、 ここでは純粋なデータ変換 (リボン頂点 → 配置) だけを検証する。

import { describe, it, expect } from 'vitest';
import { ribbonCenterAt, riderStartPlacement } from '../lib/rider_placement.js';

// course 点 i ごとに 左端(2i) / 右端(2i+1)、 各 3 float。
// 点0: 左(0,10,0) 右(4,10,0) → 中心 (2,10,0)
// 点1: 左(0,10,-8) 右(4,10,-8) → 中心 (2,10,-8)  (= 点0 の真北 8m 先)
const ribbon = new Float32Array([
  0, 10, 0,   4, 10, 0,    // 点0
  0, 10, -8,  4, 10, -8,   // 点1
  0, 12, -16, 4, 12, -16,  // 点2
]);

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

// === riderStartPlacement ===

describe('riderStartPlacement', () => {
  it('position = 始点 (course 点0) のリボン中心 (= 始点に置き損なうのを検出)', () => {
    const p = riderStartPlacement(ribbon, 6);
    expect(p.position).toEqual([2, 10, 0]);
  });

  it('forward は単位ベクトル = 長さ 1 (= 正規化漏れで mesh が伸び縮みするのを検出)', () => {
    const p = riderStartPlacement(ribbon, 6);
    expect(Math.hypot(p.forward[0], p.forward[1], p.forward[2])).toBeCloseTo(1, 9);
  });

  it('forward.Y は 0 = 水平 (= 自転車が路面に対し傾くのを防ぐ)', () => {
    // 点0→点1 は Y 同じだが、 退化でない一般のリボンでも Y は常に 0 に倒す。
    const sloped = new Float32Array([
      0, 10, 0,  4, 10, 0,
      0, 90, -8, 4, 90, -8,   // 次点が大きく上にあっても forward.Y は 0
    ]);
    expect(riderStartPlacement(sloped, 4).forward[1]).toBe(0);
  });

  it('forward は始点→次点の向き (= 進行方向の符号反転を検出)', () => {
    // 点1 は 点0 の北 (-Z) 8m 先 → forward は -Z 向き。
    const p = riderStartPlacement(ribbon, 6);
    expect(p.forward[2]).toBeCloseTo(-1, 9);
    expect(p.forward[0]).toBeCloseTo(0, 9);
  });

  it('始点と次点が XZ 同一なら forward = [0,0,-1] fallback (= 退化で NaN を防ぐ)', () => {
    const degenerate = new Float32Array([
      5, 10, 5, 9, 10, 5,    // 点0 中心 (7,10,5)
      5, 10, 5, 9, 10, 5,    // 点1 中心 (7,10,5) ── 点0 と XZ 同一
    ]);
    expect(riderStartPlacement(degenerate, 4).forward).toEqual([0, 0, -1]);
  });

  it('vertexCount < 4 は RangeError (= course 2 点未満で進行方向を出せない)', () => {
    expect(() => riderStartPlacement(ribbon, 2)).toThrow(RangeError);
    expect(() => riderStartPlacement(ribbon, 0)).toThrow(RangeError);
  });
});
