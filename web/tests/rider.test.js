// brief 35: Rider (= Terrain 内のある位置に存在する主体) の unit test.
//
// 役割確認:
// - distanceTraveled / speed / paused / active / cadence / power / hr / spinAngle / trkpts を保持
// - 「今ここ」 は Terrain への query 経由で取れる (= position getter / snapshot.position)
// - tick(dt) で 1 step 進む、 paused なら no-op
// - placeAtIdx / placeAtDistance で瞬間移動
// - setSpeed / setSensors で外部入力
// - seekToward でスムーズ移動 (= 旧 ride_state.seekToward の移送)
// - trkpts 蓄積 (= 旧 ride_state.appendTrkpt の移送)

import { describe, it, expect } from 'vitest';
import { createTerrain } from '../lib/terrain.js';
import { createRider } from '../lib/rider.js';

function buildNorthCourse(n = 10) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push({
      lat: 35.4 + i * 0.001,
      lon: 138.7,
      distance_m: i * 111,
      elevation_m: 1000 + i * 10,
      slope_pct: i === 0 ? 0 : 5 + i * 0.1,
    });
  }
  return arr;
}

function buildSimpleMetreCourse(n = 11) {
  // 1m 等間隔 11 点 (0..10m) — seek / 補間精度確認用
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push({ lat: 35 + i * 0.0001, lon: 138, distance_m: i, elevation_m: 100 + i, slope_pct: 1 });
  }
  return arr;
}

describe('createRider', () => {
  it('terrain が無いと TypeError', () => {
    expect(() => createRider({})).toThrow(TypeError);
    expect(() => createRider({ terrain: null })).toThrow(TypeError);
  });

  describe('initial state', () => {
    it('初期は paused / inactive / distanceTraveled=0 / speed=0', () => {
      const t = createTerrain({ course: buildNorthCourse() });
      const r = createRider({ terrain: t });
      expect(r.distanceTraveled).toBe(0);
      expect(r.speed).toBe(0);
      expect(r.paused).toBe(true);
      expect(r.active).toBe(false);
      expect(r.atGoal).toBe(false);
    });
  });

  describe('start / end / pause / resume', () => {
    it('start で active=true, paused=false, distance=0', () => {
      const r = createRider({ terrain: createTerrain({ course: buildNorthCourse() }) });
      r.placeAtDistance(500);
      r.start();
      expect(r.active).toBe(true);
      expect(r.paused).toBe(false);
      expect(r.distanceTraveled).toBe(0);
    });

    it('end で paused=true, active=false (位置は保持)', () => {
      const r = createRider({ terrain: createTerrain({ course: buildNorthCourse() }) });
      r.start();
      r.setSpeed(10);
      r.tick(1);
      const before = r.distanceTraveled;
      r.end();
      expect(r.paused).toBe(true);
      expect(r.active).toBe(false);
      expect(r.distanceTraveled).toBe(before);
    });

    it('pause / resume / togglePause', () => {
      const r = createRider({ terrain: createTerrain({ course: buildNorthCourse() }) });
      r.start();
      expect(r.paused).toBe(false);
      r.pause();
      expect(r.paused).toBe(true);
      r.resume();
      expect(r.paused).toBe(false);
      r.togglePause();
      expect(r.paused).toBe(true);
    });
  });

  describe('placeAtIdx / placeAtDistance', () => {
    it('placeAtIdx: 指定 idx の距離に移動 (= position も即更新)', () => {
      const t = createTerrain({ course: buildNorthCourse(10) });
      const r = createRider({ terrain: t });
      r.placeAtIdx(3);
      expect(r.distanceTraveled).toBe(333);
      const pos = r.position;
      expect(pos.lat).toBeCloseTo(35.403, 5);
      expect(pos.segmentIdx).toBe(3);
    });

    it('placeAtIdx は paused/active flag を変えない (= ride 中でも観るモードでも呼べる)', () => {
      const t = createTerrain({ course: buildNorthCourse(10) });
      const r = createRider({ terrain: t });
      r.start();
      expect(r.active).toBe(true);
      r.placeAtIdx(5);
      expect(r.active).toBe(true);  // 維持
      expect(r.paused).toBe(false);
    });

    it('placeAtDistance: 任意 distance に移動', () => {
      const t = createTerrain({ course: buildNorthCourse(10) });
      const r = createRider({ terrain: t });
      r.placeAtDistance(250);
      expect(r.distanceTraveled).toBe(250);
      expect(r.position.segmentIdx).toBe(2);
    });

    it('placeAtIdx: 範囲外 idx は clamp', () => {
      const t = createTerrain({ course: buildNorthCourse(10) });
      const r = createRider({ terrain: t });
      r.placeAtIdx(-5);
      expect(r.distanceTraveled).toBe(0);
      r.placeAtIdx(99999);
      expect(r.distanceTraveled).toBe(t.totalDistance);
    });
  });

  describe('startFromIdx', () => {
    it('placeAtIdx + resume + clear trkpts の合成 (= 観るモードの 1 行 helper)', () => {
      const t = createTerrain({ course: buildNorthCourse(10) });
      const r = createRider({ terrain: t });
      r.appendTrkpt({ power: 100 });
      r.startFromIdx(5);
      expect(r.distanceTraveled).toBe(555);
      expect(r.active).toBe(true);
      expect(r.paused).toBe(false);
      expect(r.getTrkpts()).toEqual([]);
    });
  });

  describe('setSpeed / tick', () => {
    it('setSpeed で速度をセット、 tick(dt) で distanceTraveled が dt*speed 増える', () => {
      const r = createRider({ terrain: createTerrain({ course: buildNorthCourse() }) });
      r.start();
      r.setSpeed(20 / 3.6);  // 20 km/h
      r.tick(1.0);
      expect(r.distanceTraveled).toBeCloseTo(20 / 3.6, 3);
    });

    it('paused 中は tick で進まない', () => {
      const r = createRider({ terrain: createTerrain({ course: buildNorthCourse() }) });
      r.start();
      r.setSpeed(20 / 3.6);
      r.pause();
      r.tick(1.0);
      expect(r.distanceTraveled).toBe(0);
    });

    it('dt<=0 は no-op', () => {
      const r = createRider({ terrain: createTerrain({ course: buildNorthCourse() }) });
      r.start();
      r.setSpeed(20 / 3.6);
      r.tick(0);
      r.tick(-1);
      expect(r.distanceTraveled).toBe(0);
    });

    it('speed=0 は tick しても進まない (= 待機中の fake state)', () => {
      const r = createRider({ terrain: createTerrain({ course: buildNorthCourse() }) });
      r.start();
      r.setSpeed(0);
      r.tick(1.0);
      expect(r.distanceTraveled).toBe(0);
    });

    it('speedMultiplier option で速度倍率 (= viewer の speedMult 経路)', () => {
      const r = createRider({ terrain: createTerrain({ course: buildNorthCourse() }) });
      r.start();
      r.setSpeed(10);
      r.tick(1.0, { speedMultiplier: 2.0 });
      expect(r.distanceTraveled).toBeCloseTo(20, 3);
    });

    it('totalDistance を超えると atGoal=true, 以降の tick は no-op', () => {
      const t = createTerrain({ course: buildNorthCourse(5) });
      const r = createRider({ terrain: t });
      r.start();
      r.setSpeed(1000);
      r.tick(1.0);
      expect(r.distanceTraveled).toBe(t.totalDistance);
      expect(r.atGoal).toBe(true);
      const at = r.distanceTraveled;
      r.tick(1.0);
      expect(r.distanceTraveled).toBe(at);
    });

    it('segment 跨ぐ tick で position.heading / segmentIdx が更新される', () => {
      const t = createTerrain({ course: buildNorthCourse(10) });
      const r = createRider({ terrain: t });
      r.start();
      r.setSpeed(250);
      r.tick(1.0);
      const pos = r.position;
      expect(r.distanceTraveled).toBe(250);
      expect(pos.segmentIdx).toBe(2);
      expect(pos.heading).toBeCloseTo(0, 1);  // 北向き course
    });
  });

  describe('setSensors', () => {
    it('cadence / power / hr をまとめてセット可', () => {
      const r = createRider({ terrain: createTerrain({ course: buildNorthCourse() }) });
      r.setSensors({ power: 200, cad: 85, hr: 142 });
      expect(r.power).toBe(200);
      expect(r.cadence).toBe(85);
      expect(r.hr).toBe(142);
    });

    it('部分更新 (= undefined は変更しない)', () => {
      const r = createRider({ terrain: createTerrain({ course: buildNorthCourse() }) });
      r.setSensors({ power: 200, cad: 85, hr: 142 });
      r.setSensors({ hr: 150 });
      expect(r.power).toBe(200);  // 維持
      expect(r.cadence).toBe(85);
      expect(r.hr).toBe(150);
    });

    it('cadence rpm で spinAngle が tick ごとに進む (= rpm * 2π/60 * dt)', () => {
      const r = createRider({ terrain: createTerrain({ course: buildNorthCourse() }) });
      r.start();
      r.setSpeed(5);
      r.setSensors({ cad: 60 });  // 60 rpm = 1 rev/s = 2π rad/s
      r.tick(1.0);
      expect(r.spinAngle).toBeCloseTo(2 * Math.PI, 3);
    });

    it('cadence=0 では spinAngle 不変', () => {
      const r = createRider({ terrain: createTerrain({ course: buildNorthCourse() }) });
      r.start();
      r.setSpeed(5);
      r.setSensors({ cad: 0 });
      r.tick(1.0);
      expect(r.spinAngle).toBe(0);
    });
  });

  describe('seekToward (= スムーズ移動、 旧 ride_state.seekToward)', () => {
    it('前進: 残差超で着地、 未到達は false', () => {
      const r = createRider({ terrain: createTerrain({ course: buildSimpleMetreCourse() }) });
      r.start();
      expect(r.seekToward(10, 0.1, 50)).toBe(false);  // 5m 進む
      expect(r.distanceTraveled).toBeCloseTo(5, 5);
      expect(r.seekToward(10, 0.1, 50)).toBe(true);   // 着地
      expect(r.distanceTraveled).toBeCloseTo(10, 5);
    });

    it('後退対応', () => {
      const r = createRider({ terrain: createTerrain({ course: buildSimpleMetreCourse() }) });
      r.start();
      r.placeAtDistance(8);
      expect(r.seekToward(2, 0.1, 50)).toBe(false);
      expect(r.distanceTraveled).toBeCloseTo(3, 5);
    });

    it('paused は no-op', () => {
      const r = createRider({ terrain: createTerrain({ course: buildSimpleMetreCourse() }) });
      r.start();
      r.pause();
      expect(r.seekToward(10, 1, 100)).toBe(false);
      expect(r.distanceTraveled).toBe(0);
    });
  });

  describe('trkpts', () => {
    it('appendTrkpt で現位置を 1 件 push', () => {
      const r = createRider({ terrain: createTerrain({ course: buildNorthCourse() }) });
      r.start();
      r.placeAtDistance(222);  // idx=2
      r.appendTrkpt({ t: '2026-05-15T07:30:00Z', power: 210, cad: 85, hr: 142 });
      const pts = r.getTrkpts();
      expect(pts.length).toBe(1);
      expect(pts[0].t).toBe('2026-05-15T07:30:00Z');
      expect(pts[0].power).toBe(210);
      expect(pts[0].cad).toBe(85);
      expect(pts[0].hr).toBe(142);
      expect(pts[0].lat).toBeCloseTo(35.402, 5);
    });

    it('tick で appendTrkpt: true オプション → trkpt 1 件 push', () => {
      const r = createRider({ terrain: createTerrain({ course: buildNorthCourse() }) });
      r.start();
      r.setSpeed(5);
      r.setSensors({ power: 200, cad: 80, hr: 140 });
      r.tick(1.0, { appendTrkpt: true });
      expect(r.getTrkpts().length).toBe(1);
      expect(r.getTrkpts()[0].power).toBe(200);
    });

    it('tick で appendTrkpt: false (default) → trkpt 追加なし', () => {
      const r = createRider({ terrain: createTerrain({ course: buildNorthCourse() }) });
      r.start();
      r.setSpeed(5);
      r.tick(1.0);
      r.tick(1.0);
      expect(r.getTrkpts()).toEqual([]);
    });

    it('start で trkpts もクリア', () => {
      const r = createRider({ terrain: createTerrain({ course: buildNorthCourse() }) });
      r.start();
      r.appendTrkpt({ power: 100 });
      expect(r.getTrkpts().length).toBe(1);
      r.start();
      expect(r.getTrkpts()).toEqual([]);
    });

    it('getTrkpts は immutable copy (= 外側 mutation 影響なし)', () => {
      const r = createRider({ terrain: createTerrain({ course: buildNorthCourse() }) });
      r.start();
      r.appendTrkpt({ power: 200 });
      const a = r.getTrkpts();
      a[0].power = 9999;
      a.push({ x: 'tampered' });
      const b = r.getTrkpts();
      expect(b.length).toBe(1);
      expect(b[0].power).toBe(200);
    });
  });

  describe('snapshot', () => {
    it('全 state + position を immutable copy で返す', () => {
      const t = createTerrain({ course: buildNorthCourse(10) });
      const r = createRider({ terrain: t });
      r.start();
      r.placeAtIdx(3);
      r.setSpeed(5);
      r.setSensors({ power: 200, cad: 85, hr: 140 });
      const snap = r.snapshot();
      expect(snap.distance).toBe(333);
      expect(snap.speed).toBe(5);
      expect(snap.active).toBe(true);
      expect(snap.cadence).toBe(85);
      expect(snap.power).toBe(200);
      expect(snap.hr).toBe(140);
      expect(snap.position.lat).toBeCloseTo(35.403, 5);
      expect(snap.position.segmentIdx).toBe(3);
      // mutation 影響なし
      snap.distance = 99999;
      snap.position.lat = 99;
      expect(r.snapshot().distance).toBe(333);
      expect(r.snapshot().position.lat).toBeCloseTo(35.403, 5);
    });
  });

  describe('reset', () => {
    it('位置 / spinAngle / trkpts をクリア、 paused/active は変えない', () => {
      const r = createRider({ terrain: createTerrain({ course: buildNorthCourse() }) });
      r.start();
      r.setSpeed(5);
      r.setSensors({ cad: 60 });
      r.tick(1.0, { appendTrkpt: true });
      expect(r.distanceTraveled).toBeGreaterThan(0);
      expect(r.spinAngle).toBeGreaterThan(0);
      expect(r.getTrkpts().length).toBe(1);
      r.reset();
      expect(r.distanceTraveled).toBe(0);
      expect(r.spinAngle).toBe(0);
      expect(r.getTrkpts()).toEqual([]);
      expect(r.active).toBe(true);  // 維持
      expect(r.paused).toBe(false);
    });
  });
});
