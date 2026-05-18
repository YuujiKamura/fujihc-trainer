// control_panel.js のユニットテスト.
//
// 各 test は「落ちたら何のバグを検出したことになるか」を 1 行で言える形にする。
//   - 純関数 (controlStorageKey / clampControlValue / formatControlValue /
//     loadControlValue / isValidControlDef) は DOM なしでそのまま検証。
//   - DOM 関数 (createSliderRow / mountControlPanel) は mock document で
//     行構成・配線・localStorage 永続・折りたたみを pin する。
//
// vitest は environment: node のため document は無い。 labels3d.test.js と同じく
// 最小の mock document / mock storage を自前で組む。

import { describe, it, expect } from 'vitest';
import {
  controlStorageKey, clampControlValue, formatControlValue, loadControlValue,
  isValidControlDef, createSliderRow, mountControlPanel, CONTROL_KEY_PREFIX,
} from '../lib/control_panel.js';

// === mock ===

// 最小 mock document。 createElement が返す要素は appendChild / addEventListener /
// dispatch (= イベント発火) を持ち、 ownerDocument で自分を生んだ doc を指す。
function makeMockDoc() {
  let doc;
  function mkEl(tag) {
    return {
      tagName: tag, className: '', id: '', type: '',
      textContent: '', value: '', min: '', max: '', step: '',
      style: {},
      children: [],
      _listeners: {},
      appendChild(c) { this.children.push(c); return c; },
      addEventListener(ev, fn) {
        (this._listeners[ev] = this._listeners[ev] || []).push(fn);
      },
      dispatch(ev) { for (const fn of (this._listeners[ev] || [])) fn(); },
      get ownerDocument() { return doc; },
    };
  }
  doc = {
    createElement: (t) => mkEl(t),
    createTextNode: (t) => ({ nodeType: 3, textContent: t }),
  };
  return doc;
}

// 最小 mock localStorage。 初期値を渡せる。
function makeMockStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    _map: m,
  };
}

// 反映先を記録する apply つきの定義を作る (= apply が正しい値で呼ばれたか検証用)。
function mkDef(over = {}) {
  const applied = [];
  const def = {
    key: 'diff', label: '負荷', min: 10, max: 200, step: 5, value: 100,
    unit: '%', apply: (v) => applied.push(v),
    ...over,
  };
  return { def, applied };
}

// === 純関数 ===

describe('controlStorageKey', () => {
  it('接頭辞 fujihill. を付ける (= 旧 viewer の保存キーと揃える)', () => {
    expect(controlStorageKey('diff')).toBe('fujihill.diff');
    expect(CONTROL_KEY_PREFIX).toBe('fujihill.');
  });
});

describe('clampControlValue', () => {
  const { def } = mkDef();
  it('範囲内はそのまま返す', () => {
    expect(clampControlValue(150, def)).toBe(150);
  });
  it('min 未満は min に丸める', () => {
    expect(clampControlValue(5, def)).toBe(10);
  });
  it('max 超過は max に丸める', () => {
    expect(clampControlValue(999, def)).toBe(200);
  });
  it('非数は既定値 def.value に落とす (= 旧形式の壊れた保存値対策)', () => {
    expect(clampControlValue(NaN, def)).toBe(100);
    expect(clampControlValue('abc', def)).toBe(100);
    expect(clampControlValue(undefined, def)).toBe(100);
  });
});

describe('formatControlValue', () => {
  it('format があれば通す', () => {
    const { def } = mkDef({ format: (v) => (v / 100).toFixed(2) });
    expect(formatControlValue(def, 150)).toBe('1.50');
  });
  it('format が無ければ String 化する', () => {
    const { def } = mkDef();
    expect(formatControlValue(def, 150)).toBe('150');
  });
});

describe('loadControlValue', () => {
  it('保存値があればクランプして返す', () => {
    const { def } = mkDef();
    const storage = makeMockStorage({ 'fujihill.diff': '160' });
    expect(loadControlValue(def, storage)).toBe(160);
  });
  it('保存値が無ければ既定値を返す', () => {
    const { def } = mkDef();
    expect(loadControlValue(def, makeMockStorage())).toBe(100);
  });
  it('storage が null でも既定値で安全に返す', () => {
    const { def } = mkDef();
    expect(loadControlValue(def, null)).toBe(100);
  });
  it('範囲外の旧保存値はクランプされる (= 旧バージョン互換)', () => {
    // 旧 viewer は labelSize を 0..2 の倍率で保存していた。 新 slider は 40..200。
    const { def } = mkDef({ key: 'labelSize', min: 40, max: 200, value: 100 });
    const storage = makeMockStorage({ 'fujihill.labelSize': '1' });
    expect(loadControlValue(def, storage)).toBe(40);  // 1 は範囲外 → min へ
  });
});

describe('isValidControlDef', () => {
  it('正しい定義は true', () => {
    expect(isValidControlDef(mkDef().def)).toBe(true);
  });
  it('key が空文字 / 非文字列なら false', () => {
    expect(isValidControlDef(mkDef({ key: '' }).def)).toBe(false);
    expect(isValidControlDef(mkDef({ key: 5 }).def)).toBe(false);
  });
  it('min >= max なら false', () => {
    expect(isValidControlDef(mkDef({ min: 200, max: 10 }).def)).toBe(false);
  });
  it('step が 0 以下なら false', () => {
    expect(isValidControlDef(mkDef({ step: 0 }).def)).toBe(false);
  });
  it('apply が関数でないなら false', () => {
    expect(isValidControlDef(mkDef({ apply: 'nope' }).def)).toBe(false);
  });
  it('null / 非オブジェクトは false', () => {
    expect(isValidControlDef(null)).toBe(false);
    expect(isValidControlDef(42)).toBe(false);
  });
});

// === DOM 関数 ===

describe('createSliderRow', () => {
  it('row / input / valSpan を既存 CSS と同じ構造で組む', () => {
    const doc = makeMockDoc();
    const { def } = mkDef();
    const { row, input, valSpan } = createSliderRow(doc, def);
    expect(row.className).toBe('row');
    expect(input.type).toBe('range');
    expect(input.id).toBe('rng_diff');
    expect(input.min).toBe('10');
    expect(input.max).toBe('200');
    expect(input.step).toBe('5');
    expect(valSpan.id).toBe('diffVal');
    // 行は label / input / valWrap の 3 要素。
    expect(row.children.length).toBe(3);
  });
  it('unit があれば valWrap にテキストノードとして添える', () => {
    const doc = makeMockDoc();
    const { row } = createSliderRow(doc, mkDef().def);
    const valWrap = row.children[2];
    expect(valWrap.className).toBe('val');
    expect(valWrap.children[1].textContent).toBe('%');
  });
});

describe('mountControlPanel', () => {
  it('全定義の行が container に入り、 初期値で apply が呼ばれる', () => {
    const doc = makeMockDoc();
    const container = doc.createElement('div');
    const d1 = mkDef();
    const d2 = mkDef({ key: 'spd', label: '速度倍率', value: 120 });
    mountControlPanel(container, [d1.def, d2.def], { storage: null });
    expect(container.children.length).toBe(2);
    expect(d1.applied).toEqual([100]);  // 既定値で初期 apply
    expect(d2.applied).toEqual([120]);
  });

  it('input イベントで新しい値が apply され localStorage に保存される', () => {
    const doc = makeMockDoc();
    const container = doc.createElement('div');
    const storage = makeMockStorage();
    const { def, applied } = mkDef();
    mountControlPanel(container, [def], { storage });
    const input = container.children[0].children[1];
    input.value = '155';
    input.dispatch('input');
    // step 5 の値だが clamp は範囲チェックのみ、 155 はそのまま反映。
    expect(applied[applied.length - 1]).toBe(155);
    expect(storage._map.get('fujihill.diff')).toBe('155');
  });

  it('localStorage の保存値があれば初期値に使う', () => {
    const doc = makeMockDoc();
    const container = doc.createElement('div');
    const storage = makeMockStorage({ 'fujihill.diff': '175' });
    const { def, applied } = mkDef();
    mountControlPanel(container, [def], { storage });
    expect(applied).toEqual([175]);
  });

  it('不正な定義は skip し、 残りの定義は組む', () => {
    const doc = makeMockDoc();
    const container = doc.createElement('div');
    const good = mkDef();
    const bad = mkDef({ key: 'broken', min: 100, max: 10 });  // min >= max
    mountControlPanel(container, [bad.def, good.def], { storage: null });
    expect(container.children.length).toBe(1);  // good だけ
    expect(good.applied).toEqual([100]);
  });

  it('collapsible で見出し + body を作り、 見出しクリックで body を開閉する', () => {
    const doc = makeMockDoc();
    const container = doc.createElement('div');
    mountControlPanel(container, [mkDef().def], {
      storage: null, collapsible: true, title: '機器設定',
    });
    const header = container.children[0];
    const body = container.children[1];
    expect(header.className).toBe('panel-header');
    expect(body.className).toBe('panel-body');
    expect(header.textContent).toBe('機器設定 ▼');  // 既定は開
    expect(body.style.display).toBe('');
    expect(body.children.length).toBe(1);            // スライダー行は body 側
    header.dispatch('click');
    expect(header.textContent).toBe('機器設定 ▶');  // 畳んだ
    expect(body.style.display).toBe('none');
  });

  it('setValue / getValue で外部から値を読み書きできる', () => {
    const doc = makeMockDoc();
    const container = doc.createElement('div');
    const { def, applied } = mkDef();
    const panel = mountControlPanel(container, [def], { storage: null });
    expect(panel.getValue('diff')).toBe(100);
    panel.setValue('diff', 140);
    expect(panel.getValue('diff')).toBe(140);
    expect(applied[applied.length - 1]).toBe(140);
  });
});
