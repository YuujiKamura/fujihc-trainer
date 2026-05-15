// save_summary_panel: summary を postride-overlay 内の save-summary-block に描画する.
// pure ではない (= DOM 直触る)、 document を inject 可能で test 化はできる.

import { summaryToDisplay, detectAnomalies } from './save_summary.js';

/**
 * @param {{
 *   document?: Document,
 *   summary: object,
 *   onAccept?: () => void,
 *   onAbort?: () => void,
 * }} cfg
 * @returns {{anomalies: Array<string>}}
 */
export function renderSaveSummary(cfg) {
  const doc = cfg.document || globalThis.document;
  const block = doc.getElementById('save-summary-block');
  if (!block) return { anomalies: [] };
  block.hidden = false;
  const list = doc.getElementById('save-summary-list');
  if (list) {
    while (list.firstChild) list.removeChild(list.firstChild);
    const rows = summaryToDisplay(cfg.summary);
    for (const row of rows) {
      const dt = doc.createElement('dt');
      dt.textContent = row.label;
      const dd = doc.createElement('dd');
      dd.textContent = String(row.value);
      if (row.anomaly) dd.className = 'anomaly';
      list.appendChild(dt);
      list.appendChild(dd);
    }
  }
  const anomalies = detectAnomalies(cfg.summary);
  const anomEl = doc.getElementById('save-summary-anomaly');
  const confirmEl = doc.getElementById('save-summary-confirm');
  if (anomEl) {
    if (anomalies.length > 0) {
      anomEl.textContent = `⚠ 異常検出: ${anomalies.join(' / ')}`;
      anomEl.hidden = false;
    } else {
      anomEl.textContent = '';
      anomEl.hidden = true;
    }
  }
  if (confirmEl) {
    confirmEl.hidden = anomalies.length === 0;
    if (anomalies.length > 0) {
      const btnAccept = doc.getElementById('btnSaveAnomalyAccept');
      const btnAbort = doc.getElementById('btnSaveAnomalyAbort');
      if (btnAccept) {
        const nb = btnAccept.cloneNode(true);
        btnAccept.parentNode.replaceChild(nb, btnAccept);
        nb.addEventListener('click', () => { if (cfg.onAccept) cfg.onAccept(); });
      }
      if (btnAbort) {
        const nb = btnAbort.cloneNode(true);
        btnAbort.parentNode.replaceChild(nb, btnAbort);
        nb.addEventListener('click', () => { if (cfg.onAbort) cfg.onAbort(); });
      }
    }
  }
  return { anomalies };
}
