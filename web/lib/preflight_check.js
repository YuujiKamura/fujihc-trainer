// preflight_check: ride 開始前に保存予定データの validation を行う pure module.
// 2 時間走った ride が保存壊れる事故 (= 2026-05-15) の事前検出層。
// ride 開始 button 押下 → ここで checks → panel に流して user に確認 → OK で開始。
//
// 設計:
// - 全 check 関数は同期 + pure (= 入力 → {ok, level, message, value})
// - level: 'ok' | 'warn' | 'fail' の 3 値、 fail があれば開始不可
// - IndexedDB の書き込み可否だけ async (= test put/get 1 回)、 別関数で分離
// - 過去 ride の異常 flag は lat unique 数 / 距離 0 を見る (= debug HUD の validation と同 logic)

/**
 * course の基本情報を 1 行ずつ check.
 * @param {Array<{lat:number, lon:number, distance_m:number}>} course
 * @returns {Array<{key:string, level:'ok'|'warn'|'fail', label:string, value:string}>}
 */
export function checkCourse(course) {
  const out = [];
  if (!Array.isArray(course) || course.length === 0) {
    out.push({ key: 'course', level: 'fail', label: 'コース', value: '未ロード' });
    return out;
  }
  const start = course[0];
  const end = course[course.length - 1];
  const totalKm = (end.distance_m || 0) / 1000;
  // 起点と終点が極端に近い (= 起点固定 bug の signature) を warn
  const dLat = Math.abs((end.lat || 0) - (start.lat || 0));
  const dLon = Math.abs((end.lon || 0) - (start.lon || 0));
  const startEndCloseness = dLat + dLon;
  const closeFlag = startEndCloseness < 1e-5 && course.length > 100;
  out.push({
    key: 'course-points',
    level: course.length >= 2 ? 'ok' : 'fail',
    label: 'コース点数',
    value: `${course.length} 点`,
  });
  out.push({
    key: 'course-distance',
    level: totalKm > 0.1 ? 'ok' : 'fail',
    label: '総距離',
    value: `${totalKm.toFixed(2)} km`,
  });
  out.push({
    key: 'course-endpoints',
    level: closeFlag ? 'warn' : 'ok',
    label: '起点 / 終点',
    value: `${start.lat?.toFixed?.(5)},${start.lon?.toFixed?.(5)} → ${end.lat?.toFixed?.(5)},${end.lon?.toFixed?.(5)}`,
  });
  return out;
}

/**
 * trainer 接続状態と直前 sensor 値を check.
 * @param {{connected:boolean, power:number|null, cadence:number|null, hr:number|null}} state
 * @returns {Array<{key, level, label, value}>}
 */
export function checkTrainer(state) {
  const out = [];
  const s = state || {};
  out.push({
    key: 'trainer',
    level: s.connected ? 'ok' : 'fail',
    label: 'trainer 接続',
    value: s.connected ? '接続済' : '未接続',
  });
  // power / cadence / hr は connected の時のみ意味あり、 未接続なら省略
  if (s.connected) {
    out.push({
      key: 'power',
      level: Number.isFinite(s.power) ? 'ok' : 'warn',
      label: 'power',
      value: Number.isFinite(s.power) ? `${s.power} W` : '未受信',
    });
    out.push({
      key: 'cadence',
      level: Number.isFinite(s.cadence) ? 'ok' : 'warn',
      label: 'cadence',
      value: Number.isFinite(s.cadence) ? `${s.cadence} rpm` : '未受信',
    });
    out.push({
      key: 'hr',
      level: Number.isFinite(s.hr) ? 'ok' : 'warn',
      label: '心拍',
      value: Number.isFinite(s.hr) ? `${s.hr} bpm` : '未受信',
    });
  }
  return out;
}

/**
 * 心拍計 (別系) の接続状態を check. trainer 内蔵 HR と分離した独立 HRM 用.
 * @param {{available?:boolean, connected?:boolean}} state
 */
export function checkHrm(state) {
  const s = state || {};
  if (!s.available) {
    // 別系 HRM を使う構成じゃない場合は項目自体を出さない (= 空 array)
    return [];
  }
  return [{
    key: 'hrm',
    level: s.connected ? 'ok' : 'warn',
    label: '心拍計 (別接続)',
    value: s.connected ? '接続済' : '未接続',
  }];
}

/**
 * 過去 ride 件数 + 直近 ride の異常 flag.
 * @param {Array<{summary?:object, trkpts?:Array}>} pastRides
 */
export function checkPastRides(pastRides) {
  const out = [];
  const rides = Array.isArray(pastRides) ? pastRides : [];
  out.push({
    key: 'past-count',
    level: 'ok',
    label: '過去 ride 件数',
    value: `${rides.length} 件`,
  });
  // 直近 1 件の異常 flag (= lat unique < 5 / distance 0 / trkpts 空)
  if (rides.length > 0) {
    const latest = rides[0];
    const trkpts = Array.isArray(latest.trkpts) ? latest.trkpts : [];
    const latSet = new Set();
    for (const p of trkpts) {
      if (Number.isFinite(p.lat)) latSet.add(Math.round(p.lat * 1e6));
    }
    const latUnique = latSet.size;
    const distM = Number(latest.summary?.distance_m || 0);
    const flags = [];
    if (latUnique < 5 && trkpts.length > 20) flags.push(`lat固定 (unique=${latUnique})`);
    if (distM < 100 && trkpts.length > 20) flags.push('距離 0');
    if (trkpts.length === 0) flags.push('trkpts 空');
    if (flags.length > 0) {
      out.push({
        key: 'past-latest-flag',
        level: 'warn',
        label: '直近 ride 異常',
        value: flags.join(' / '),
      });
    }
  }
  return out;
}

/**
 * consent (history / strava) 状態を check.
 * @param {{history:boolean, strava:boolean}} flags
 */
export function checkConsent(flags) {
  const f = flags || {};
  return [
    {
      key: 'consent-history',
      level: 'ok',
      label: 'history 保存',
      value: f.history ? 'ON' : 'OFF',
    },
    {
      key: 'consent-strava',
      level: 'ok',
      label: 'Strava 連携',
      value: f.strava ? 'ON' : 'OFF',
    },
  ];
}

/**
 * IndexedDB に test put / get で書き込み可否を確認.
 * @param {{idbFactory?:IDBFactory, dbName?:string}} [opts]
 * @returns {Promise<{key, level, label, value}>}
 */
export async function checkIndexedDB(opts = {}) {
  const idb = opts.idbFactory || (typeof globalThis !== 'undefined' ? globalThis.indexedDB : null);
  if (!idb) {
    return { key: 'idb', level: 'fail', label: 'IndexedDB', value: '利用不可' };
  }
  const dbName = opts.dbName || 'fujihill-preflight-probe';
  const storeName = 'probe';
  try {
    const db = await new Promise((resolve, reject) => {
      const req = idb.open(dbName, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(storeName)) d.createObjectStore(storeName);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('open failed'));
      req.onblocked = () => reject(new Error('blocked'));
    });
    const probeKey = `probe-${Date.now()}`;
    const probeValue = { ts: Date.now() };
    await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(probeValue, probeKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('put failed'));
    });
    const got = await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(probeKey);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('get failed'));
    });
    db.close();
    // probe DB は残してもよい (= 次回起動も同じ手順で再利用、 削除は best-effort)
    try {
      const delReq = idb.deleteDatabase(dbName);
      await new Promise((resolve) => {
        delReq.onsuccess = () => resolve();
        delReq.onerror = () => resolve();
        delReq.onblocked = () => resolve();
      });
    } catch { /* ignore */ }
    return {
      key: 'idb',
      level: got && got.ts === probeValue.ts ? 'ok' : 'fail',
      label: 'IndexedDB',
      value: got && got.ts === probeValue.ts ? '書込/読出 OK' : '読出失敗',
    };
  } catch (err) {
    return { key: 'idb', level: 'fail', label: 'IndexedDB', value: `エラー: ${err.message || err}` };
  }
}

/**
 * 全 check を集約して 1 つの結果を返す.
 * 同期 part (course / trainer / hrm / past / consent) + async part (idb).
 *
 * @param {{
 *   course: Array,
 *   trainer: {connected:boolean, power:any, cadence:any, hr:any},
 *   hrm?: {available:boolean, connected:boolean},
 *   pastRides?: Array,
 *   consent?: {history:boolean, strava:boolean},
 *   idbFactory?: IDBFactory,
 * }} input
 * @returns {Promise<{
 *   items: Array<{key, level, label, value}>,
 *   level: 'ok'|'warn'|'fail',
 * }>}
 */
export async function runPreflight(input) {
  const i = input || {};
  const items = [];
  items.push(...checkCourse(i.course));
  items.push(...checkTrainer(i.trainer));
  items.push(...checkHrm(i.hrm));
  items.push(...checkPastRides(i.pastRides));
  items.push(...checkConsent(i.consent));
  const idbItem = await checkIndexedDB({ idbFactory: i.idbFactory });
  items.push(idbItem);
  return { items, level: aggregateLevel(items) };
}

/**
 * 全 item の level から最悪値を取る. fail > warn > ok.
 */
export function aggregateLevel(items) {
  if (!Array.isArray(items)) return 'ok';
  let worst = 'ok';
  for (const it of items) {
    if (it.level === 'fail') return 'fail';
    if (it.level === 'warn') worst = 'warn';
  }
  return worst;
}
