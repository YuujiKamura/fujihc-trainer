// b12 Phase 3 部品5: rider_mesh3d.js の単体テスト。
//
// rider_mesh3d.js は 'three' を import せず THREE を引数注入する設計なので、 node 上の
// vitest から直接 import できる。 寸法定数は直接、 mesh 組立と配置更新は最小 THREE
// スタブで検証する。 配置の数式自体は riderPlacementAtDistance (= 別途 test 済の lib)。

import { describe, it, expect } from 'vitest';
import {
  BIKE_DIMENSIONS, bikeTotalLength, createRiderMesh3d,
} from '../lib/map3d/rider_mesh3d.js';

describe('BIKE_DIMENSIONS / bikeTotalLength', () => {
  it('自転車 unit モデルの全長はちょうど 1.0 m', () => {
    expect(bikeTotalLength()).toBeCloseTo(1.0, 9);
  });

  it('寸法定数を差し替えても全長計算式は (rearZ+wheelR)-(frontZ-wheelR)', () => {
    const d = { wheelR: 0.3, tubeR: 0.05, frontZ: -0.5, rearZ: 0.5 };
    expect(bikeTotalLength(d)).toBeCloseTo(1.6, 9);
  });

  it('車輪半径 / フレーム半径 / 前後ハブ Z が定義済', () => {
    expect(BIKE_DIMENSIONS.wheelR).toBeGreaterThan(0);
    expect(BIKE_DIMENSIONS.tubeR).toBeGreaterThan(0);
    expect(BIKE_DIMENSIONS.frontZ).toBeLessThan(BIKE_DIMENSIONS.rearZ);  // 前輪は -Z 側
  });
});

// --- 最小 THREE スタブ ---
function makeThreeStub() {
  class Vec3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
    addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
    length() { return Math.hypot(this.x, this.y, this.z); }
    normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; this.z /= l; return this; }
  }
  class Quat {
    constructor() { this.calls = 0; this.from = null; this.to = null; }
    setFromUnitVectors(a, b) { this.calls += 1; this.from = { ...a }; this.to = { ...b }; return this; }
  }
  class Group {
    constructor() { this.children = []; this.position = new Vec3(); this.quaternion = new Quat(); }
    add(o) { this.children.push(o); return this; }
  }
  class Mesh {
    constructor(geometry, material) {
      this.geometry = geometry; this.material = material;
      this.position = new Vec3(); this.quaternion = new Quat();
      this.rotation = { x: 0, y: 0, z: 0 };
    }
  }
  class CylinderGeometry { constructor(...a) { this.args = a; } }
  class TorusGeometry { constructor(...a) { this.args = a; } }
  class BoxGeometry { constructor(...a) { this.args = a; } }
  class MeshStandardMaterial { constructor(o) { Object.assign(this, o); } }
  return {
    Vector3: Vec3, Group, Mesh,
    CylinderGeometry, TorusGeometry, BoxGeometry, MeshStandardMaterial,
  };
}

// 東 (+X) に直進する 3 点コース。 リボン頂点は course 点ごとに左右 2 つ、 各 3 float。
function eastwardCourse() {
  const course = [
    { distance_m: 0 }, { distance_m: 100 }, { distance_m: 200 },
  ];
  // 左端 z=+1 / 右端 z=-1 → 中心 z=0、 x は 0/100/200。
  const positions = [
    0, 0, 1, 0, 0, -1,
    100, 0, 1, 100, 0, -1,
    200, 0, 1, 200, 0, -1,
  ];
  return { course, positions };
}

describe('createRiderMesh3d: 自転車 mesh の組立', () => {
  it('group を公開し、 車輪 2 + フレーム 6 + サドル/ハンドル 2 = 10 部品を持つ', () => {
    const r = createRiderMesh3d(makeThreeStub());
    expect(r.group).toBeTruthy();
    expect(r.group.children.length).toBe(10);
  });
});

describe('updatePose: 走行距離 → mesh の置き場所', () => {
  it('距離 50m で group をコース中点 (= [50,0,0]) に置く', () => {
    const r = createRiderMesh3d(makeThreeStub());
    const { course, positions } = eastwardCourse();
    const pl = r.updatePose(positions, course, 50);
    expect(pl.position[0]).toBeCloseTo(50, 6);
    expect(pl.position[1]).toBeCloseTo(0, 6);
    expect(pl.position[2]).toBeCloseTo(0, 6);
    expect(r.group.position.x).toBeCloseTo(50, 6);
    expect(r.group.position.z).toBeCloseTo(0, 6);
  });

  it('東進コースでは forward が +X、 mesh の向きを setFromUnitVectors で更新する', () => {
    const r = createRiderMesh3d(makeThreeStub());
    const { course, positions } = eastwardCourse();
    const pl = r.updatePose(positions, course, 120);
    expect(pl.forward[0]).toBeCloseTo(1, 6);
    expect(pl.forward[2]).toBeCloseTo(0, 6);
    // bike model 前方 (-Z) を forward へ回す setFromUnitVectors が呼ばれている
    expect(r.group.quaternion.calls).toBeGreaterThan(0);
    expect(r.group.quaternion.from).toEqual({ x: 0, y: 0, z: -1 });
    expect(r.group.quaternion.to.x).toBeCloseTo(1, 6);
  });

  it('距離は [0, 総距離] に clamp される (= 範囲外でも mesh が飛ばない)', () => {
    const r = createRiderMesh3d(makeThreeStub());
    const { course, positions } = eastwardCourse();
    const over = r.updatePose(positions, course, 99999);
    expect(over.position[0]).toBeCloseTo(200, 6);  // 終点でクランプ
    const under = r.updatePose(positions, course, -50);
    expect(under.position[0]).toBeCloseTo(0, 6);    // 起点でクランプ
  });
});
