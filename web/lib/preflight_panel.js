// preflight_panel: runPreflight() の結果を DOM panel に描画する.
// pure ではない (= DOM 直触る)、 ただし document を inject 可能で test 化はできる.

const LEVEL_GLYPH = { ok: '✓', warn: '⚠', fail: '✗' };
const LEVEL_COLOR = { ok: '#7fff00', warn: '#ffd54a', fail: '#ff5050' };

/**
 * 結果 items を panel HTML に描画 + 開始 button の disable / 警告メッセージ制御.
 *
 * @param {{
 *   document?: Document,
 *   result: {items: Array, level: string},
 *   onStart: () => void,
 *   onCancel: () => void,
 * }} cfg
 */
export function renderPreflightPanel(cfg) {
  const doc = cfg.document || globalThis.document;
  const overlay = doc.getElementById('preflight-overlay');
  if (!overlay) return;
  const listEl = doc.getElementById('preflight-list');
  const msgEl = doc.getElementById('preflight-message');
  const btnStart = doc.getElementById('btnPreflightStart');
  const btnCancel = doc.getElementById('btnPreflightCancel');

  // list clear + 再構築
  if (listEl) {
    while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
    for (const item of cfg.result.items) {
      const li = doc.createElement('li');
      li.setAttribute('data-key', item.key);
      li.setAttribute('data-level', item.level);
      li.style.color = LEVEL_COLOR[item.level] || '#ddd';
      li.style.fontSize = '13px';
      li.style.padding = '0.15rem 0';
      const glyph = doc.createElement('span');
      glyph.textContent = `${LEVEL_GLYPH[item.level] || '·'} `;
      glyph.style.fontWeight = 'bold';
      const label = doc.createElement('span');
      label.textContent = `${item.label}: `;
      const value = doc.createElement('span');
      value.textContent = String(item.value);
      value.style.color = '#ddd';
      li.appendChild(glyph);
      li.appendChild(label);
      li.appendChild(value);
      listEl.appendChild(li);
    }
  }

  // start button の状態
  if (btnStart) {
    if (cfg.result.level === 'fail') {
      btnStart.disabled = true;
      btnStart.textContent = '開始不可';
    } else if (cfg.result.level === 'warn') {
      btnStart.disabled = false;
      btnStart.textContent = '警告あるが開始する';
    } else {
      btnStart.disabled = false;
      btnStart.textContent = '開始する';
    }
  }

  if (msgEl) {
    if (cfg.result.level === 'fail') {
      msgEl.textContent = '✗ がある項目を解消してから開始してください。';
      msgEl.style.color = LEVEL_COLOR.fail;
    } else if (cfg.result.level === 'warn') {
      msgEl.textContent = '⚠ の項目があります。 内容を確認の上で開始してください。';
      msgEl.style.color = LEVEL_COLOR.warn;
    } else {
      msgEl.textContent = '全項目 OK、 開始できます。';
      msgEl.style.color = LEVEL_COLOR.ok;
    }
  }

  // bind start / cancel (= 1 回前のを差し替えるため、 cloneNode で既存 listener を捨てる)
  if (btnStart && !btnStart.disabled) {
    const newBtn = btnStart.cloneNode(true);
    btnStart.parentNode.replaceChild(newBtn, btnStart);
    newBtn.addEventListener('click', () => {
      hidePreflight({ document: doc });
      cfg.onStart();
    });
  }
  if (btnCancel) {
    const newBtn = btnCancel.cloneNode(true);
    btnCancel.parentNode.replaceChild(newBtn, btnCancel);
    newBtn.addEventListener('click', () => {
      hidePreflight({ document: doc });
      if (cfg.onCancel) cfg.onCancel();
    });
  }

  overlay.classList.add('visible');
}

export function hidePreflight(opts = {}) {
  const doc = opts.document || globalThis.document;
  const overlay = doc.getElementById('preflight-overlay');
  if (overlay) overlay.classList.remove('visible');
}
