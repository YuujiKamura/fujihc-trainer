// b74 integration: weather_panel_wire.js の applyAmedasCloudsToPanel /
// parseForceWeatherFromUrl / applyForceWeatherToPanel を、 mock mapRenderer + mock DOM
// element で検証する。 配布元 0 通信 (= fetch 自体を試さない、 stations を literal で渡す)。
//
// 軸 4 audit 指摘: error path test を必須化 ── happy / error の data-clouds-state 遷移
// (= "pending" → "rendered" / "error") を必ず両方通る。

import { describe, it, expect } from 'vitest';
import {
  applyAmedasCloudsToPanel,
  applyCloudAmountToMap,
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

describe('applyAmedasCloudsToPanel — mini-overlay 同期 (= 観るモードで visible)', () => {
  it('miniEl 渡すと textContent + data-clouds-state="rendered" + display="block" が同期更新', () => {
    const mr = makeMockMapRenderer();
    const { panelEl, rowsEl } = makeMockPanel();
    const miniEl = makeMockElement('div');
    miniEl.style = { display: 'none' };
    miniEl.setAttribute('data-clouds-state', 'pending');
    const stations = [
      { code: '49251', alt: 860, temp: 20, humidity: 95 },
      { code: '49256', alt: 992, temp: 18, humidity: 95 },
    ];
    applyAmedasCloudsToPanel({ mapRenderer: mr, panelEl, rowsEl, miniEl, stations });
    expect(miniEl.textContent).toMatch(/雲量 \d+%/);
    expect(miniEl.getAttribute('data-clouds-state')).toBe('rendered');
    expect(miniEl.style.display).toBe('block');
  });

  it('miniEl: stations=null → data-clouds-state="error" (= display は変えない)', () => {
    const mr = makeMockMapRenderer();
    const { panelEl, rowsEl } = makeMockPanel();
    const miniEl = makeMockElement('div');
    miniEl.style = { display: 'none' };
    applyAmedasCloudsToPanel({ mapRenderer: mr, panelEl, rowsEl, miniEl, stations: null });
    expect(miniEl.getAttribute('data-clouds-state')).toBe('error');
  });
});

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

describe('applyAmedasCloudsToPanel — b79 cloudAmountMultiplier (= 雲量倍率 slider)', () => {
  it('multiplier 未指定 → setWeatherClouds に渡る cloudCover は元値そのまま (= 後方互換)', () => {
    const mr = makeMockMapRenderer();
    const { panelEl, rowsEl } = makeMockPanel();
    const stations = [
      { code: '49251', alt: 860, temp: 20, humidity: 95 },
      { code: '49256', alt: 992, temp: 18, humidity: 95 },
    ];
    const weather = applyAmedasCloudsToPanel({ mapRenderer: mr, panelEl, rowsEl, stations });
    expect(mr.calls).toHaveLength(1);
    expect(mr.calls[0].cloudCover).toBe(weather.cloudCover);
    expect(mr.calls[0]).toBe(weather);  // multiplier=1 default なら identity 保持
  });

  it('multiplier=0.5 → setWeatherClouds の cloudCover は半分、 panel textContent は元値', () => {
    const mr = makeMockMapRenderer();
    const { panelEl, rowsEl } = makeMockPanel();
    const stations = [
      { code: '49251', alt: 860, temp: 20, humidity: 95 },
      { code: '49256', alt: 992, temp: 18, humidity: 95 },
    ];
    const weather = applyAmedasCloudsToPanel({
      mapRenderer: mr, panelEl, rowsEl, stations, cloudAmountMultiplier: 0.5,
    });
    // RH=95 平均 → (95-40)/60 ≈ 0.9167
    expect(weather.cloudCover).toBeCloseTo(0.9167, 3);
    expect(mr.calls[0].cloudCover).toBeCloseTo(weather.cloudCover * 0.5, 5);
    expect(mr.calls[0].cloudBaseM).toBe(weather.cloudBaseM);   // 高さは不変
    expect(mr.calls[0].cloudTopM).toBe(weather.cloudTopM);
    // panel 表示は元値 (= 物理算出値)、 倍率は反映しない
    const coverPct = Math.round(weather.cloudCover * 100);
    expect(rowsEl.children[0].textContent).toContain(`雲量 ${coverPct}%`);
  });

  it('multiplier=0 → setWeatherClouds の cloudCover は 0 (= 完全に雲なし)', () => {
    const mr = makeMockMapRenderer();
    const { panelEl, rowsEl } = makeMockPanel();
    const stations = [{ code: '49251', alt: 860, temp: 20, humidity: 95 }];
    applyAmedasCloudsToPanel({
      mapRenderer: mr, panelEl, rowsEl, stations, cloudAmountMultiplier: 0,
    });
    expect(mr.calls[0].cloudCover).toBe(0);
  });
});

describe('applyCloudAmountToMap — slider 操作で再適用', () => {
  it('baseWeather × multiplier の cloudCover で setWeatherClouds を 1 回呼ぶ', () => {
    const mr = makeMockMapRenderer();
    const base = { cloudCover: 0.8, cloudBaseM: 1500, cloudTopM: 6000 };
    applyCloudAmountToMap(mr, base, 0.5);
    expect(mr.calls).toHaveLength(1);
    expect(mr.calls[0]).toEqual({ cloudCover: 0.4, cloudBaseM: 1500, cloudTopM: 6000 });
  });

  it('multiplier=1 → 元の baseWeather がそのまま渡る (= identity 保持、 spread 回避)', () => {
    const mr = makeMockMapRenderer();
    const base = { cloudCover: 0.8, cloudBaseM: 1500, cloudTopM: 6000 };
    applyCloudAmountToMap(mr, base, 1);
    expect(mr.calls[0]).toBe(base);  // 同 reference
  });

  it('mapRenderer=null → 何もしない (= 防御、 例外なし)', () => {
    expect(() => applyCloudAmountToMap(null, { cloudCover: 0.5, cloudBaseM: 1500, cloudTopM: 6000 }, 0.5)).not.toThrow();
  });

  it('baseWeather=null → 何もしない (= AMeDAS fetch 完了前の slider 操作で安全)', () => {
    const mr = makeMockMapRenderer();
    applyCloudAmountToMap(mr, null, 0.5);
    expect(mr.calls).toHaveLength(0);
  });

  it('mapRenderer.setWeatherClouds が無い → 何もしない (= duck-type 防御)', () => {
    const mrNoFn = { calls: [] };
    expect(() => applyCloudAmountToMap(mrNoFn, { cloudCover: 0.5, cloudBaseM: 1500, cloudTopM: 6000 }, 0.5)).not.toThrow();
    expect(mrNoFn.calls).toHaveLength(0);
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
