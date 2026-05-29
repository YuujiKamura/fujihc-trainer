// save_summary: ride 終了時に「実際に保存される値」を trkpts + course から導出する pure module.
// 2 時間走った ride が壊れて保存される事故 (= 2026-05-15 起点固定 bug) の事後検出層。
// postride-overlay の冒頭で summary を表示、 異常時は abort confirm。
// b129: 獲得標高 calcElevationGainM を追加 (= viewer-map3d.js の buildRideSummary が呼ぶ).

/**
 * trkpts から獲得標高 (m) を計算する。 下りは 0 として扱う、 平地も 0。
 * noise 抑制のため、 連続 trkpt 間の ele 差が threshold (default 0.5m) 未満は無視。
 * GPS / 気圧センサーの jitter (±0.5m 程度) を水増ししない設計。
 *
 * @param {Array<{ele?:number}>} trkpts
 * @param {{threshold?: number}} [opts]
 * @returns {number}
 */
export function calcElevationGainM(trkpts, opts = {}) {
  if (!Array.isArray(trkpts) || trkpts.length < 2) return 0;
  const threshold = Number.isFinite(opts?.threshold) ? opts.threshold : 0.5;
  let gain = 0;
  let prev = null;
  for (const p of trkpts) {
    const ele = Number(p?.ele);
    if (!Number.isFinite(ele)) continue;
    if (prev != null) {
      const dz = ele - prev;
      if (dz >= threshold) gain += dz;
    }
    prev = ele;
  }
  return Math.round(gain);
}

/**
 * trkpts と course から保存予定 summary を build する.
 * @param {{
 *   trkpts: Array<{t:string, lat:number, lon:number, ele:number, power:number|null, cad:number|null, hr:number|null}>,
 *   course: Array<{lat:number, lon:number, distance_m:number}>,
 *   rideStartedAt?: number,
 *   durationS?: number,
 *   distanceM?: number,
 *   nowMs?: number,
 * }} input
 * @returns {object}
 */
export function buildSaveSummary(input) {
  const i = input || {};
  const trkpts = Array.isArray(i.trkpts) ? i.trkpts : [];
  const course = Array.isArray(i.course) ? i.course : [];
  const startMs = Number.isFinite(i.rideStartedAt) ? i.rideStartedAt : null;
  const nowMs = Number.isFinite(i.nowMs) ? i.nowMs : (typeof performance !== 'undefined' ? performance.now() : Date.now());

  // 累積距離 (= 末尾 - 先頭、 trkpts には distance を持たないため lat/lon ベース ではなく
  // course の最後の distance_m を使うのは「目標距離」、 ride 中の累積は trkpts 間 distance を
  // ハバーシン的に sum するのが正確だが、 ここは ride 中に rideState.snapshot().distance を
  // 別経路で持っているので入力 distanceM が渡された場合はそちらを優先).
  const distanceM = Number.isFinite(i.distanceM) ? i.distanceM : haversineSumMeters(trkpts);

  // duration: 呼び出し側が確定値 durationS を渡せばそれを優先する。 ride 終了後は viewer 側の
  // rideStartedAt が null になっているため、 終了時に確定した走行時間を durationS で渡す。
  // 未指定なら rideStartedAt から計算 (= ride 中の表示用 / 旧 caller 後方互換)。
  const durationS = Number.isFinite(i.durationS)
    ? Math.max(0, Math.round(i.durationS))
    : (startMs !== null ? Math.max(0, Math.round((nowMs - startMs) / 1000)) : 0);

  // power / cad / hr 統計 (null を除外)
  const powerStats = numStats(trkpts.map((p) => p.power));
  const cadStats = numStats(trkpts.map((p) => p.cad));
  const hrStats = numStats(trkpts.map((p) => p.hr));

  // lat unique 数 (= 1e6 精度で round)
  const latSet = new Set();
  let latSpread = 0;
  let latMin = Infinity, latMax = -Infinity;
  for (const p of trkpts) {
    if (Number.isFinite(p.lat)) {
      latSet.add(Math.round(p.lat * 1e6));
      if (p.lat < latMin) latMin = p.lat;
      if (p.lat > latMax) latMax = p.lat;
    }
  }
  if (latMin !== Infinity && latMax !== -Infinity) {
    latSpread = latMax - latMin;
  }
  const latUnique = latSet.size;

  // 末尾 lat が起点 lat と異なるか
  const startLat = course.length > 0 ? course[0].lat : null;
  const startLon = course.length > 0 ? course[0].lon : null;
  const lastTrkpt = trkpts.length > 0 ? trkpts[trkpts.length - 1] : null;
  const endLat = lastTrkpt ? lastTrkpt.lat : null;
  const endLon = lastTrkpt ? lastTrkpt.lon : null;
  const endDiffersFromStart = (endLat !== null && startLat !== null) ? Math.abs(endLat - startLat) > 1e-6 : false;

  // 起点固定 bug 検出: 末尾 lat と起点 lat の差を m に換算 (= ~111km/deg)
  const startEndDiffM = (endLat !== null && startLat !== null)
    ? Math.abs(endLat - startLat) * 111000
    : null;

  return {
    duration_s: durationS,
    duration_hms: hmsFromSeconds(durationS),
    distance_m: distanceM,
    distance_km: distanceM / 1000,
    avg_power_w: powerStats.avg,
    max_power_w: powerStats.max,
    avg_hr_bpm: hrStats.avg,
    max_hr_bpm: hrStats.max,
    avg_cad_rpm: cadStats.avg,
    max_cad_rpm: cadStats.max,
    trkpt_count: trkpts.length,
    lat_unique: latUnique,
    lat_spread_deg: latSpread,
    end_differs_from_start: endDiffersFromStart,
    start_end_diff_m: startEndDiffM,
    course_name: i.courseName || 'fujihill',
  };
}

/**
 * summary を見て異常項目を 1 行ずつ array で返す. 空 array なら 正常。
 */
export function detectAnomalies(summary) {
  const out = [];
  const s = summary || {};
  if (s.trkpt_count > 20 && s.lat_unique < 5) {
    out.push(`lat 固定 (unique=${s.lat_unique}/${s.trkpt_count})`);
  }
  if (s.trkpt_count > 20 && s.distance_m < 100) {
    out.push(`距離 0 km (${s.distance_m.toFixed(0)} m / ${s.trkpt_count} trkpts)`);
  }
  if (s.trkpt_count === 0) {
    out.push('trkpts 空 (= 1 点も記録されていない)');
  }
  if (s.trkpt_count > 100 && !s.end_differs_from_start) {
    out.push('末尾 = 起点 (= 動いていない or 起点固定 bug)');
  }
  if (s.duration_s > 10 && s.trkpt_count === 0) {
    out.push('時間あり / trkpts なし');
  }
  return out;
}

/**
 * UI に出す行 (label/value) の array を返す. 異常検出も含めて表示.
 */
export function summaryToDisplay(summary) {
  const s = summary || {};
  const anomalies = detectAnomalies(s);
  return [
    { label: '時間', value: s.duration_hms || '0:00:00' },
    { label: '距離', value: `${(s.distance_km || 0).toFixed(2)} km` },
    { label: '平均/最大 power', value: `${fmtNum(s.avg_power_w)} / ${fmtNum(s.max_power_w)} W` },
    { label: '平均/最大 心拍', value: `${fmtNum(s.avg_hr_bpm)} / ${fmtNum(s.max_hr_bpm)} bpm` },
    { label: '平均/最大 cadence', value: `${fmtNum(s.avg_cad_rpm)} / ${fmtNum(s.max_cad_rpm)} rpm` },
    { label: 'trkpts', value: `${s.trkpt_count} 点 (lat unique=${s.lat_unique}, spread=${(s.lat_spread_deg || 0).toFixed(5)}°)` },
    { label: '末尾 ≠ 起点', value: s.end_differs_from_start ? 'OK' : '✗ 動いていない' },
    { label: '起点との緯度差', value: s.start_end_diff_m === null ? '--' : `${s.start_end_diff_m.toFixed(0)} m` },
    { label: '異常 flag', value: anomalies.length === 0 ? '(なし)' : anomalies.join(' / '), anomaly: anomalies.length > 0 },
  ];
}

// === helpers ===

function numStats(arr) {
  let sum = 0, count = 0, max = -Infinity;
  for (const v of arr) {
    const n = Number(v);
    if (Number.isFinite(n)) {
      sum += n; count += 1;
      if (n > max) max = n;
    }
  }
  if (count === 0) return { avg: null, max: null };
  return { avg: sum / count, max };
}

function fmtNum(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '--';
  return v.toFixed(0);
}

function hmsFromSeconds(s) {
  const total = Math.max(0, Math.floor(s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function haversineSumMeters(trkpts) {
  if (!Array.isArray(trkpts) || trkpts.length < 2) return 0;
  const R = 6371000;
  let total = 0;
  for (let i = 1; i < trkpts.length; i++) {
    const a = trkpts[i - 1];
    const b = trkpts[i];
    if (!Number.isFinite(a.lat) || !Number.isFinite(b.lat)) continue;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLon = (b.lon - a.lon) * Math.PI / 180;
    const la1 = a.lat * Math.PI / 180;
    const la2 = b.lat * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    total += R * c;
  }
  return total;
}
