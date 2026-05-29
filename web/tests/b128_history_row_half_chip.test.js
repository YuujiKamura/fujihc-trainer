// b128: history_row.js が ride.halfMode (or ride.summary.halfMode) true で「半減」 chip を描く.
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
      className: '',
      textContent: '',
      setAttribute(k, v) { this._attrs[k] = v; },
      getAttribute(k) { return this._attrs[k]; },
      appendChild(c) { this._children.push(c); return c; },
      addEventListener(ev, fn) { listeners[ev] = fn; },
      click() { if (listeners.click) listeners.click({ preventDefault() {} }); },
    };
    created.push(el);
    return el;
  }
  return { doc: { createElement: mkEl, body }, created };
}

function findChipInDate(li) {
  const meta = li._children.find((c) => c.className === 'ride-meta');
  const dateEl = meta?._children.find((c) => c.className === 'ride-date');
  return dateEl?._children.find((c) => c.className === 'ride-half-chip') || null;
}

const baseRide = {
  id: 'r1',
  date: '2026-05-29T10:00:00Z',
  summary: { distance_m: 5000, duration_s: 600, course_name: 'fujihill' },
  trkpts: [],
};

describe('b128: history_row.js が halfMode ride に「半減」 chip を表示', () => {
  it('halfMode フィールドが無い ride では chip が無い (= 通常 ride 互換)', () => {
    const { doc } = makeMockDoc();
    const li = appendHistoryRow({
      document: doc,
      listEl: doc.createElement('ul'),
      ride: baseRide,
      onDelete: () => {},
    });
    expect(findChipInDate(li)).toBeNull();
  });

  it('ride.halfMode === true で chip が ride-date 内に追加', () => {
    const { doc } = makeMockDoc();
    const li = appendHistoryRow({
      document: doc,
      listEl: doc.createElement('ul'),
      ride: { ...baseRide, halfMode: true },
      onDelete: () => {},
    });
    const chip = findChipInDate(li);
    expect(chip).toBeTruthy();
    expect(chip.textContent).toContain('半減');
  });

  it('ride.summary.halfMode === true でも chip が追加 (= b128 commit 後の record schema)', () => {
    const { doc } = makeMockDoc();
    const li = appendHistoryRow({
      document: doc,
      listEl: doc.createElement('ul'),
      ride: { ...baseRide, summary: { ...baseRide.summary, halfMode: true } },
      onDelete: () => {},
    });
    expect(findChipInDate(li)).toBeTruthy();
  });

  it('halfMode が false / 不在なら chip は出ない', () => {
    const { doc } = makeMockDoc();
    const li = appendHistoryRow({
      document: doc,
      listEl: doc.createElement('ul'),
      ride: { ...baseRide, halfMode: false },
      onDelete: () => {},
    });
    expect(findChipInDate(li)).toBeNull();
  });

  it('chip には aria-label が付く (= スクリーンリーダー対応)', () => {
    const { doc } = makeMockDoc();
    const li = appendHistoryRow({
      document: doc,
      listEl: doc.createElement('ul'),
      ride: { ...baseRide, halfMode: true },
      onDelete: () => {},
    });
    const chip = findChipInDate(li);
    expect(chip.getAttribute('aria-label')).toBe('勾配半減モードで走った ride');
  });
});
