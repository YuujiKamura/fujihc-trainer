// 担当 D: test-rig.html の entry point.
//
// 実走 viewer の MapLibre / Three.js / pmtiles / BLE / IndexedDB を**全部抜いて**、
// rider + 物理 (bike_physics) + camera 追従だけが grid 背景上で動く検証 viewer を駆動する.
//
// 既存 lib/{terrain, rider, bike_physics, heading}.js を read-only で import するだけ、
// 既存 viewer 本体 (viewer-map3d.js) には触らない.

import { createTerrain } from './terrain.js';
import { createRider } from './rider.js';
import { applyPhysicsStep } from './bike_physics.js';
import {
  drawGrid, drawCoursePath, drawRiderMarker,
  worldToScreen, latLonToEastNorth,
} from './test_rig_grid.js';
import {
  generateCourse, loadFujiPrefix, COURSE_KINDS,
} from './test_rig_synthetic_course.js';

const PX_PER_METER = 2.0;
const DT_CLAMP = 0.1; // tab 非アクティブ復帰時の大 dt を抑える

const state = {
  terrain: null,
  rider: null,
  course: null,
  courseName: 'flat',
  power_w: 200,
  mass_kg: 88,
  speedMult: 1.0,
  paused: true,
  startTime: 0,
  lastFrame: 0,
  smoothBearing: 0,
  fpsAcc: 0,
  fpsCount: 0,
  fpsValue: 0,
};

function $(id) { return document.getElementById(id); }

async function loadCourse(kind) {
  if (kind === 'fuji-prefix') {
    try {
      return await loadFujiPrefix({ count: 500 });
    } catch (e) {
      console.warn('[test-rig] fuji-prefix load failed, fallback to flat', e);
      return generateCourse('flat');
    }
  }
  return generateCourse(kind);
}

async function setupCourse(kind) {
  state.courseName = kind;
  state.course = await loadCourse(kind);
  state.terrain = createTerrain({ course: state.course });
  state.rider = createRider({ terrain: state.terrain });
  state.rider.start();
  state.rider.pause();
  state.paused = true;
  state.startTime = 0;
  const startPos = state.terrain.getPositionAtDistance(0);
  state.smoothBearing = startPos.heading;
  const nameEl = $('rig-course-name');
  const lenEl = $('rig-course-len');
  if (nameEl) nameEl.textContent = kind;
  if (lenEl) lenEl.textContent = Math.round(state.terrain.totalDistance).toString();
}

function step(dt) {
  if (state.paused || !state.rider || !state.terrain) return;
  // 物理: rider の現速度 + 現勾配 + slider power/mass で次の速度を出す
  const v = state.rider.speed;
  const slope = state.rider.position.slope_pct;
  const newV = applyPhysicsStep(v, dt, state.power_w, slope, { mass: state.mass_kg });
  state.rider.setSpeed(newV);
  state.rider.tick(dt, { speedMultiplier: state.speedMult, appendTrkpt: false });

  // bearing 平滑 (= 急な分岐で camera がガクつかないように 10%/frame で追随)
  const target = state.rider.position.heading;
  let diff = ((target - state.smoothBearing + 540) % 360) - 180;
  state.smoothBearing = (state.smoothBearing + diff * 0.15 + 360) % 360;
}

function draw() {
  const canvas = $('rig-canvas');
  if (!canvas) return;
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const riderPos = state.rider ? state.rider.position : { lat: 0, lon: 0 };
  const proj = {
    width: cssW, height: cssH,
    bearingDeg: state.smoothBearing,
    pxPerMeter: PX_PER_METER,
  };

  drawGrid(ctx, {
    ...proj,
    riderLat: riderPos.lat, riderLon: riderPos.lon,
  });
  if (state.course) {
    drawCoursePath(ctx, state.course, {
      ...proj,
      riderLat: riderPos.lat, riderLon: riderPos.lon,
    });
  }
  drawRiderMarker(ctx, { width: cssW, height: cssH });
}

function hud(dt) {
  if (!state.rider || !state.terrain) return;
  const r = state.rider;
  const pos = r.position;
  const elapsed = state.startTime
    ? (performance.now() - state.startTime) / 1000
    : 0;
  set('rig-time', elapsed.toFixed(1));
  set('rig-dist', r.distanceTraveled.toFixed(1));
  set('rig-speed', (r.speed * 3.6).toFixed(1));
  set('rig-speed-mps', r.speed.toFixed(3));
  set('rig-slope', pos.slope_pct.toFixed(2));
  set('rig-lat', pos.lat.toFixed(6));
  set('rig-lon', pos.lon.toFixed(6));
  set('rig-cam-lat', pos.lat.toFixed(6));
  set('rig-cam-lon', pos.lon.toFixed(6));
  set('rig-drift', '0.00');
  set('rig-brng', state.smoothBearing.toFixed(1));
  set('rig-trkn', r.getTrkpts().length.toString());
  set('rig-trkuniq', new Set(r.getTrkpts().map((p) => `${p.lat},${p.lon}`)).size.toString());

  state.fpsAcc += dt;
  state.fpsCount += 1;
  if (state.fpsAcc >= 0.5) {
    state.fpsValue = Math.round(state.fpsCount / state.fpsAcc);
    set('rig-fps', state.fpsValue.toString());
    state.fpsAcc = 0;
    state.fpsCount = 0;
  }
}

function set(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function frame(now) {
  const t = (typeof now === 'number') ? now : performance.now();
  const dt = state.lastFrame ? Math.min(DT_CLAMP, (t - state.lastFrame) / 1000) : 0;
  state.lastFrame = t;
  step(dt);
  draw();
  hud(dt);
  requestAnimationFrame(frame);
}

function bindControls() {
  const sel = $('rig-course-select');
  if (sel) {
    // 既知 kind のみ反映 (= HTML 改竄からの自衛)
    sel.addEventListener('change', async (e) => {
      const v = e.target.value;
      if (!COURSE_KINDS.includes(v)) return;
      await setupCourse(v);
    });
  }
  bindSlider('rig-power', 'rig-power-v', (n) => { state.power_w = n; }, (n) => n.toString());
  bindSlider('rig-mass', 'rig-mass-v', (n) => { state.mass_kg = n; }, (n) => n.toString());
  bindSlider('rig-speed-mult', 'rig-speed-mult-v', (n) => { state.speedMult = n; }, (n) => n.toFixed(1));

  on('rig-start', 'click', () => {
    if (!state.rider) return;
    state.paused = false;
    state.rider.resume();
    if (!state.startTime) state.startTime = performance.now();
  });
  on('rig-pause', 'click', () => {
    state.paused = true;
    if (state.rider) state.rider.pause();
  });
  on('rig-reset', 'click', async () => {
    await setupCourse(state.courseName);
  });
}

function bindSlider(inputId, outId, setter, fmt) {
  const inp = $(inputId);
  const out = $(outId);
  if (!inp) return;
  const update = () => {
    const n = Number(inp.value);
    if (Number.isFinite(n)) {
      setter(n);
      if (out) out.textContent = fmt(n);
    }
  };
  inp.addEventListener('input', update);
  update();
}

function on(id, ev, fn) {
  const el = $(id);
  if (el) el.addEventListener(ev, fn);
}

async function main() {
  bindControls();
  await setupCourse('flat');
  requestAnimationFrame(frame);
}

// browser でのみ実走、 node test からは import されない想定だが念のためガード.
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }
}

// test や debug 用の export (= 直接呼ぶ必要が出たとき用、 通常は触らない)
export const __testing = {
  getState: () => state,
  step,
  setupCourse,
};
