// b74: weather panel への雲行追加 + #weather-panel の data-clouds-state 属性更新 +
// mapRenderer.setWeatherClouds の呼び出しを 1 箇所に集約する。
//
// viewer-maplibre.js は AMeDAS fetch 完了後に本 module を呼ぶだけにし、 viewer 内に
// 雲算出 / panel DOM 操作 / facade 接続のロジックを撒き散らさない (= 設計境界 軸 5)。
// 本 module は document global に依存しない (= 引数で受けた element の ownerDocument を
// 使う、 node の vitest から mock DOM で test 可能)。
//
// XSS 安全: textContent のみで構築、 innerHTML 禁止 (= b72 既存規律承継)。

import { estimateClouds } from './cloud_estimator.js';

/**
 * AMeDAS station から雲を算出して mapRenderer に流し、 panel に「雲量 N% 底N m 頂N m」 行を
 * 追加 (= 既存行があれば textContent 更新)、 #weather-panel の data-clouds-state を更新する。
 *
 * @param {object} args
 * @param {object} args.mapRenderer - createMapRenderer 戻り (= facade)。 null 可 (= test 用)
 * @param {object} args.panelEl - #weather-panel (data-clouds-state を書く対象)
 * @param {object} args.rowsEl - #weather-rows (雲行を追加する親)
 * @param {Array<object>|null} args.stations - pickFujiStations 戻り、 null で error 扱い
 * @returns {object|null} estimateClouds 戻り (= weather)、 失敗時 null
 */
export function applyAmedasCloudsToPanel({ mapRenderer, panelEl, rowsEl, stations }) {
  if (!panelEl || !rowsEl) return null;
  const weather = Array.isArray(stations) ? estimateClouds(stations) : null;
  if (weather) {
    if (mapRenderer && typeof mapRenderer.setWeatherClouds === 'function') {
      mapRenderer.setWeatherClouds(weather);
    }
    appendCloudRow(rowsEl, weather);
    panelEl.setAttribute('data-clouds-state', 'rendered');
    return weather;
  }
  panelEl.setAttribute('data-clouds-state', 'error');
  return null;
}

/**
 * URL gate `?weather=fixed&cloudCover=...&cloudBaseM=...&cloudTopM=...` を解釈して
 * forceWeather オブジェクトを返す ── e2e screenshot 用 (= AMeDAS fetch を skip して固定値)。
 *
 * @param {URLSearchParams|null} params
 * @returns {{cloudCover:number, cloudBaseM:number, cloudTopM:number} | null}
 */
export function parseForceWeatherFromUrl(params) {
  if (!params || typeof params.get !== 'function') return null;
  if (params.get('weather') !== 'fixed') return null;
  const cloudCover = Number(params.get('cloudCover'));
  const cloudBaseM = Number(params.get('cloudBaseM'));
  const cloudTopM = Number(params.get('cloudTopM'));
  if (!Number.isFinite(cloudCover) || !Number.isFinite(cloudBaseM) || !Number.isFinite(cloudTopM)) {
    return null;
  }
  // sanity: cloudBaseM < cloudTopM、 cloudCover ∈ [0,1]
  if (cloudBaseM >= cloudTopM) return null;
  if (cloudCover < 0 || cloudCover > 1) return null;
  return { cloudCover, cloudBaseM, cloudTopM };
}

/**
 * URL gate で得た forceWeather を mapRenderer + panel に適用する (= AMeDAS fetch を skip)。
 *
 * @param {object} args
 * @param {object} args.mapRenderer
 * @param {object} args.panelEl
 * @param {object} args.rowsEl
 * @param {object} [args.statusEl] - #weather-status (任意)
 * @param {{cloudCover, cloudBaseM, cloudTopM}} args.forceWeather
 */
export function applyForceWeatherToPanel({ mapRenderer, panelEl, rowsEl, statusEl, forceWeather }) {
  if (!panelEl || !rowsEl || !forceWeather) return;
  if (mapRenderer && typeof mapRenderer.setWeatherClouds === 'function') {
    mapRenderer.setWeatherClouds(forceWeather);
  }
  appendCloudRow(rowsEl, forceWeather);
  panelEl.setAttribute('data-clouds-state', 'rendered');
  if (statusEl) statusEl.textContent = '(URL gate fixed weather)';
}

function appendCloudRow(rowsEl, weather) {
  // 既存「雲行」 を探す (= data-row="clouds" 属性で識別、 multi-call で重複追加しない)
  let row = null;
  const children = rowsEl.children || [];
  for (const child of children) {
    if (child && typeof child.getAttribute === 'function'
        && child.getAttribute('data-row') === 'clouds') {
      row = child;
      break;
    }
  }
  if (!row) {
    const doc = rowsEl.ownerDocument || globalThis.document;
    if (!doc || typeof doc.createElement !== 'function') return;
    row = doc.createElement('div');
    row.setAttribute('data-row', 'clouds');
    rowsEl.appendChild(row);
  }
  const coverPct = Math.round(weather.cloudCover * 100);
  const baseM = Math.round(weather.cloudBaseM);
  const topM = Math.round(weather.cloudTopM);
  // 既存 b72 panel の「雲量 N%、 雲底 N m、 雲頂 N m」 文言 (brief 直すこと #4)
  row.textContent = `雲量 ${coverPct}% / 雲底 ${baseM} m / 雲頂 ${topM} m`;
}
