// b12 Phase 3 部品0 ファサード index.js のユニットテスト.
//
// index.js は three / three 依存部品を boot() 内で動的 import するので、 createMapRenderer()
// 自体は three 非依存で評価でき node 環境から import できる。 boot() を呼ばない範囲
// ── 差し替え口15メソッドが揃うか、 距離補間の純関数 ── を検証する。 実描画 (boot 後の
// シーン構築・カメラ・rider) は three / DOM が要るので Phase 4 の画面確認で見る。

import { describe, it, expect, afterEach } from 'vitest';
import { createMapRenderer, distanceAlongCourse, isValidBounds } from '../lib/map3d/index.js';

// map_renderer.js が定める意味メソッド (= b39 で setLandmarks、 b62 で大気散乱の
// setAtmosphereParams / getAtmosphereUniforms を追加、 b71 で背景スフィア用の
// setSkyIntensity を追加、 b74 で volumetric clouds の setWeatherClouds /
// getWeatherCloudsInfo を追加、 b75 で太陽位置時刻連動の setSolarPosition /
// getSolarPosition を追加、 b82 で自機画面縦位置調整の setOrbitLookUpRatio を
// 追加して 30 個)。
// Three.js 実装も同じ顔ぶれを満たす。
const CONTRACT_METHODS = [
  'isBooted', 'boot', 'onceIdle',
  'setCameraDefaults', 'updateCamera', 'projectToScreen', 'getCameraInfo', 'render',
  'renderCourse',
  'updateRider',
  'setLabelScale', 'updateLabelWindow',
  'setSunlightDirection', 'setSunlightStrength',
  'setSolarPosition', 'getSolarPosition',  // b75 太陽位置時刻連動 (= NOAA 注入)
  'setStartGoalVisible',
  'setRiderScale', 'setCourseWidth', 'setRoadHeight', 'setLabelHeight',
  'setRiderShape', 'setShadowBoardEnabled',
  'setLandmarks',  // b39 富士ヒル区間名標識 (= 7 件、 createLandmarks3d 経由)
  'setAtmosphereParams', 'getAtmosphereUniforms',  // b62 大気散乱の調整 / 観測口
  'setSkyIntensity',  // b71 背景スフィアの天頂色濃度
  'setWeatherClouds', 'getWeatherCloudsInfo',  // b74 volumetric clouds の配線 / 観測口
  'setOrbitLookUpRatio',  // b82 自機の画面縦位置調整 (= orbit lookUp 比率を user slider 経由)
];

describe('createMapRenderer — 差し替え口30メソッド', () => {
  it('30個のメソッドが揃い、すべて関数である', () => {
    const r = createMapRenderer();
    for (const name of CONTRACT_METHODS) {
      expect(typeof r[name], `${name} が関数でない`).toBe('function');
    }
  });

  it('契約外の余計なメソッドを生やしていない (30個ちょうど)', () => {
    const r = createMapRenderer();
    const fnKeys = Object.keys(r).filter((k) => typeof r[k] === 'function');
    expect(fnKeys.sort()).toEqual([...CONTRACT_METHODS].sort());
  });

  it('boot 前 setLandmarks を呼んでも例外にならない (= viewer-maplibre.js の早呼びを許容、 b39)', () => {
    const r = createMapRenderer();
    expect(() => r.setLandmarks([])).not.toThrow();
    expect(() => r.setLandmarks(null)).not.toThrow();
    expect(() => r.setLandmarks(undefined)).not.toThrow();
  });

  it('boot 前は isBooted() が false', () => {
    const r = createMapRenderer();
    expect(r.isBooted()).toBe(false);
  });

  it('boot 前に render / updateRider / updateCamera を呼んでも例外にならない', () => {
    const r = createMapRenderer();
    expect(() => r.render()).not.toThrow();
    expect(() => r.updateRider({ course: [], curIdx: 0, lat: 0, lon: 0 })).not.toThrow();
    const cam = r.updateCamera({ course: [], curIdx: 0, lon: 0, lat: 0, apply: false });
    expect(cam).toHaveProperty('headingRad');
    expect(cam).toHaveProperty('bearingDeg');
  });

  it('boot 前の projectToScreen は visible=false の安全な値を返す', () => {
    const r = createMapRenderer();
    const p = r.projectToScreen(138.7, 35.4);
    expect(p.visible).toBe(false);
  });

  it('onceIdle のコールバックは idle 未発火なら即時には呼ばれない', () => {
    const r = createMapRenderer();
    let called = false;
    r.onceIdle(() => { called = true; });
    expect(called).toBe(false);
  });

  it('各レンダラは独立した状態を持つ (factory が状態を共有しない)', () => {
    const a = createMapRenderer();
    const b = createMapRenderer();
    expect(a).not.toBe(b);
    expect(a.isBooted()).toBe(false);
    expect(b.isBooted()).toBe(false);
  });

  it('boot 前に setRiderScale / setCourseWidth / setRoadHeight / setLabelHeight / setRiderShape を呼んでも例外にならない (pending 経路)', () => {
    const r = createMapRenderer();
    expect(() => r.setRiderScale(2.0)).not.toThrow();
    expect(() => r.setCourseWidth(8)).not.toThrow();
    expect(() => r.setRoadHeight(3)).not.toThrow();
    expect(() => r.setLabelHeight(6)).not.toThrow();
    expect(() => r.setRiderShape({ wheelR: 0.3 })).not.toThrow();
  });

  it('b74: boot 前に setWeatherClouds を呼んでも例外にならない (= pending 経路)', () => {
    const r = createMapRenderer();
    expect(() => r.setWeatherClouds({ cloudCover: 0.5, cloudBaseM: 1500, cloudTopM: 3500 })).not.toThrow();
    expect(() => r.setWeatherClouds(null)).not.toThrow();
    expect(() => r.setWeatherClouds(undefined)).not.toThrow();
  });

  it('b74: boot 前は getWeatherCloudsInfo() が null (= cloudInstance 未生成)', () => {
    const r = createMapRenderer();
    expect(r.getWeatherCloudsInfo()).toBe(null);
  });

  it('b75: boot 前に setSolarPosition を呼んでも例外にならない (= pending 経路)', () => {
    const r = createMapRenderer();
    expect(() => r.setSolarPosition({ azimuthDeg: 175, elevationDeg: 78 })).not.toThrow();
  });

  it('b75: boot 前は getSolarPosition() が null (= scene 未生成)', () => {
    const r = createMapRenderer();
    expect(r.getSolarPosition()).toBe(null);
  });

  it('b75: setSolarPosition(null) / setSolarPosition(undefined) で例外にならない (= 安全 no-op)', () => {
    const r = createMapRenderer();
    expect(() => r.setSolarPosition(null)).not.toThrow();
    expect(() => r.setSolarPosition(undefined)).not.toThrow();
  });

  it('b75: setSolarPosition({azimuthDeg: NaN, elevationDeg: 78}) で例外にならない (= NaN 防御)', () => {
    const r = createMapRenderer();
    expect(() => r.setSolarPosition({ azimuthDeg: NaN, elevationDeg: 78 })).not.toThrow();
    expect(() => r.setSolarPosition({ azimuthDeg: 175, elevationDeg: NaN })).not.toThrow();
  });

  it('b75: setSolarPosition({azimuthDeg: 175, elevationDeg: 200}) で例外にならない (= 範囲外 accept、 clamp は scene.applySun の Math.max で吸収)', () => {
    const r = createMapRenderer();
    expect(() => r.setSolarPosition({ azimuthDeg: 175, elevationDeg: 200 })).not.toThrow();
    expect(() => r.setSolarPosition({ azimuthDeg: 175, elevationDeg: -200 })).not.toThrow();
    expect(() => r.setSolarPosition({ azimuthDeg: 9999, elevationDeg: 78 })).not.toThrow();
  });
});

describe('distanceAlongCourse — curIdx + lat/lon から走行距離', () => {
  const course = [
    { lat: 0, lon: 0, distance_m: 0 },
    { lat: 0, lon: 1, distance_m: 100 },
    { lat: 0, lon: 2, distance_m: 250 },
  ];

  it('区間の始点では区間始点の distance_m', () => {
    expect(distanceAlongCourse(course, 0, 0, 0)).toBe(0);
  });

  it('区間の中点では distance_m を線形補間する', () => {
    expect(distanceAlongCourse(course, 0, 0, 0.5)).toBe(50);
    expect(distanceAlongCourse(course, 1, 0, 1.5)).toBe(175);
  });

  it('区間を越える lat/lon は frac を 0..1 にクランプする', () => {
    expect(distanceAlongCourse(course, 0, 0, 2)).toBe(100);
    expect(distanceAlongCourse(course, 0, 0, -1)).toBe(0);
  });

  it('最終点の curIdx は最終点の distance_m を返す', () => {
    expect(distanceAlongCourse(course, 2, 0, 2)).toBe(250);
  });

  it('空コースは 0 を返す (= course load 前の事故耐性)', () => {
    expect(distanceAlongCourse([], 0, 0, 0)).toBe(0);
  });
});

describe('boot() の再入ガード (b12 Phase4 フリーズ回帰の pin)', () => {
  // boot() は container 引数を渡せば document に触れない。 渡した dbBounds では
  // 非同期処理 (three の動的 import) が node 環境で失敗するが、 booted フラグが
  // boot() の先頭で同期に立つことがこのテストの検証対象。 非同期失敗は catch される。
  afterEach(async () => {
    // boot() が仕込む 8 秒 fallback timer を、 非同期処理の決着 (= three import 失敗 →
    // catch → finally の clearTimeout) まで待って後始末する。
    await new Promise((res) => setTimeout(res, 60));
  });

  it('boot() を呼んだ直後に isBooted() が同期で true になる', () => {
    const r = createMapRenderer();
    expect(r.isBooted()).toBe(false);
    r.boot({ mode: 'static' }, { container: {}, dbBounds: null, onLoaded() {} });
    // 非同期完了を待たず、 同期で true。 ここが false のままだと viewer の再入が止まらない。
    expect(r.isBooted()).toBe(true);
  });

  it('viewer の "if (!isBooted()) で再入" パターンが 1 回で抜ける', () => {
    const r = createMapRenderer();
    let reentries = 0;
    let proceeded = false;
    // initBleMode / initTestMode 等が持つ起動ガードの模写。 修正前は isBooted() が
    // 非同期完了まで false のままで、 この関数が自分を呼び続け無限ループになった。
    function initLike() {
      if (!r.isBooted()) {
        reentries++;
        r.boot({}, { container: {}, onLoaded() {} });
        initLike();
        return;
      }
      proceeded = true;
    }
    initLike();
    expect(reentries).toBe(1);   // boot を 1 回撃ったら、 次の判定では抜ける
    expect(proceeded).toBe(true);
  });

  it('boot() の二重呼び出しは no-op (booted ガード)', () => {
    const r = createMapRenderer();
    r.boot({}, { container: {}, onLoaded() {} });
    expect(() => r.boot({}, { container: {}, onLoaded() {} })).not.toThrow();
    expect(r.isBooted()).toBe(true);
  });
});

describe('isValidBounds — dbBounds の検証', () => {
  it('[west,south,east,north] の有限数 4 要素 (E>=W,N>=S) を受理する', () => {
    expect(isValidBounds([138.7, 35.3, 138.9, 35.5])).toBe(true);
  });

  it('E==W / N==S の退化 bbox も受理する (>= 判定)', () => {
    expect(isValidBounds([138.7, 35.3, 138.7, 35.3])).toBe(true);
  });

  it('undefined / null / 非配列を弾く', () => {
    expect(isValidBounds(undefined)).toBe(false);
    expect(isValidBounds(null)).toBe(false);
    expect(isValidBounds('138,35,139,36')).toBe(false);
  });

  it('要素数が 4 でない配列を弾く', () => {
    expect(isValidBounds([138.7, 35.3, 138.9])).toBe(false);
    expect(isValidBounds([138.7, 35.3, 138.9, 35.5, 0])).toBe(false);
    expect(isValidBounds([])).toBe(false);
  });

  it('非有限値 (NaN / Infinity / 文字列) を含む配列を弾く', () => {
    expect(isValidBounds([138.7, NaN, 138.9, 35.5])).toBe(false);
    expect(isValidBounds([138.7, 35.3, Infinity, 35.5])).toBe(false);
    expect(isValidBounds(['138.7', 35.3, 138.9, 35.5])).toBe(false);
  });

  it('東西 / 南北が逆転した bbox を弾く (E<W, N<S)', () => {
    expect(isValidBounds([138.9, 35.3, 138.7, 35.5])).toBe(false);  // E<W
    expect(isValidBounds([138.7, 35.5, 138.9, 35.3])).toBe(false);  // N<S
  });
});
