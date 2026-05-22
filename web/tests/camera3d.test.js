// b12 Phase 3 部品4: camera3d.js の単体テスト。
//
// camera3d.js は 'three' を import せず THREE を引数注入する設計なので、 node 上の
// vitest から直接 import できる。 純関数 (orbit / follow / 投影の数式) は直接、
// ファクトリは最小 THREE スタブで検証する。

import { describe, it, expect } from 'vitest';
import {
  orbitPosition, topPosition, followPlacement, ndcToScreen,
  dragToBearing, dragToPitch, wheelRadius, zoomToRadius, createCamera3d,
  ZOOM_RADIUS_REF_ZOOM, ZOOM_RADIUS_REF_M, RADIUS_MIN, RADIUS_MAX,
} from '../lib/map3d/camera3d.js';

const ORIGIN = { x: 0, y: 0, z: 0 };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('orbitPosition: 球面オービット', () => {
  it('カメラは常に target から radius の距離にある (= 球面上)', () => {
    for (const [b, p, r] of [[0, 61, 500], [90, 30, 1200], [200, 85, 80], [-45, 10, 300]]) {
      const pos = orbitPosition({ x: 10, y: 5, z: -3 }, b, p, r);
      expect(dist(pos, { x: 10, y: 5, z: -3 })).toBeCloseTo(r, 6);
    }
  });

  it('bearing 0 はカメラを北 (-Z) 側に置く (= 初期方位 θ=π)', () => {
    const pos = orbitPosition(ORIGIN, 0, 61, 500);
    expect(pos.x).toBeCloseTo(0, 6);   // sin(π)=0 → X オフセットなし
    expect(pos.z).toBeLessThan(0);     // cos(π)=-1 → 北 (-Z) 側
  });

  it('pitch は [0.06, π*0.49] rad でクランプされる (= 真上/水平の振り切れ防止)', () => {
    // pitch 0 → phi=0.06 → cos(phi)≈1 → ほぼ真上 (y が radius に近い)
    const low = orbitPosition(ORIGIN, 0, 0, 100);
    expect(low.y).toBeGreaterThan(99);
    // pitch 90 → phi=π*0.49 → cos≈0.03 → ほぼ水平 (y がほぼ 0)
    const high = orbitPosition(ORIGIN, 0, 90, 100);
    expect(high.y).toBeLessThan(5);
  });
});

describe('topPosition: 真上俯瞰', () => {
  it('target の真上 radius に置く', () => {
    expect(topPosition({ x: 7, y: 2, z: -4 }, 300)).toEqual({ x: 7, y: 302, z: -4 });
  });
});

describe('followPlacement: 追従カメラ', () => {
  it('北向き (-Z) 走行ではカメラは後方 (+Z) かつ上方、 注視点は前方 (-Z)', () => {
    const fp = followPlacement(ORIGIN, { x: 0, y: 0, z: -1 }, 8, 1.8, 3);
    expect(fp.position).toEqual({ x: 0, y: 1.8, z: 8 });
    expect(fp.lookAt).toEqual({ x: 0, y: 0, z: -3 });
  });

  it('forward の y 成分 (坂の上下) は無視され XZ だけで方向を取る', () => {
    const flat = followPlacement(ORIGIN, { x: 1, y: 0, z: 0 }, 8, 1.8, 3);
    const climb = followPlacement(ORIGIN, { x: 1, y: 5, z: 0 }, 8, 1.8, 3);
    expect(climb.position).toEqual(flat.position);
    expect(climb.lookAt).toEqual(flat.lookAt);
  });

  it('forward が XZ で退化しても 0 除算しない', () => {
    const fp = followPlacement(ORIGIN, { x: 0, y: 1, z: 0 }, 8, 1.8, 3);
    expect(Number.isFinite(fp.position.x)).toBe(true);
    expect(Number.isFinite(fp.position.z)).toBe(true);
  });
});

describe('ndcToScreen: NDC → 画面 pixel', () => {
  it('NDC 原点は画面中央', () => {
    expect(ndcToScreen({ x: 0, y: 0, z: 0 }, 800, 600)).toEqual({ x: 400, y: 300, visible: true });
  });

  it('NDC 右上 (+1,+1) は画面右上 (= y は反転)', () => {
    expect(ndcToScreen({ x: 1, y: 1, z: 0 }, 800, 600)).toEqual({ x: 800, y: 0, visible: true });
  });

  it('NDC z > 1 (= カメラ背後) は visible:false', () => {
    expect(ndcToScreen({ x: 0, y: 0, z: 1.5 }, 800, 600).visible).toBe(false);
    expect(ndcToScreen({ x: 0, y: 0, z: 1 }, 800, 600).visible).toBe(true);
  });
});

describe('dragToBearing: 水平ドラッグ → bearing', () => {
  it('右ドラッグで bearing 増 (= 0.5 度/px)', () => {
    expect(dragToBearing(0, 10)).toBeCloseTo(5, 6);
  });
  it('0..360 で正規化される', () => {
    expect(dragToBearing(0, -10)).toBeCloseTo(355, 6);
    expect(dragToBearing(359, 10)).toBeCloseTo(4, 6);
  });
});

describe('dragToPitch: 垂直ドラッグ → pitch', () => {
  it('上ドラッグ (dy<0) で pitch 増 (= より水平)、 下ドラッグで減', () => {
    expect(dragToPitch(50, -10)).toBeGreaterThan(50);
    expect(dragToPitch(50, 10)).toBeLessThan(50);
  });
  it('結果は有限値 (= adjustPitch でクランプ済)', () => {
    expect(Number.isFinite(dragToPitch(50, -100000))).toBe(true);
    expect(Number.isFinite(dragToPitch(50, 100000))).toBe(true);
  });
});

describe('wheelRadius: ホイール → radius', () => {
  it('奥に回す (deltaY>0) と拡大 1.1、 手前は縮小 0.9', () => {
    expect(wheelRadius(100, 1, 10, 1000)).toBeCloseTo(110, 6);
    expect(wheelRadius(100, -1, 10, 1000)).toBeCloseTo(90, 6);
  });
  it('[min, max] でクランプされる', () => {
    expect(wheelRadius(5, -1, 10, 1000)).toBe(10);
    expect(wheelRadius(2000, 1, 10, 1000)).toBe(1000);
  });
});

// --- ファクトリ (最小 THREE スタブ) ---
function makeThreeStub() {
  class Vec3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    // テストは camera._ndc に既知の NDC を入れて project の結果を固定する。
    project(cam) {
      if (cam && cam._ndc) { this.x = cam._ndc.x; this.y = cam._ndc.y; this.z = cam._ndc.z; }
      return this;
    }
  }
  class PerspectiveCamera {
    constructor(fov, aspect, near, far) {
      this.fov = fov; this.aspect = aspect; this.near = near; this.far = far;
      this.position = new Vec3();
      this.up = new Vec3();
      this.lookAtArg = null;
      this.projUpdates = 0;
    }
    lookAt(a, b, c) {
      this.lookAtArg = (b === undefined) ? { x: a.x, y: a.y, z: a.z } : { x: a, y: b, z: c };
    }
    updateProjectionMatrix() { this.projUpdates += 1; }
  }
  return { Vector3: Vec3, PerspectiveCamera };
}

describe('createCamera3d: ファクトリ (THREE 注入)', () => {
  it('PerspectiveCamera を生成し camera を公開する', () => {
    const c3d = createCamera3d(makeThreeStub(), { span: 1000, aspect: 1.5 });
    expect(c3d.camera).toBeTruthy();
    expect(c3d.camera.aspect).toBe(1.5);
  });

  it('update は orbit モードでカメラをライダー位置の周囲 (球面) に置く', () => {
    const c3d = createCamera3d(makeThreeStub(), { span: 1000 });
    c3d.update({ x: 100, y: 50, z: -20 }, { x: 0, y: 0, z: -1 });
    // orbit: lookAt はライダー位置、 camera はその周囲
    expect(c3d.camera.lookAtArg).toEqual({ x: 100, y: 50, z: -20 });
    expect(dist(c3d.camera.position, { x: 100, y: 50, z: -20 })).toBeGreaterThan(0);
  });

  it('follow モードはカメラをライダー後方に置く', () => {
    const c3d = createCamera3d(makeThreeStub(), { span: 1000, mode: 'follow' });
    c3d.update({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    // 北向き走行 → カメラは後方 (+Z 側、 8m) かつ上方 (1.8m)
    expect(c3d.camera.position.z).toBeCloseTo(8, 6);
    expect(c3d.camera.position.y).toBeCloseTo(1.8, 6);
  });

  it('projectToScreen は world 座標を画面 pixel に投影する (= rider-hud 用)', () => {
    const c3d = createCamera3d(makeThreeStub(), { span: 1000 });
    c3d.resize(800, 600);
    c3d.camera._ndc = { x: 0, y: 0, z: 0.5 };  // 投影結果を画面中央に固定
    const s = c3d.projectToScreen({ x: 12, y: 3, z: -7 });
    expect(s).toEqual({ x: 400, y: 300, visible: true });
  });

  it('resize は camera の aspect と投影行列を更新する', () => {
    const c3d = createCamera3d(makeThreeStub(), { span: 1000 });
    c3d.resize(1600, 800);
    expect(c3d.camera.aspect).toBe(2);
    expect(c3d.camera.projUpdates).toBeGreaterThan(0);
  });

  it('onDrag / onWheel でカメラ位置が変わる (= マウス操作 hook)', () => {
    const c3d = createCamera3d(makeThreeStub(), { span: 1000 });
    c3d.update({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    const before = { ...c3d.camera.position };
    c3d.onDrag(200, -50);  // bearing / pitch を動かす
    c3d.onWheel(1);        // radius を変える
    c3d.update({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    const after = c3d.camera.position;
    expect(after.x !== before.x || after.y !== before.y || after.z !== before.z).toBe(true);
  });

  it('setMode / getMode でカメラモードを切り替えられる', () => {
    const c3d = createCamera3d(makeThreeStub(), { span: 1000 });
    expect(c3d.getMode()).toBe('orbit');
    c3d.setMode('top');
    expect(c3d.getMode()).toBe('top');
  });
});

describe('createCamera3d: orbit 視点の永続化 (getOrbitState / applyOrbitState)', () => {
  it('getOrbitState は現在の bearing/pitch/radius を返す', () => {
    const c3d = createCamera3d(makeThreeStub(), { span: 1000 });
    const s0 = c3d.getOrbitState();
    expect(Number.isFinite(s0.bearing)).toBe(true);
    expect(Number.isFinite(s0.pitch)).toBe(true);
    expect(Number.isFinite(s0.radius)).toBe(true);
    // onDrag / onWheel の結果が getOrbitState に反映される。
    c3d.onDrag(200, -40);
    c3d.onWheel(1);
    const s1 = c3d.getOrbitState();
    expect(s1.bearing).not.toBe(s0.bearing);
    expect(s1.radius).not.toBe(s0.radius);
  });

  it('applyOrbitState で保存済み視点を復元するとカメラ位置がその状態になる', () => {
    const a = createCamera3d(makeThreeStub(), { span: 1000 });
    a.onDrag(150, -30);
    a.onWheel(-1);
    const saved = a.getOrbitState();
    // 別インスタンスに saved を流し込むと同じカメラ位置が再現される。
    const b = createCamera3d(makeThreeStub(), { span: 1000 });
    b.applyOrbitState(saved);
    a.update({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    b.update({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    expect(b.camera.position.x).toBeCloseTo(a.camera.position.x, 6);
    expect(b.camera.position.y).toBeCloseTo(a.camera.position.y, 6);
    expect(b.camera.position.z).toBeCloseTo(a.camera.position.z, 6);
  });

  it(`applyOrbitState は radius を [${RADIUS_MIN}, ${RADIUS_MAX}] にクランプ、 bearing を 0..360 に正規化`, () => {
    const c3d = createCamera3d(makeThreeStub(), { span: 1000 });
    c3d.applyOrbitState({ bearing: 400, pitch: 50, radius: 999999 });
    const s = c3d.getOrbitState();
    expect(s.radius).toBe(RADIUS_MAX);
    expect(s.bearing).toBeCloseTo(40, 6);
    c3d.applyOrbitState({ bearing: -30, pitch: 50, radius: 1 });
    expect(c3d.getOrbitState().radius).toBe(RADIUS_MIN);
    expect(c3d.getOrbitState().bearing).toBeCloseTo(330, 6);
  });

  it('applyOrbitState(null) / 壊れた値は no-op (= 初期 default を壊さない)', () => {
    const c3d = createCamera3d(makeThreeStub(), { span: 1000 });
    const before = c3d.getOrbitState();
    c3d.applyOrbitState(null);
    c3d.applyOrbitState({ bearing: NaN, pitch: 'x' });
    expect(c3d.getOrbitState()).toEqual(before);
  });
});

describe('zoomToRadius: MapLibre zoom → オービット半径', () => {
  it('基準 zoom は基準半径に一致する', () => {
    expect(zoomToRadius(ZOOM_RADIUS_REF_ZOOM)).toBeCloseTo(ZOOM_RADIUS_REF_M, 6);
  });
  it('zoom +1 で半径が半分、 -1 で 2 倍 (= MapLibre の縮尺 2 倍則)', () => {
    expect(zoomToRadius(22)).toBeCloseTo(zoomToRadius(21) / 2, 6);
    expect(zoomToRadius(20)).toBeCloseTo(zoomToRadius(21) * 2, 6);
  });
  it('走行視点 zoom 24 は zoom 21 の 1/8 (= ライダーに肉薄)', () => {
    expect(zoomToRadius(24)).toBeCloseTo(zoomToRadius(21) / 8, 6);
  });
  it('zoom が増えるほど半径は単調減少する', () => {
    let prev = Infinity;
    for (let z = 14; z <= 26; z += 1) {
      const r = zoomToRadius(z);
      expect(r).toBeLessThan(prev);
      prev = r;
    }
  });
});

describe('createCamera3d.setCameraDefaults: 初期 zoom/pitch の反映', () => {
  it('zoom を渡すとカメラが target からその半径 (= zoomToRadius) に寄る', () => {
    const c3d = createCamera3d(makeThreeStub(), { span: 20000 });
    c3d.setCameraDefaults({ zoom: 21, pitch: 85 });
    c3d.update({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    // orbit はカメラを target から radius の球面に置く ── 半径 = zoomToRadius(21)。
    expect(dist(c3d.camera.position, { x: 0, y: 0, z: 0 })).toBeCloseTo(zoomToRadius(21), 3);
  });

  it(`遠い zoom 8 でも RADIUS_MAX (${RADIUS_MAX}m) にクランプされる (= 引きすぎ問題の解消)`, () => {
    const c3d = createCamera3d(makeThreeStub(), { span: 20000 });
    c3d.setCameraDefaults({ zoom: 8 });  // zoomToRadius(8) は 30 万 m 超
    c3d.update({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    expect(dist(c3d.camera.position, { x: 0, y: 0, z: 0 })).toBeCloseTo(RADIUS_MAX, 3);
  });

  it(`近すぎる zoom 30 でも RADIUS_MIN (${RADIUS_MIN}m) にクランプされる (= ライダーにめり込まない)`, () => {
    const c3d = createCamera3d(makeThreeStub(), { span: 20000 });
    c3d.setCameraDefaults({ zoom: 30 });
    c3d.update({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    expect(dist(c3d.camera.position, { x: 0, y: 0, z: 0 })).toBeCloseTo(RADIUS_MIN, 3);
  });

  it('zoom 未指定なら半径は変えず pitch だけ反映する', () => {
    const c3d = createCamera3d(makeThreeStub(), { span: 20000 });
    c3d.update({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    const before = dist(c3d.camera.position, { x: 0, y: 0, z: 0 });
    c3d.setCameraDefaults({ pitch: 70 });  // zoom なし
    c3d.update({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    expect(dist(c3d.camera.position, { x: 0, y: 0, z: 0 })).toBeCloseTo(before, 3);
  });
});
