// brief b2: frame_diff.js の unit test.
// viewer の per-frame コスト削減 ── 「変化した時だけ更新」 判定の純関数を
// happy / edge (ε 境界・2π 跨ぎ) / error (prev=null 初回) の 3 path で pin する。
import { describe, it, expect } from 'vitest';

import {
  angDelta,
  riderFrameChanged,
  parseTileCoord,
  terrainTileKey,
  terrainCacheKind,
  createTextWriter,
  minimapDirty,
} from '../lib/frame_diff.js';

describe('angDelta', () => {
  it('同一角は 0', () => {
    expect(angDelta(1.0, 1.0)).toBe(0);
  });
  it('小さな正の差をそのまま返す', () => {
    expect(angDelta(0, 0.5)).toBeCloseTo(0.5, 10);
  });
  it('2π 境界を最短回転で跨ぐ (0.1 → -0.1 相当)', () => {
    // 0.05 rad から -0.05 rad へ。 素朴な減算なら -0.1、 wrap でも -0.1。
    const d = angDelta(0.05, 2 * Math.PI - 0.05);
    expect(d).toBeCloseTo(-0.1, 6);
  });
  it('π を僅かに超える差は反対回りの最短に折る', () => {
    const d = angDelta(0, Math.PI + 0.1);
    expect(d).toBeCloseTo(-(Math.PI - 0.1), 6);
  });
});

describe('riderFrameChanged', () => {
  const base = { lat: 35.4, lon: 138.7, heading: 0, spin: 0 };
  it('prev=null は初回扱いで常に true (error path)', () => {
    expect(riderFrameChanged(null, base)).toBe(true);
  });
  it('完全同一フレームは false (停止中 skip)', () => {
    expect(riderFrameChanged(base, { ...base })).toBe(false);
  });
  it('lat が ε を超えて動けば true (happy path)', () => {
    expect(riderFrameChanged(base, { ...base, lat: 35.4 + 1e-5 })).toBe(true);
  });
  it('lon の微小揺れ (ε 未満) は false (edge: 境界下)', () => {
    expect(riderFrameChanged(base, { ...base, lon: 138.7 + 1e-9 })).toBe(false);
  });
  it('heading が ε を超えて回れば true', () => {
    expect(riderFrameChanged(base, { ...base, heading: 0.01 })).toBe(true);
  });
  it('spin の微小回転 (ε 未満) は false', () => {
    expect(riderFrameChanged(base, { ...base, spin: 1e-5 })).toBe(false);
  });
  it('heading が 2π 境界を僅かに跨いだだけなら false (edge: wrap)', () => {
    const prev = { ...base, heading: 0.0001 };
    const next = { ...base, heading: 2 * Math.PI - 0.0001 };
    expect(riderFrameChanged(prev, next)).toBe(false);
  });
  it('eps override で閾値を変えられる', () => {
    const next = { ...base, lat: 35.4 + 1e-4 };
    expect(riderFrameChanged(base, next, { pos: 1e-2 })).toBe(false);
  });
});

describe('parseTileCoord', () => {
  it('標準的な DEM タイル URL から z/x/y を取り出す (happy path)', () => {
    expect(parseTileCoord('http://localhost/tiles/gsi_dem/14/14524/5821.png'))
      .toEqual({ z: 14, x: 14524, y: 5821 });
  });
  it('query 付き URL でも取り出す (edge)', () => {
    expect(parseTileCoord('http://h/tiles/gsi_dem/8/100/200.png?v=2'))
      .toEqual({ z: 8, x: 100, y: 200 });
  });
  it('z/x/y を含まない URL は null (error path)', () => {
    expect(parseTileCoord('http://localhost/style.json')).toBe(null);
  });
  it('文字列でない入力は null (error path)', () => {
    expect(parseTileCoord(null)).toBe(null);
    expect(parseTileCoord(undefined)).toBe(null);
  });
});

describe('terrainTileKey / terrainCacheKind', () => {
  it('tile key は z/x/y 連結で一意', () => {
    expect(terrainTileKey(14, 14524, 5821)).toBe('14/14524/5821');
  });
  it('別タイルは別 key', () => {
    expect(terrainTileKey(14, 1, 2)).not.toBe(terrainTileKey(14, 1, 3));
  });
  it('kind に upsample 倍率が埋まり、 倍率変更で別 kind になる (stale 防止)', () => {
    expect(terrainCacheKind(2)).toBe('terrain-u2');
    expect(terrainCacheKind(2)).not.toBe(terrainCacheKind(4));
  });
});

describe('createTextWriter', () => {
  function fakeDom() {
    const els = {};
    const get = (id) => (els[id] || (els[id] = { id, textContent: undefined, _writes: 0 }));
    // _writes をカウントするため textContent を accessor 化
    const wrap = (id) => {
      const e = get(id);
      return new Proxy(e, {
        set(t, k, v) { if (k === 'textContent') t._writes++; t[k] = v; return true; },
      });
    };
    return { wrap, peek: (id) => els[id] };
  }

  it('初回は書き込み true、 DOM に反映 (happy path)', () => {
    const dom = fakeDom();
    const setText = createTextWriter(dom.wrap);
    expect(setText('x', 'hello')).toBe(true);
    expect(dom.peek('x').textContent).toBe('hello');
  });
  it('同値の再書き込みは false、 DOM 書き込みを skip (edge: 値不変)', () => {
    const dom = fakeDom();
    const setText = createTextWriter(dom.wrap);
    setText('x', '42');
    expect(setText('x', '42')).toBe(false);
    expect(dom.peek('x')._writes).toBe(1); // 2 回呼んでも書き込みは 1 回
  });
  it('数値と文字列は String 正規化して比較 (42 と "42" は同値)', () => {
    const dom = fakeDom();
    const setText = createTextWriter(dom.wrap);
    setText('x', 42);
    expect(setText('x', '42')).toBe(false);
  });
  it('値が変われば再び書き込む', () => {
    const dom = fakeDom();
    const setText = createTextWriter(dom.wrap);
    setText('x', 'a');
    expect(setText('x', 'b')).toBe(true);
    expect(dom.peek('x').textContent).toBe('b');
  });
  it('要素不在 (getEl が null) でも例外を投げず cache は進む (error path)', () => {
    const setText = createTextWriter(() => null);
    expect(setText('missing', 'v')).toBe(true);
    expect(setText('missing', 'v')).toBe(false);
  });
});

describe('minimapDirty', () => {
  it('prev=null は常に true (error path / 初回)', () => {
    expect(minimapDirty(null, { x: 1, y: 2, h: 0 })).toBe(true);
  });
  it('1px 動けば true (happy path)', () => {
    expect(minimapDirty({ x: 10, y: 10, h: 0 }, { x: 11, y: 10, h: 0 })).toBe(true);
  });
  it('sub-pixel 移動 (同じ整数 px) は false (edge: 量子化)', () => {
    expect(minimapDirty({ x: 10.1, y: 10.2, h: 0 }, { x: 10.3, y: 10.4, h: 0 })).toBe(false);
  });
  it('ちょうど 1px 境界を跨げば true', () => {
    expect(minimapDirty({ x: 10.4, y: 0, h: 0 }, { x: 10.6, y: 0, h: 0 })).toBe(true);
  });
  it('向き (h 度) が 1° 単位で変われば true', () => {
    expect(minimapDirty({ x: 0, y: 0, h: 10 }, { x: 0, y: 0, h: 12 })).toBe(true);
  });
  it('向きの sub-degree 揺れは false', () => {
    expect(minimapDirty({ x: 0, y: 0, h: 10.1 }, { x: 0, y: 0, h: 10.3 })).toBe(false);
  });
});
