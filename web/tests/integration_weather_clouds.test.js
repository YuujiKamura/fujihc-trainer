// b74 integration: weather_panel_wire.js の applyAmedasCloudsToPanel /
// parseForceWeatherFromUrl / applyForceWeatherToPanel を、 mock mapRenderer + mock DOM
// element で検証する。 配布元 0 通信 (= fetch 自体を試さない、 stations を literal で渡す)。
//
// 軸 4 audit 指摘: error path test を必須化 ── happy / error の data-clouds-state 遷移
// (= "pending" → "rendered" / "error") を必ず両方通る。

import { describe, it, expect } from 'vitest';
import {
  applyAmedasCloudsToPanel,
  parseForceWeatherFromUrl,
  applyForceWeatherToPanel,
} from '../lib/weather/weather_panel_wire.js';

// === mock DOM (= vitest node 環境では document が無いので fake element を作る) ===

function makeMockElement(tag = 'div') {
  const el = {
    tagName: tag,
    children: [],
    attrs: {},
    textContent: '',
    parentNode: null,
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    appendChild(c) {
      this.children.push(c);
      c.parentNode = this;
    },
  };
  el.ownerDocument = {
    createElement: (t) => makeMockElement(t),
  };
  return el;
}

function makeMockMapRenderer() {
  const calls = [];
  return {
    calls,
    setWeatherClouds(w) { calls.push(w); },
  };
}

function makeMockPanel() {
  const panelEl = makeMockElement('div');
  panelEl.setAttribute('data-clouds-state', 'pending');  // index.html 初期属性相当
  const rowsEl = makeMockElement('div');
  const statusEl = makeMockElement('div');
  return { panelEl, rowsEl, statusEl };
}

describe('applyAmedasCloudsToPanel — happy path (= data-clouds-state="rendered")', () => {
  it('4 観測点 → setWeatherClouds 1 回呼ばれる、 data-clouds-state="rendered"、 panel に雲行 1 件追加', () => {
    const mr = makeMockMapRenderer();
    const { panelEl, rowsEl } = makeMockPanel();
    const stations = [
      { code: '49251', alt: 860, temp: 25, humidity: 70 },
      { code: '49256', alt: 992, temp: 22, humidity: 85 },
      { code: '49196', alt: 552, temp: 26, humidity: 65 },
      { code: '50136', alt: 472, temp: 24, humidity: 75 },
    ];
    const weather = applyAmedasCloudsToPanel({
      mapRenderer: mr, panelEl, rowsEl, stations,
    });
    expect(weather).not.toBeNull();
    expect(weather.cloudCover).toBeCloseTo(0.5625, 3);
    expect(mr.calls).toHaveLength(1);
    expect(mr.calls[0]).toEqual(weather);
    expect(panelEl.getAttribute('data-clouds-state')).toBe('rendered');
    expect(rowsEl.children).toHaveLength(1);
    expect(rowsEl.children[0].getAttribute('data-row')).toBe('clouds');
    expect(rowsEl.children[0].textContent).toMatch(/雲量 \d+%/);
    expect(rowsEl.children[0].textContent).toMatch(/雲底 \d+ m/);
    expect(rowsEl.children[0].textContent).toMatch(/雲頂 \d+ m/);
  });

  it('multi-call: 同じ panel に 2 回呼んでも雲行は 1 件のまま (= textContent 更新)', () => {
    const mr = makeMockMapRenderer();
    const { panelEl, rowsEl } = makeMockPanel();
    const stations = [
      { code: '49251', alt: 860, temp: 25, humidity: 70 },
      { code: '49256', alt: 992, temp: 22, humidity: 85 },
    ];
    applyAmedasCloudsToPanel({ mapRenderer: mr, panelEl, rowsEl, stations });
    const firstText = rowsEl.children[0].textContent;
    // 値を変えて 2 回目
    const stations2 = [
      { code: '49251', alt: 860, temp: 20, humidity: 95 },
      { code: '49256', alt: 992, temp: 18, humidity: 95 },
    ];
    applyAmedasCloudsToPanel({ mapRenderer: mr, panelEl, rowsEl, stations: stations2 });
    expect(rowsEl.children).toHaveLength(1);  // 行は増えない
    expect(rowsEl.children[0].textContent).not.toBe(firstText);  // 文言は更新
  });
});

describe('applyAmedasCloudsToPanel — error path (= data-clouds-state="error")', () => {
  it('stations=null → setWeatherClouds 呼ばれず、 data-clouds-state="error"', () => {
    const mr = makeMockMapRenderer();
    const { panelEl, rowsEl } = makeMockPanel();
    const weather = applyAmedasCloudsToPanel({
      mapRenderer: mr, panelEl, rowsEl, stations: null,
    });
    expect(weather).toBeNull();
    expect(mr.calls).toHaveLength(0);
    expect(panelEl.getAttribute('data-clouds-state')).toBe('error');
  });

  it('stations=[] (= 空配列) → setWeatherClouds 呼ばれず、 data-clouds-state="error"', () => {
    const mr = makeMockMapRenderer();
    const { panelEl, rowsEl } = makeMockPanel();
    const weather = applyAmedasCloudsToPanel({
      mapRenderer: mr, panelEl, rowsEl, stations: [],
    });
    expect(weather).toBeNull();
    expect(panelEl.getAttribute('data-clouds-state')).toBe('error');
  });

  it('全観測点 humidity=null (= 山頂のみ) → setWeatherClouds 呼ばれず、 data-clouds-state="error"', () => {
    const mr = makeMockMapRenderer();
    const { panelEl, rowsEl } = makeMockPanel();
    const stations = [
      { code: '50066', alt: 3775, temp: -2, humidity: null },
    ];
    const weather = applyAmedasCloudsToPanel({
      mapRenderer: mr, panelEl, rowsEl, stations,
    });
    expect(weather).toBeNull();
    expect(panelEl.getAttribute('data-clouds-state')).toBe('error');
  });

  it('panelEl 不在 / rowsEl 不在 → 何もせず null (= 防御)', () => {
    const mr = makeMockMapRenderer();
    const result1 = applyAmedasCloudsToPanel({
      mapRenderer: mr, panelEl: null, rowsEl: makeMockElement(), stations: [],
    });
    const result2 = applyAmedasCloudsToPanel({
      mapRenderer: mr, panelEl: makeMockElement(), rowsEl: null, stations: [],
    });
    expect(result1).toBeNull();
    expect(result2).toBeNull();
    expect(mr.calls).toHaveLength(0);
  });
});

describe('parseForceWeatherFromUrl — URL gate ?weather=fixed', () => {
  function makeParams(qs) {
    return new URLSearchParams(qs);
  }

  it('weather=fixed + 3 数値 → object', () => {
    const w = parseForceWeatherFromUrl(makeParams('weather=fixed&cloudCover=0.9&cloudBaseM=1500&cloudTopM=3500'));
    expect(w).toEqual({ cloudCover: 0.9, cloudBaseM: 1500, cloudTopM: 3500 });
  });

  it('weather パラメータが fixed でない → null', () => {
    expect(parseForceWeatherFromUrl(makeParams(''))).toBeNull();
    expect(parseForceWeatherFromUrl(makeParams('weather=auto'))).toBeNull();
  });

  it('cloudCover が数値でない → null', () => {
    expect(parseForceWeatherFromUrl(makeParams('weather=fixed&cloudCover=abc&cloudBaseM=1500&cloudTopM=3500'))).toBeNull();
  });

  it('cloudBaseM >= cloudTopM → null (= sanity)', () => {
    expect(parseForceWeatherFromUrl(makeParams('weather=fixed&cloudCover=0.5&cloudBaseM=3500&cloudTopM=1500'))).toBeNull();
    expect(parseForceWeatherFromUrl(makeParams('weather=fixed&cloudCover=0.5&cloudBaseM=2000&cloudTopM=2000'))).toBeNull();
  });

  it('cloudCover が [0,1] 外 → null', () => {
    expect(parseForceWeatherFromUrl(makeParams('weather=fixed&cloudCover=1.5&cloudBaseM=1500&cloudTopM=3500'))).toBeNull();
    expect(parseForceWeatherFromUrl(makeParams('weather=fixed&cloudCover=-0.1&cloudBaseM=1500&cloudTopM=3500'))).toBeNull();
  });

  it('null / 非 URLSearchParams → null', () => {
    expect(parseForceWeatherFromUrl(null)).toBeNull();
    expect(parseForceWeatherFromUrl(undefined)).toBeNull();
    expect(parseForceWeatherFromUrl({})).toBeNull();
  });
});

describe('applyForceWeatherToPanel — URL gate 経由で AMeDAS skip', () => {
  it('forceWeather → setWeatherClouds 呼ばれ、 data-clouds-state="rendered"、 status 表示', () => {
    const mr = makeMockMapRenderer();
    const { panelEl, rowsEl, statusEl } = makeMockPanel();
    const forceWeather = { cloudCover: 0.9, cloudBaseM: 1500, cloudTopM: 3500 };
    applyForceWeatherToPanel({
      mapRenderer: mr, panelEl, rowsEl, statusEl, forceWeather,
    });
    expect(mr.calls).toHaveLength(1);
    expect(mr.calls[0]).toEqual(forceWeather);
    expect(panelEl.getAttribute('data-clouds-state')).toBe('rendered');
    expect(rowsEl.children).toHaveLength(1);
    expect(statusEl.textContent).toMatch(/URL gate/);
  });
});
