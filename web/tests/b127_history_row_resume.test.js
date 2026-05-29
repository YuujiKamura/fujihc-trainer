// b127: history_row.js が onResume callback を受けたとき「続きから」 button を生やす振る舞い.
import { describe, it, expect } from 'vitest';
import { appendHistoryRow } from '../lib/history_row.js';

function makeMockDoc() {
  const created = [];
  const body = { appendChild() {}, removeChild() {} };
  function mkEl(tag) {
    const listeners = {};
    const el = {
      _tag: tag,
      _children: [],
      _attrs: {},
      _clickCount: 0,
      className: '',
      textContent: '',
      setAttribute(k, v) { this._attrs[k] = v; },
      getAttribute(k) { return this._attrs[k]; },
      appendChild(c) { this._children.push(c); return c; },
      addEventListener(ev, fn) { listeners[ev] = fn; },
      click() {
        this._clickCount += 1;
        if (listeners.click) listeners.click({ preventDefault() {} });
      },
    };
    created.push(el);
    return el;
  }
  return { doc: { createElement: mkEl, body }, created };
}

function findButtonByAction(li, action) {
  const actions = li._children.find((c) => c.className === 'ride-actions');
  if (!actions) return null;
  return actions._children.find((c) => c._tag === 'button' && c._attrs['data-action'] === action) || null;
}

const baseRide = {
  id: 'r1',
  date: '2026-05-29T08:00:00Z',
  summary: { distance_m: 5000, duration_s: 600, course_name: 'fujihill' },
  trkpts: [],
};

describe('b127: appendHistoryRow の onResume callback で「続きから」 button を生やす', () => {
  it('onResume を渡さない場合は「続きから」 button が出ない (= 旧 caller 互換)', () => {
    const { doc } = makeMockDoc();
    const listEl = doc.createElement('ul');
    const li = appendHistoryRow({
      document: doc,
      listEl,
      ride: baseRide,
      onDelete: () => {},
    });
    expect(findButtonByAction(li, 'resume')).toBeNull();
  });

  it('onResume を渡すと「続きから」 button が追加される', () => {
    const { doc } = makeMockDoc();
    const listEl = doc.createElement('ul');
    const li = appendHistoryRow({
      document: doc,
      listEl,
      ride: baseRide,
      onDelete: () => {},
      onResume: () => {},
    });
    const bResume = findButtonByAction(li, 'resume');
    expect(bResume).toBeTruthy();
    expect(bResume.textContent).toBe('続きから');
    expect(bResume.getAttribute('aria-label')).toBe('この ride の続きから走る');
  });

  it('「続きから」 click → onResume が 1 回呼ばれる', () => {
    const { doc } = makeMockDoc();
    const listEl = doc.createElement('ul');
    let calls = 0;
    const li = appendHistoryRow({
      document: doc,
      listEl,
      ride: baseRide,
      onDelete: () => {},
      onResume: () => { calls += 1; },
    });
    findButtonByAction(li, 'resume').click();
    expect(calls).toBe(1);
  });

  it('onResume が reject した Promise を返しても click は throw しない', () => {
    const { doc } = makeMockDoc();
    const listEl = doc.createElement('ul');
    const li = appendHistoryRow({
      document: doc,
      listEl,
      ride: baseRide,
      onDelete: () => {},
      onResume: () => Promise.reject(new Error('resume failed')),
    });
    expect(() => findButtonByAction(li, 'resume').click()).not.toThrow();
  });
});
