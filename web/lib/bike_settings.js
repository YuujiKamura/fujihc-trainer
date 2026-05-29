// model: 自転車 / rider 物理パラメータの SoT store. localStorage と双方向同期する 5 state
// (= inertia / mass / crr / cda / power) を 1 closure に閉じ込め、 viewer-maplibre.js から
// 同名 module-global を撤去する足場 + Svelte 移行時の reactive store の素地.
// 副作用は cfg.storage R/W のみ、 DOM / window / fetch を直接参照しない (= test で fake
// storage を渡せる、 node 単独で副作用ゼロ pin 可能).

const STORAGE_PREFIX = 'fujihill.';

const KEY = Object.freeze({
  inertia: STORAGE_PREFIX + 'inertiaKg',
  mass:    STORAGE_PREFIX + 'mass',
  crr:     STORAGE_PREFIX + 'crr',
  cda:     STORAGE_PREFIX + 'cda',
  power:   STORAGE_PREFIX + 'power',
});

const DEFAULTS = Object.freeze({
  inertia: 800,    // kg 相当 (フライホイール慣性)
  mass:    88,     // kg (rider + bike)
  crr:     0.001,  // 転がり抵抗 (1‰、 競技寄り default)
  cda:     0.35,   // 空気抵抗 m² (CdA、 area=1 で c_d に 1 本化)
  power:   250,    // W (fake trainer power 初期値)
});

// UI 範囲と整合する内部値の clamp 範囲. setter は範囲外の値を min/max に丸める.
const RANGE = Object.freeze({
  inertia: { min: 0,    max: 3000 },
  mass:    { min: 60,   max: 110  },
  crr:     { min: 0,    max: 0.025 },
  cda:     { min: 0.18, max: 0.60 },
  power:   { min: 50,   max: 600  },
});

// b125c 起票時点で削除対象の旧 key. 新 key (= 上記 KEY.*) と衝突しないものだけ列挙、
// 衝突する 'fujihill.crr' / 'fujihill.cda' は除外 (= 過去ここに混ぜて削除されてた bug の解消).
const LEGACY_KEYS = Object.freeze([
  STORAGE_PREFIX + 'diff',
  STORAGE_PREFIX + 'spd',
  STORAGE_PREFIX + 'labelSize',
]);

function readNumberOr(storage, key, def) {
  if (!storage) return def;
  try {
    const v = parseFloat(storage.getItem(key));
    return Number.isFinite(v) ? v : def;
  } catch {
    return def;
  }
}

function writeNumber(storage, key, value) {
  if (!storage) return;
  try { storage.setItem(key, String(value)); } catch { /* quota / disabled storage は silent */ }
}

function clamp(value, range) {
  if (!Number.isFinite(value)) return range.min;
  return Math.min(range.max, Math.max(range.min, value));
}

/**
 * bike_settings の closure factory. localStorage と同期する 5 state を保持する.
 *
 * @param {{ storage?: { getItem(k:string):string|null, setItem(k:string,v:string):void, removeItem(k:string):void } }} [opts]
 * @returns {{
 *   getInertia(): number, setInertia(v:number): void,
 *   getMass(): number,    setMass(v:number): void,
 *   getCrr(): number,     setCrr(v:number): void,
 *   getCda(): number,     setCda(v:number): void,
 *   getPower(): number,   setPower(v:number): void,
 *   getPhysicsOpts(): {mass:number, c_rr:number, c_d:number, area:number, inertia:number},
 *   getPowerProvider(): () => number,
 *   migrateLegacyKeys(): void,
 *   snapshot(): {inertia:number, mass:number, crr:number, cda:number, power:number}
 * }}
 */
export function createBikeSettings(opts = {}) {
  const storage = opts.storage !== undefined
    ? opts.storage
    : (typeof globalThis !== 'undefined' && globalThis.localStorage ? globalThis.localStorage : null);

  let inertia = clamp(readNumberOr(storage, KEY.inertia, DEFAULTS.inertia), RANGE.inertia);
  let mass    = clamp(readNumberOr(storage, KEY.mass,    DEFAULTS.mass),    RANGE.mass);
  let crr     = clamp(readNumberOr(storage, KEY.crr,     DEFAULTS.crr),     RANGE.crr);
  let cda     = clamp(readNumberOr(storage, KEY.cda,     DEFAULTS.cda),     RANGE.cda);
  let power   = clamp(readNumberOr(storage, KEY.power,   DEFAULTS.power),   RANGE.power);

  return {
    getInertia() { return inertia; },
    setInertia(v) { inertia = clamp(v, RANGE.inertia); writeNumber(storage, KEY.inertia, inertia); },
    getMass() { return mass; },
    setMass(v) { mass = clamp(v, RANGE.mass); writeNumber(storage, KEY.mass, mass); },
    getCrr() { return crr; },
    setCrr(v) { crr = clamp(v, RANGE.crr); writeNumber(storage, KEY.crr, crr); },
    getCda() { return cda; },
    setCda(v) { cda = clamp(v, RANGE.cda); writeNumber(storage, KEY.cda, cda); },
    getPower() { return power; },
    setPower(v) { power = clamp(v, RANGE.power); writeNumber(storage, KEY.power, power); },

    // physicsState.advance に渡す形 { mass, c_rr, c_d, area, inertia }. area=1 で c_d=CdA に 1 本化.
    getPhysicsOpts() {
      return { mass, c_rr: crr, c_d: cda, area: 1, inertia };
    },

    // fake trainer に渡す power provider. slider 操作で書き換えた値を即時反映するため
    // 関数経由で渡す (= 数値直渡しだと slider 後の追随不可、 既存仕様維持).
    getPowerProvider() {
      return () => power;
    },

    // 旧 key (= 新 key と衝突しない 3 件) を localStorage から消す.
    // 新 key (= fujihill.crr / fujihill.cda) との衝突を回避してる (起票時に混入した bug の解消).
    migrateLegacyKeys() {
      if (!storage) return;
      for (const k of LEGACY_KEYS) {
        try { storage.removeItem(k); } catch { /* silent */ }
      }
    },

    snapshot() {
      return { inertia, mass, crr, cda, power };
    },
  };
}

// test 用の公開定数 (= viewer test が直接参照する用途).
export const BIKE_SETTINGS_KEYS = KEY;
export const BIKE_SETTINGS_DEFAULTS = DEFAULTS;
export const BIKE_SETTINGS_RANGE = RANGE;
export const BIKE_SETTINGS_LEGACY_KEYS = LEGACY_KEYS;
