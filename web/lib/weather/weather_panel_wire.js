// b74: weather panel への雲行追加 + #weather-panel の data-clouds-state 属性更新 +
// mapRenderer.setWeatherClouds の呼び出しを 1 箇所に集約する。
//
// viewer-map3d.js は AMeDAS fetch 完了後に本 module を呼ぶだけにし、 viewer 内に
// 雲算出 / panel DOM 操作 / facade 接続のロジックを撒き散らさない (= 設計境界 軸 5)。
// 本 module は document global に依存しない (= 引数で受けた element の ownerDocument を
// 使う、 node の vitest から mock DOM で test 可能)。
//
// XSS 安全: textContent のみで構築、 innerHTML 禁止 (= b72 既存規律承継)。

import { estimateClouds } from './cloud_estimator.js';

/**
 * AMeDAS station から雲を算出して mapRenderer に流し、 panel に「雲量 N% 底N m 頂N m」 行を
 * 追加 (= 既存行があれば textContent 更新)、 #weather-panel の data-clouds-state を更新する。
 * miniEl が渡されていれば mini-overlay (= 観るモード / ride mode で常時 visible) も同期更新。
 *
 * b79: cloudAmountMultiplier (0..1) を渡すと、 mapRenderer.setWeatherClouds に流す weather の
 * cloudCover に倍率を掛ける (= user の主観調整スライダー反映)。 panel 表示は元値のまま
 * (= 物理算出値を観測者に見せる)。 デフォルト 1 で従来挙動。
 *
 * @param {object} args
 * @param {object} args.mapRenderer - createMapRenderer 戻り (= facade)。 null 可 (= test 用)
 * @param {object} args.panelEl - #weather-panel (data-clouds-state を書く対象)
 * @param {object} args.rowsEl - #weather-rows (雲行を追加する親)
 * @param {object} [args.miniEl] - #weather-cloud-mini (= 観るモード visible な mini-overlay、 任意)
 * @param {Array<object>|null} args.stations - pickFujiStations 戻り、 null で error 扱い
 * @param {number} [args.cloudAmountMultiplier=1] - cloudCover に掛ける倍率 (= b79 slider)
 * @returns {object|null} estimateClouds 戻り (= 物理算出 weather、 panel 表示用)、 失敗時 null
 */
export function applyAmedasCloudsToPanel({ mapRenderer, panelEl, rowsEl, miniEl, stations, cloudAmountMultiplier = 1 }) {
  if (!panelEl || !rowsEl) return null;
  const weather = Array.isArray(stations) ? estimateClouds(stations) : null;
  if (weather) {
    applyCloudAmountToMap(mapRenderer, weather, cloudAmountMultiplier);
    appendCloudRow(rowsEl, weather);
    updateMiniOverlay(miniEl, weather);
    panelEl.setAttribute('data-clouds-state', 'rendered');
    return weather;
  }
  panelEl.setAttribute('data-clouds-state', 'error');
  if (miniEl && typeof miniEl.setAttribute === 'function') {
    miniEl.setAttribute('data-clouds-state', 'error');
  }
  return null;
}

/**
 * 保持してある baseWeather に倍率を掛けて mapRenderer.setWeatherClouds を呼ぶ。
 * slider 操作時の再適用に使う ── AMeDAS 再 fetch せず物理値 × 倍率だけ更新できる。
 *
 * @param {object|null} mapRenderer - setWeatherClouds を持つ facade、 null 可
 * @param {{cloudCover:number, cloudBaseM:number, cloudTopM:number}|null} baseWeather - 物理算出値
 * @param {number} multiplier - 0..1 (clamp はしない、 呼び出し側が責任)
 */
export function applyCloudAmountToMap(mapRenderer, baseWeather, multiplier) {
  if (!mapRenderer || typeof mapRenderer.setWeatherClouds !== 'function') return;
  if (!baseWeather) return;
  if (multiplier === 1) {
    mapRenderer.setWeatherClouds(baseWeather);
    return;
  }
  const adjusted = { ...baseWeather, cloudCover: baseWeather.cloudCover * multiplier };
  mapRenderer.setWeatherClouds(adjusted);
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
export function applyForceWeatherToPanel({ mapRenderer, panelEl, rowsEl, statusEl, miniEl, forceWeather }) {
  if (!panelEl || !rowsEl || !forceWeather) return;
  if (mapRenderer && typeof mapRenderer.setWeatherClouds === 'function') {
    mapRenderer.setWeatherClouds(forceWeather);
  }
  appendCloudRow(rowsEl, forceWeather);
  updateMiniOverlay(miniEl, forceWeather);
  panelEl.setAttribute('data-clouds-state', 'rendered');
  if (statusEl) statusEl.textContent = '(URL gate fixed weather)';
}

function updateMiniOverlay(miniEl, weather) {
  if (!miniEl || !weather) return;
  const coverPct = Math.round(weather.cloudCover * 100);
  const baseM = Math.round(weather.cloudBaseM);
  const topM = Math.round(weather.cloudTopM);
  miniEl.textContent = `雲量 ${coverPct}% / 雲底 ${baseM} m / 雲頂 ${topM} m`;
  if (typeof miniEl.setAttribute === 'function') {
    miniEl.setAttribute('data-clouds-state', 'rendered');
  }
  // CSS display を block に切替 (= 初期は display:none、 rendered で visible)
  if (miniEl.style) miniEl.style.display = 'block';
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
