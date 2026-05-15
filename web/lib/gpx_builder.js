// brief 33: Strava 互換 GPX 1.1 builder (= `src/fujihill/gpx_export.py` の JS 移植).
// pure function、 DOM / browser global 依存ゼロ。
// 入力 trkpts は ride_state.getTrkpts() の戻り値形式 (= {t, lat, lon, ele, power, cad, hr})。
// 出力は GPX 1.1 文字列、 Python 版と byte-level 同一を保つこと (= 完了条件 §11)。
//
// 名前空間 / 拡張要素の根拠は gpx_export.py L40-91 のコメント参照:
// - gpxtpx (Garmin TrackPointExtension) は cadence / hr を載せる、 Strava 公式対応
// - power は gpxpx:PowerInWatts + 独自 <power> を両方並列 (= Strava power グラフ NaN 回避)

/** XML attr / text escape. gpx_export.py L17-22 と同一仕様 (= 5 文字、 `'` は escape しない). */
export function escXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** float 7 桁 / 2 桁出力. Python の `f"{x:.7f}"` 等価. */
function fmtFloat(v, digits) {
  return Number(v).toFixed(digits);
}

/** number 丸めて int (= Python int(round(x)) 等価). null/undefined はそのまま返す. */
function intRound(v) {
  if (v === null || v === undefined) return null;
  return Math.round(Number(v));
}

/**
 * trkpts と summary から Strava 互換 GPX 1.1 XML 文字列を作る.
 *
 * @param {Array<{t?: string, lat: number, lon: number, ele?: number|null,
 *                power?: number|null, cad?: number|null, hr?: number|null}>} trkpts
 * @param {{name?: string, activity_type?: string}} opts
 * @returns {string} GPX 1.1 XML (= 末尾改行付き、 Python 版 `"\n".join(lines)` 互換)
 */
export function buildGpxXml(trkpts, opts = {}) {
  const name = opts.name || 'fujihill ride';
  const activityType = opts.activity_type || 'Virtual Ride';

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="fujihill-trainer" '
      + 'xmlns="http://www.topografix.com/GPX/1/1" '
      + 'xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" '
      + 'xmlns:gpxpx="http://www.garmin.com/xmlschemas/PowerExtension/v1">',
    '  <trk>',
    `    <name>${escXml(name)}</name>`,
    `    <type>${escXml(activityType)}</type>`,
    '    <trkseg>',
  ];

  const arr = Array.isArray(trkpts) ? trkpts : [];
  for (const r of arr) {
    if (!r) continue;
    const lat = (typeof r.lat === 'number' && Number.isFinite(r.lat)) ? r.lat : null;
    const lon = (typeof r.lon === 'number' && Number.isFinite(r.lon)) ? r.lon : null;
    if (lat === null || lon === null) continue;  // gpx_export.py L55-56 同様 skip
    const ele = (r.ele === null || r.ele === undefined || !Number.isFinite(Number(r.ele))) ? null : Number(r.ele);
    const t = (r.t || '').toString().trim();
    const power = (r.power === null || r.power === undefined || !Number.isFinite(Number(r.power))) ? null : Number(r.power);
    const cad = (r.cad === null || r.cad === undefined || !Number.isFinite(Number(r.cad))) ? null : Number(r.cad);
    const hr = (r.hr === null || r.hr === undefined || !Number.isFinite(Number(r.hr))) ? null : Number(r.hr);

    lines.push(`      <trkpt lat="${fmtFloat(lat, 7)}" lon="${fmtFloat(lon, 7)}">`);
    if (ele !== null) lines.push(`        <ele>${fmtFloat(ele, 2)}</ele>`);
    if (t) lines.push(`        <time>${escXml(t)}</time>`);

    const tpxParts = [];
    if (cad !== null) tpxParts.push(`<gpxtpx:cad>${intRound(cad)}</gpxtpx:cad>`);
    if (hr !== null) tpxParts.push(`<gpxtpx:hr>${intRound(hr)}</gpxtpx:hr>`);
    const extBlocks = [];
    if (tpxParts.length > 0) {
      extBlocks.push('<gpxtpx:TrackPointExtension>' + tpxParts.join('') + '</gpxtpx:TrackPointExtension>');
    }
    if (power !== null) {
      extBlocks.push(`<gpxpx:PowerInWatts>${intRound(power)}</gpxpx:PowerInWatts>`);
      extBlocks.push(`<power>${intRound(power)}</power>`);
    }
    if (extBlocks.length > 0) {
      lines.push('        <extensions>' + extBlocks.join('') + '</extensions>');
    }
    lines.push('      </trkpt>');
  }

  lines.push('    </trkseg>', '  </trk>', '</gpx>', '');
  return lines.join('\n');
}
