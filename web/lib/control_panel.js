// 機器設定パネルの調整スライダーを「定義 1 個」から組み立てる共通機構.
//
// b12 までの viewer-map3d.js では、 スライダーの配線が 5 系統に割れていた:
//   - bindSlider        ── 負荷 / 速度倍率 (値を pct/100 で localStorage 保存)
//   - bindBikeSlider    ── 質量 / 転がり抵抗 / 空気抵抗 (生値↔物理値の変換つき)
//   - 慣性の個別 addEventListener (kg 保存、 bindSlider が使えないため)
//   - 光源方向 / 光源強度の個別関数 applyLightDir / applyLightStr
//   - ラベルサイズの個別 addEventListener
// さらにスライダーの行 DOM (<div class="row"><input type="range">..) は index.html
// に 1 行ずつ手書き。 調整項目を 1 つ増やすたびに HTML と配線を両方手で書いていた。
//
// この module は調整項目 1 個を ControlDef (下記 typedef) で宣言できるようにする。
// 定義の配列を mountControlPanel に渡せば、 スライダー行 DOM の生成・input 配線・
// localStorage 永続 (fujihill.<key>)・数値表示の更新・パネルの折りたたみを、 すべて
// 引き受ける。 調整項目の追加は定義を 1 つ足すだけ ── HTML も配線も書かない。
//
// 値の一本道化: スライダーが出す生値 (input.value) だけを扱う。 物理値への変換
// (例: 転がり抵抗の表示 ‰ → crr = raw/1000) は定義の apply / format の内側に閉じ
// 込める。 これで bindSlider と bindBikeSlider に分かれていた「変換あり / なし」の
// 区別が消える。 localStorage には生値をそのまま保存し、 読み込み時に min/max で
// クランプする ── 旧バージョンの保存値が新しいスライダー範囲の外なら、 自然に
// 既定値へ落ちる。
//
// DOM 依存は mountControlPanel の引数 container 経由 (container.ownerDocument) に
// 閉じ込める。 純ロジック (クランプ / キー組み立て / 表示文字列 / 定義検証) は純関数
// として分離し、 vitest (environment: node、 DOM なし) で素直にテストできるようにする。

/**
 * @typedef {object} ControlDef
 * @property {string} key   - localStorage キーの素 (fujihill.<key>) 兼 input id の素
 * @property {string} label - パネルに表示する項目名
 * @property {number} min   - スライダー最小値 (生値)
 * @property {number} max   - スライダー最大値 (生値)
 * @property {number} step  - スライダーの刻み
 * @property {number} value - 既定値 (生値、 localStorage に保存値が無いとき使う)
 * @property {string} [unit] - 数値の後ろに添える単位文字列 (% / x / ° / m など)
 * @property {(raw:number)=>string} [format] - 生値→表示文字列。 省略時は String(raw)
 * @property {(raw:number)=>void} apply - 生値を描画 / 物理へ反映するコールバック
 */

// localStorage キーの接頭辞。 既存 viewer の 'fujihill.diff' 等と揃える
// (= 旧 viewer が保存した値を、 範囲が一致する項目はそのまま引き継げる)。
export const CONTROL_KEY_PREFIX = 'fujihill.';

// === 純関数 (DOM 非依存、 vitest 単体テスト対象) ===

/**
 * 調整項目の localStorage キーを返す純関数.
 * @param {string} key - ControlDef.key
 * @returns {string} 'fujihill.<key>'
 */
export function controlStorageKey(key) {
  return CONTROL_KEY_PREFIX + key;
}

/**
 * 生値を定義の [min, max] に収める純関数.
 * 非数・範囲外 (旧バージョンの保存値など) は既定値 def.value へ落とす。
 * @param {number} raw
 * @param {ControlDef} def
 * @returns {number} クランプ済みの生値
 */
export function clampControlValue(raw, def) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return def.value;
  if (n < def.min) return def.min;
  if (n > def.max) return def.max;
  return n;
}

/**
 * 生値を表示文字列にする純関数. def.format があれば通し、 無ければ String 化.
 * @param {ControlDef} def
 * @param {number} raw
 * @returns {string}
 */
export function formatControlValue(def, raw) {
  return typeof def.format === 'function' ? def.format(raw) : String(raw);
}

/**
 * storage から調整項目の初期生値を読む純関数.
 * 保存値が無い / 不正 / storage が無いなら既定値。 いずれもクランプして返す
 * (= 戻り値は常に [min, max] 内)。
 * @param {ControlDef} def
 * @param {{getItem:(k:string)=>?string}|null} storage - localStorage 風オブジェクト
 * @returns {number} 初期生値
 */
export function loadControlValue(def, storage) {
  let stored = null;
  try {
    if (storage) stored = storage.getItem(controlStorageKey(def.key));
  } catch { stored = null; }
  if (stored == null) return clampControlValue(def.value, def);
  return clampControlValue(parseFloat(stored), def);
}

/**
 * ControlDef が mountControlPanel で使える形かを検証する純関数.
 * 不正な定義を早期に弾く (= パネル構築時に静かに壊れるのを防ぐ)。
 * @param {*} def
 * @returns {boolean}
 */
export function isValidControlDef(def) {
  if (!def || typeof def !== 'object') return false;
  if (typeof def.key !== 'string' || def.key.length === 0) return false;
  if (typeof def.label !== 'string') return false;
  for (const f of ['min', 'max', 'step', 'value']) {
    if (!Number.isFinite(def[f])) return false;
  }
  if (def.min >= def.max) return false;
  if (def.step <= 0) return false;
  if (typeof def.apply !== 'function') return false;
  return true;
}

// === DOM 関数 (document 依存、 mock で単体テスト) ===

/**
 * 調整項目 1 個からスライダー 1 行の DOM を組む.
 * index.html の手書き行と同じ構造 (<div class="row"><label><input range>
 * <span class="val"><span></span>unit</span></div>) を作るので、 既存 CSS
 * (.row / .val) がそのまま効く。
 *
 * @param {Document} doc - document (テストは mock を渡す)
 * @param {ControlDef} def
 * @returns {{row:HTMLElement, input:HTMLElement, valSpan:HTMLElement}}
 *   row = パネルに append する行。 input / valSpan = 配線側が値の読み書きに使う。
 */
export function createSliderRow(doc, def) {
  const row = doc.createElement('div');
  row.className = 'row';

  const label = doc.createElement('label');
  label.textContent = def.label;
  row.appendChild(label);

  const input = doc.createElement('input');
  input.type = 'range';
  input.id = 'rng_' + def.key;
  input.min = String(def.min);
  input.max = String(def.max);
  input.step = String(def.step);
  row.appendChild(input);

  const valWrap = doc.createElement('span');
  valWrap.className = 'val';
  const valSpan = doc.createElement('span');
  valSpan.id = def.key + 'Val';
  valWrap.appendChild(valSpan);
  if (def.unit) valWrap.appendChild(doc.createTextNode(def.unit));
  row.appendChild(valWrap);

  return { row, input, valSpan };
}

/**
 * 定義配列から機器設定パネルのスライダー群を組み立て、 配線・永続まで済ませる.
 *
 * @param {HTMLElement} container - スライダー行を入れる親要素 (空であること)
 * @param {ControlDef[]} defs - 調整項目の定義配列
 * @param {{storage?:object|null, collapsible?:boolean, title?:string,
 *          collapsed?:boolean}} [opts]
 *   storage     - localStorage 風オブジェクト。 省略時 globalThis.localStorage。
 *                 明示的に null を渡すと永続なし (= テスト用)。
 *   collapsible - true なら見出し + 開閉。 スライダーが増えてパネルが伸びる対策。
 *   title       - 折りたたみ見出しの文言 (既定 '調整')。
 *   collapsed   - 初期状態を畳む (既定 false = 開いた状態)。
 * @returns {{controls:Map<string,object>, applyAll:()=>void,
 *            setValue:(key:string, raw:number)=>void,
 *            getValue:(key:string)=>?number}}
 */
export function mountControlPanel(container, defs, opts = {}) {
  const doc = container.ownerDocument;
  const storage = opts.storage !== undefined
    ? opts.storage
    : (typeof globalThis !== 'undefined' && globalThis.localStorage
        ? globalThis.localStorage : null);

  // 折りたたみ時はスライダー行を body 側に入れる。 非折りたたみ時は container 直下。
  let rowParent = container;
  if (opts.collapsible) {
    const title = opts.title || '調整';
    const header = doc.createElement('div');
    header.className = 'panel-header';
    const body = doc.createElement('div');
    body.className = 'panel-body';
    let open = !opts.collapsed;
    const paint = () => {
      header.textContent = title + (open ? ' ▼' : ' ▶');
      body.style.display = open ? '' : 'none';
    };
    paint();
    header.addEventListener('click', () => { open = !open; paint(); });
    container.appendChild(header);
    container.appendChild(body);
    rowParent = body;
  }

  const controls = new Map();

  // 調整項目 1 個を反映する共通ルーチン。 クランプ → apply → 表示更新 → 保存。
  function applyControl(entry, raw, save) {
    const v = clampControlValue(raw, entry.def);
    entry.def.apply(v);
    entry.valSpan.textContent = formatControlValue(entry.def, v);
    if (save && storage) {
      try {
        storage.setItem(controlStorageKey(entry.def.key), String(v));
      } catch { /* localStorage 不可は無視 (= 値は画面に反映済み) */ }
    }
    entry.current = v;
    return v;
  }

  for (const def of defs) {
    if (!isValidControlDef(def)) {
      // 不正定義はその 1 行だけ skip。 残りの正しい定義は組み続ける。
      console.warn('[control_panel] 不正な定義を skip:', def && def.key);
      continue;
    }
    const { row, input, valSpan } = createSliderRow(doc, def);
    const entry = { def, input, valSpan, row, current: def.value };
    // 初期値は localStorage 由来 (無ければ既定値)。 起動時の反映は保存しない。
    const initial = loadControlValue(def, storage);
    input.value = String(initial);
    applyControl(entry, initial, false);
    // input 操作のたびに反映 + 保存。
    input.addEventListener('input', () => {
      applyControl(entry, parseFloat(input.value), true);
    });
    rowParent.appendChild(row);
    controls.set(def.key, entry);
  }

  return {
    controls,
    /** 全項目を現在値で再 apply する (= mapRenderer が後から ready になった時用)。 */
    applyAll() {
      for (const entry of controls.values()) {
        applyControl(entry, entry.current, false);
      }
    },
    /** 指定キーの値を外部から設定する (= 反映 + 表示 + 保存)。 未知キーは無視。 */
    setValue(key, raw) {
      const entry = controls.get(key);
      if (!entry) return;
      const v = clampControlValue(raw, entry.def);
      entry.input.value = String(v);
      applyControl(entry, v, true);
    },
    /** 指定キーの現在の生値を返す。 未知キーは null。 */
    getValue(key) {
      const entry = controls.get(key);
      return entry ? entry.current : null;
    },
  };
}
