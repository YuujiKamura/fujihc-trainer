// b12 Phase 3 部品5: rider_mesh3d.js の単体テスト。
//
// rider_mesh3d.js は 'three' を import せず THREE を引数注入する設計なので、 node 上の
// vitest から直接 import できる。 寸法定数は直接、 mesh 組立と配置更新は最小 THREE
// スタブで検証する。 配置の数式自体は riderPlacementAtDistance (= 別途 test 済の lib)。

import { describe, it, expect } from 'vitest';
import {
  BIKE_DIMENSIONS, bikeTotalLength, createRiderMesh3d,
  BIKE_SHAPE_DEFAULTS, BIKE_SHAPE_RANGE, resolveBikeShape,
} from '../lib/map3d/rider_mesh3d.js';

describe('BIKE_DIMENSIONS / bikeTotalLength', () => {
  it('自転車 unit モデルの全長は約 0.98 m (= 実ジオメトリを正規化した値)', () => {
    expect(bikeTotalLength()).toBeCloseTo(0.98, 9);
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
    constructor() {
      this.children = []; this.position = new Vec3(); this.quaternion = new Quat();
      this.rotation = { x: 0, y: 0, z: 0 };
      this.scale = new Vec3(1, 1, 1);
      this.lookAtCalls = [];
    }
    add(o) { this.children.push(o); return this; }
    clear() { this.children.length = 0; return this; }
    lookAt(x, y, z) {
      // THREE.lookAt は (Vector3) でも (x,y,z) でも受け付ける
      if (typeof x === 'object') { this.lookAtCalls.push({ x: x.x, y: x.y, z: x.z }); }
      else { this.lookAtCalls.push({ x, y, z }); }
    }
    traverse(fn) { fn(this); for (const c of this.children) c.traverse(fn); }
  }
  class Mesh {
    constructor(geometry, material) {
      this.geometry = geometry; this.material = material;
      this.position = new Vec3(); this.quaternion = new Quat();
      this.rotation = { x: 0, y: 0, z: 0 };
      this.scale = new Vec3(1, 1, 1);
      this.isMesh = true;
    }
    traverse(fn) { fn(this); }
  }
  class CylinderGeometry { constructor(...a) { this.args = a; } }
  class TorusGeometry { constructor(...a) { this.args = a; } }
  class BoxGeometry { constructor(...a) { this.args = a; } }
  class PlaneGeometry { constructor(...a) { this.args = a; } }
  class MeshStandardMaterial { constructor(o) { Object.assign(this, o); } }
  class ShadowMaterial { constructor(o) { Object.assign(this, o || {}); } }
  return {
    Vector3: Vec3, Group, Mesh,
    CylinderGeometry, TorusGeometry, BoxGeometry, PlaneGeometry,
    MeshStandardMaterial, ShadowMaterial,
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
  it('group 直下は 28 部品 (3 グループ + フレーム 14 + サドル 1 + ハンドル 3 + リムブレーキ 6 + 影ボード 1)', () => {
    const r = createRiderMesh3d(makeThreeStub());
    expect(r.group).toBeTruthy();
    expect(r.group.children.length).toBe(28);
  });

  it('前輪グループ (= children[0]) は 18 部品 (タイヤ 1 + ハブ 1 + スポーク 16)', () => {
    const r = createRiderMesh3d(makeThreeStub());
    expect(r.group.children[0].children.length).toBe(18);
  });

  it('駆動系グループ (= children 末尾) は 5 部品 (クランク 2 + ペダル 2 + チェーンリング 1)', () => {
    const r = createRiderMesh3d(makeThreeStub());
    const crankSet = r.group.children[r.group.children.length - 1];
    expect(crankSet.children.length).toBe(5);
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

  it('東進コースでは forward が +X、 mesh の向きを lookAt で更新する', () => {
    const r = createRiderMesh3d(makeThreeStub());
    const { course, positions } = eastwardCourse();
    const pl = r.updatePose(positions, course, 120);
    expect(pl.forward[0]).toBeCloseTo(1, 6);
    expect(pl.forward[2]).toBeCloseTo(0, 6);
    // lookAt 対象は後方 (position − forward3d) ── bike は −Z 前方、通常 lookAt は +Z を向けるため
    expect(r.group.lookAtCalls.length).toBeGreaterThan(0);
    const target = r.group.lookAtCalls[r.group.lookAtCalls.length - 1];
    // 東進+平坦コース → 後方は西側 → target.x < position.x、高さは同じ
    expect(target.x).toBeLessThan(r.group.position.x);
    expect(target.y).toBeCloseTo(r.group.position.y, 6);
  });

  it('登り+カーブでも lookAt が呼ばれる (= up=+Y でロール 0 が保証される)', () => {
    // setFromUnitVectors は坂+カーブで最短回転の軸が混合しロールが出る。
    // lookAt は up=+Y でローカル X 軸（車軸）を常に水平に保つのでロールは構造的にゼロ。
    const r = createRiderMesh3d(makeThreeStub());
    // 北東に向かって登る区間 (ヨー + ピッチが両方入る)
    const climbCurvePositions = new Float32Array([
      0, 0, 0,     4, 0, 0,          // 点0: center (2,0,0)
      100, 10, -100, 104, 10, -100,  // 点1: center (102,10,-100) 北東+登り
    ]);
    const climbCourse = [{ distance_m: 0 }, { distance_m: Math.hypot(100, 100) }];
    r.updatePose(climbCurvePositions, climbCourse, 50);
    expect(r.group.lookAtCalls.length).toBeGreaterThan(0);
    const target = r.group.lookAtCalls[r.group.lookAtCalls.length - 1];
    // 後方の点を lookAt → 登り区間では後方は下方 → target.y < position.y
    expect(target.y).toBeLessThan(r.group.position.y);
  });

  it('距離は [0, 総距離] に clamp される (= 範囲外でも mesh が飛ばない)', () => {
    const r = createRiderMesh3d(makeThreeStub());
    const { course, positions } = eastwardCourse();
    const over = r.updatePose(positions, course, 99999);
    expect(over.position[0]).toBeCloseTo(200, 6);  // 終点でクランプ
    const under = r.updatePose(positions, course, -50);
    expect(under.position[0]).toBeCloseTo(0, 6);    // 起点でクランプ
  });

  it('走行距離に応じて車輪と駆動系を回す (= rotation.x が距離で変わる)', () => {
    const r = createRiderMesh3d(makeThreeStub());
    const { course, positions } = eastwardCourse();
    const front = r.group.children[0], rear = r.group.children[1];
    const crank = r.group.children[r.group.children.length - 1];
    r.updatePose(positions, course, 0);
    expect(front.rotation.x).toBeCloseTo(0, 10);   // 距離 0 では回っていない
    r.updatePose(positions, course, 100);
    expect(front.rotation.x).not.toBe(0);          // 車輪が回った
    expect(rear.rotation.x).toBe(front.rotation.x); // 前後輪は同じ角速度
    expect(crank.rotation.x).not.toBe(0);          // 駆動系も回った
    // クランクはギア比ぶん車輪より遅い (= 回転角が小さい)。
    expect(Math.abs(crank.rotation.x)).toBeLessThan(Math.abs(front.rotation.x));
  });

  it('ペダルは crankSet の回転を打ち消す逆回転を持つ (= 踏み面が常にコースと水平)', () => {
    const r = createRiderMesh3d(makeThreeStub());
    const { course, positions } = eastwardCourse();
    r.updatePose(positions, course, 100);
    const crankSet = r.group.children[r.group.children.length - 1];
    // crankSet.children = クランク 2 + ペダルグループ 2 + チェーンリング 1。
    const pedalR = crankSet.children[2], pedalL = crankSet.children[3];
    expect(pedalR.rotation.x).toBeCloseTo(-crankSet.rotation.x, 9);
    expect(pedalL.rotation.x).toBeCloseTo(-crankSet.rotation.x, 9);
  });

  it('山なり (凸) コースの頂点で bike 中心はコース面に乗る (= 中点ではなく distanceM 点)', () => {
    const r = createRiderMesh3d(makeThreeStub());
    // 中央が高い凸コース。 distanceM=100 (頂点) で bike 中心 y は頂点の高さ 10。
    // 前後 2 点の中点配置だと中点が曲面より下に沈み 10 未満になる (= カーブで浮く回帰)。
    const course = [{ distance_m: 0 }, { distance_m: 100 }, { distance_m: 200 }];
    const positions = [
      0, 0, 1, 0, 0, -1,
      100, 10, 1, 100, 10, -1,
      200, 0, 1, 200, 0, -1,
    ];
    const pl = r.updatePose(positions, course, 100);
    expect(pl.position[1]).toBeCloseTo(10, 6);
    expect(r.group.position.y).toBeCloseTo(10, 6);
  });
});

describe('resolveBikeShape: 形状パラメータの既定値補完 + クランプ', () => {
  it('引数なしで全フィールドが既定値で揃う', () => {
    const s = resolveBikeShape();
    expect(Object.keys(s).sort()).toEqual(Object.keys(BIKE_SHAPE_DEFAULTS).sort());
    expect(s.wheelR).toBe(BIKE_SHAPE_DEFAULTS.wheelR);
    expect(s.barW).toBe(BIKE_SHAPE_DEFAULTS.barW);
  });

  it('部分指定はそのフィールドだけ反映、 残りは既定値', () => {
    const s = resolveBikeShape({ wheelR: 0.3 });
    expect(s.wheelR).toBe(0.3);
    expect(s.tubeR).toBe(BIKE_SHAPE_DEFAULTS.tubeR);
  });

  it('範囲外の値は許容範囲にクランプする', () => {
    expect(resolveBikeShape({ wheelR: 99 }).wheelR).toBe(BIKE_SHAPE_RANGE.wheelR[1]);
    expect(resolveBikeShape({ wheelR: -5 }).wheelR).toBe(BIKE_SHAPE_RANGE.wheelR[0]);
  });

  it('非数 (NaN / 文字列 / undefined) は既定値へ落とす', () => {
    expect(resolveBikeShape({ saddleY: NaN }).saddleY).toBe(BIKE_SHAPE_DEFAULTS.saddleY);
    expect(resolveBikeShape({ saddleY: 'abc' }).saddleY).toBe(BIKE_SHAPE_DEFAULTS.saddleY);
    expect(resolveBikeShape({ saddleY: undefined }).saddleY).toBe(BIKE_SHAPE_DEFAULTS.saddleY);
  });
});

describe('createRiderMesh3d.setShape: 部品ごと形状の差し替え', () => {
  it('setShape 後も group 直下 28 部品を保つ', () => {
    const r = createRiderMesh3d(makeThreeStub());
    r.setShape({ wheelR: 0.3 });
    expect(r.group.children.length).toBe(28);
  });

  it('車輪半径を変えると前輪トーラスの geometry 引数に反映される', () => {
    // children[0] が前輪の回転グループ、 その children[0] が前輪タイヤトーラス。
    // TorusGeometry(wheelR, tubeR, ...) の第 1 引数が車輪半径。
    const r = createRiderMesh3d(makeThreeStub());
    r.setShape({ wheelR: 0.3 });
    expect(r.group.children[0].children[0].geometry.args[0]).toBe(0.3);
  });

  it('範囲外の指定は resolveBikeShape でクランプされてから組まれる', () => {
    const r = createRiderMesh3d(makeThreeStub());
    r.setShape({ wheelR: 99 });
    expect(r.group.children[0].children[0].geometry.args[0]).toBe(BIKE_SHAPE_RANGE.wheelR[1]);
  });

  it('部分指定を重ねても直前の形状が保たれる (= スライダー 1 個ずつ動かす運用)', () => {
    const r = createRiderMesh3d(makeThreeStub());
    r.setShape({ wheelR: 0.3 });
    r.setShape({ tubeR: 0.03 });
    const tyre = r.group.children[0].children[0];  // 前輪グループの先頭 = タイヤトーラス
    expect(tyre.geometry.args[0]).toBe(0.3);   // 1 回目の wheelR が残る
    expect(tyre.geometry.args[1]).toBe(0.03);  // 2 回目の tubeR が反映
  });

  it('影ボードは既定で非表示、 setShadowBoard で表示が切り替わる', () => {
    const r = createRiderMesh3d(makeThreeStub());
    const board = r.group.children.find((c) => c.name === 'shadowBoard');
    expect(board).toBeTruthy();
    expect(board.visible).toBe(false);   // 既定オフ
    r.setShadowBoard(true);
    expect(board.visible).toBe(true);
    r.setShadowBoard(false);
    expect(board.visible).toBe(false);
  });

  it('setShape で組み直しても影ボードの表示状態を保つ', () => {
    const r = createRiderMesh3d(makeThreeStub());
    r.setShadowBoard(true);
    r.setShape({ wheelR: 0.3 });
    const board = r.group.children.find((c) => c.name === 'shadowBoard');
    expect(board.visible).toBe(true);   // 組み直し後もオンを維持
  });
});
