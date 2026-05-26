// brief 34 ε-8 / b46: 「観る」モード (= 区間選択型コース分析) の integration test.
//
// b46 全面再設計: 観るモードの判定 signal を intro consent (= getIntroConsent().mode
//   === 'view') から body.classList.contains('mode-view') へ移行した。 起動シーンを
//   地形データローダー画面の一本道に作り変え、 観るモードはトレーナー接続画面の
//   「コースを観る」 ボタン (#btnSetupGoView) からのみ入る。 本 test は intro consent
//   経由の検証を撤去し、 body.mode-view 判定で観るモードの振る舞いを pin し直す。
//
// 検証範囲:
//   1. body.mode-view が付くと観るモード ── addRide / getClientId guard が効く
//      (= 走行ログ保存なし / Strava 非対応、 物理 guard)。
//   2. section list 行クリック → rideState.startFrom(start_idx) で section 始点から ride.
//   3. rideState は end 後に別区間で startFrom し直せる (= 別区間の選び直し)。
//   4. viewer source: btnSetupGoView が body.mode-view を add、 観るモード判定が
//      body.classList.contains('mode-view') 経由であること。
//
// vitest default (= node 環境) で書く、 happy-dom 不使用。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { splitCourseIntoSections } from '../lib/course_sections.js';
import { createRideState } from '../lib/ride_state.js';
import { withCumulativeDistance } from './_helpers/course_fixture.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWER_PATH = resolve(__dirname, '..', 'viewer-maplibre.js');
const INDEX_PATH = resolve(__dirname, '..', 'index.html');
const viewer = readFileSync(VIEWER_PATH, 'utf8');
const html = readFileSync(INDEX_PATH, 'utf8');

// body.classList の最小 shim (= node 環境、 jsdom 不使用).
function makeBody() {
  const classes = new Set();
  return {
    classList: {
      add(c) { classes.add(c); },
      remove(c) { classes.delete(c); },
      contains(c) { return classes.has(c); },
    },
  };
}

// 単純 course (= 11 点 / 5% 一定勾配). distance_m は haversine 累積で自己整合に埋める.
function buildSimpleCourse() {
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    pts.push({
      elevation_m: 100 + i * 50,
      slope_pct: 5,
      lat: 35.0 + i * 0.001,
      lon: 138.7 + i * 0.001,
    });
  }
  return withCumulativeDistance(pts);
}

describe('b46 integration: body.mode-view が観るモードの判定 signal', () => {
  it('mode-view 無し → addRide guard を通す (= 走るモードは記録対象)', async () => {
    const body = makeBody();
    // viewer の addRide guard を 1:1 再現 (= body.mode-view 判定).
    let addRideCalled = 0;
    const guardedAddRide = async () => {
      if (body.classList.contains('mode-view')) return false;
      addRideCalled += 1;
      return true;
    };
    await guardedAddRide();
    expect(addRideCalled).toBe(1);
  });

  it('mode-view 付き → addRide guard が no-op (= 観るモードは記録対象外)', async () => {
    const body = makeBody();
    body.classList.add('mode-view');
    let addRideCalled = 0;
    let statusMsg = '';
    const guardedAddRide = async () => {
      if (body.classList.contains('mode-view')) {
        statusMsg = '観るモードは記録対象外';
        return false;
      }
      addRideCalled += 1;
      return true;
    };
    const r = await guardedAddRide();
    expect(addRideCalled).toBe(0);
    expect(r).toBe(false);
    expect(statusMsg).toMatch(/観るモード/);
  });

  it('mode-view 付き → getClientId が null (= Strava upload 物理 disable)', () => {
    const body = makeBody();
    body.classList.add('mode-view');
    const guardedGetClientId = () => {
      if (body.classList.contains('mode-view')) return null;
      return 'fake-client-id';
    };
    expect(guardedGetClientId()).toBe(null);
  });

  it('mode-view 無し → getClientId は client_id を返す (= 走るモードは Strava 対象)', () => {
    const body = makeBody();
    const guardedGetClientId = () => {
      if (body.classList.contains('mode-view')) return null;
      return 'fake-client-id';
    };
    expect(guardedGetClientId()).toBe('fake-client-id');
  });
});

describe('b46 integration: section list の区間選択 → rideState start_idx inject', () => {
  it('単純 course の区間 0 をクリック → rideState.snapshot().idx === section.start_idx', () => {
    const course = buildSimpleCourse();
    const rs = createRideState(course);
    const sections = splitCourseIntoSections(course, 10);
    expect(sections.length).toBe(10);
    rs.startFrom(sections[0].start_idx);
    expect(rs.snapshot().idx).toBe(sections[0].start_idx);
    expect(rs.snapshot().idx).toBe(0);
    expect(rs.snapshot().active).toBe(true);
    expect(rs.snapshot().paused).toBe(false);
  });

  it('section 5 をクリック → rideState の idx / distance が section 始点に inject される', () => {
    const course = buildSimpleCourse();
    const rs = createRideState(course);
    const sections = splitCourseIntoSections(course, 10);
    const target = sections[5];
    rs.startFrom(target.start_idx);
    const snap = rs.snapshot();
    expect(snap.idx).toBe(target.start_idx);
    expect(snap.distance).toBeCloseTo(target.start_dist, 3);
  });

  it('section 末尾 (= 区間 9) をクリック → rideState 末端付近から開始', () => {
    const course = buildSimpleCourse();
    const rs = createRideState(course);
    const sections = splitCourseIntoSections(course, 10);
    const last = sections[sections.length - 1];
    rs.startFrom(last.start_idx);
    expect(rs.snapshot().idx).toBe(last.start_idx);
  });
});

describe('b46 integration: rideState は end 後に別区間で startFrom し直せる', () => {
  it('rideState.end → snapshot().active === false (= 別区間選び直し可能)', () => {
    const course = buildSimpleCourse();
    const rs = createRideState(course);
    const sections = splitCourseIntoSections(course, 10);
    rs.startFrom(sections[3].start_idx);
    expect(rs.snapshot().active).toBe(true);
    rs.end();
    expect(rs.snapshot().active).toBe(false);
    rs.startFrom(sections[7].start_idx);
    expect(rs.snapshot().idx).toBe(sections[7].start_idx);
    expect(rs.snapshot().active).toBe(true);
  });
});

describe('b46 integration: HTML DOM 構造', () => {
  it('section-list-panel (= 右上常時表示 panel) + section-list ul が HTML に存在', () => {
    expect(html).toMatch(/<aside\s+id="section-list-panel"/);
    expect(html).toMatch(/<ul\s+id="section-list"/);
  });

  it('section-list-panel は body.mode-view のときだけ display:block (= 走るモード時は非表示)', () => {
    expect(html).toMatch(/body\.mode-view\s+#section-list-panel\s*\{\s*display:\s*block/);
    expect(html).toMatch(/#section-list-panel\s*\{[^}]*display:\s*none/);
  });

  it('トレーナー接続画面 (#setup-overlay) に「コースを観る」 ボタン #btnSetupGoView がある', () => {
    expect(html).toMatch(/id="btnSetupGoView"/);
  });
});

describe('b46 integration: viewer-maplibre.js の source 構造', () => {
  it('viewer は course_sections.js を import している (= splitCourseIntoSections / formatSectionLabel)', () => {
    expect(viewer).toMatch(/from\s+['"]\.\/lib\/course_sections\.js['"]/);
    expect(viewer).toMatch(/splitCourseIntoSections/);
    expect(viewer).toMatch(/formatSectionLabel/);
  });

  it('initViewMode 関数が定義されている', () => {
    expect(viewer).toMatch(/function\s+initViewMode\s*\(\s*\)/);
  });

  it('btnSetupGoView click handler が body.mode-view を add + initViewMode を呼ぶ (= 観るモード入口)', () => {
    // b46: 旧 setIntroConsent({mode:'view'}) を撤去、 body.classList.add('mode-view') を明示。
    expect(viewer).toMatch(/btnSetupGoView[\s\S]{0,400}classList\.add\(['"]mode-view['"]\)[\s\S]{0,200}initViewMode\(/);
  });

  it('addRide / getClientId の guard が body.mode-view 判定で観るモードを short-circuit', () => {
    // b46: 観るモード判定を getIntroConsent().mode === 'view' から
    //   body.classList.contains('mode-view') へ移行。
    expect(viewer).toMatch(/addRide:\s*async[\s\S]{0,400}classList\.contains\(['"]mode-view['"]\)[\s\S]{0,200}return/);
    expect(viewer).toMatch(/getClientId:[\s\S]{0,300}classList\.contains\(['"]mode-view['"]\)[\s\S]{0,100}return\s+null/);
  });

  it('viewer source に intro consent (getIntroConsent / setIntroConsent) の呼出が無い (= b46 撤去)', () => {
    // コメント内の言及は許すが、 実際の関数呼出 `getIntroConsent(` は無いこと。
    expect(viewer).not.toMatch(/[^/]getIntroConsent\s*\(/);
    expect(viewer).not.toMatch(/[^/]setIntroConsent\s*\(/);
  });

  it('initViewMode は createTestModeClient を使う (= trainer / bridge 不要)', () => {
    const m = viewer.match(/function\s+initViewMode\s*\(\s*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/createTestModeClient\(/);
  });

  it('renderSectionList 関数で行クリック → rideState.startFrom(section.start_idx) を呼ぶ', () => {
    expect(viewer).toMatch(/function\s+renderSectionList\s*\(/);
    expect(viewer).toMatch(/rideState\.startFrom\(/);
  });
});

describe('b47: 観る→走る遷移で mode-view フラグが外れる', () => {
  // mode-view は付ける箇所が 3 つに対し外す箇所が exitViewModeToSetup 1 つしかなく、
  // 観るモードの区間ライド中に btnOpenPairing で走るモードへ移ると mode-view が残る bug。
  it('startRideConfirmed が実走開始時に body から mode-view を外す', () => {
    // 実走開始は「観るモードではない」 ことが確定する瞬間。 経路に依らず矛盾状態
    // (= 実走中かつ観るモード) を断つため、 唯一の実走窓口でフラグを強制解除する。
    const m = viewer.match(/function\s+startRideConfirmed\s*\(\s*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/classList\.remove\(['"]mode-view['"]\)/);
  });

  it('showPairing が mode-view 中に btnClosePairing を「観るモードに戻る」 で visible にする (= b115)', () => {
    // user 2026-05-26 訂正: 観るモード中に機器設定を開いて閉じる動線が必要。
    //   btnClosePairing は HTML で hidden 既定、 showPairing で state-riding (= 実走中) と
    //   mode-view (= 観るモード) の 2 ケースで visible 化 + label 切替する設計。
    //   ここでは「mode-view 分岐があり、 label が観るモードに戻る」 を pin する。
    const m = viewer.match(/function\s+showPairing\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
    expect(m, 'showPairing が見つからない').not.toBeNull();
    expect(m[0]).toMatch(/classList\.contains\(['"]mode-view['"]\)/);
    expect(m[0]).toMatch(/観るモードに戻る/);
  });

  it('btnOpenPairing ハンドラは mode-view 状態に依らず showPairing のみを呼ぶ (= b115)', () => {
    // user 2026-05-26 訂正: 観るモード中に btnOpenPairing で機器設定 overlay を開いて
    //   閉じた時、 観るモードに戻る動線が無いと困る。 mode-view 解除は startRideConfirmed
    //   (= 実走開始の唯一の窓口、 上の test で pin 済) が担う規律なので、 btnOpenPairing
    //   で先回り解除する必要は無い ── ここでは「分岐せず showPairing のみ」 を pin する。
    //   handler 本体は addEventListener('click', () => { ... }) の中、 同 listener 内に
    //   exitViewModeToSetup の呼び出しが含まれないこと + showPairing の呼び出しが
    //   含まれることを pin。
    const m = viewer.match(/getElementById\(['"]btnOpenPairing['"]\)\.addEventListener\(['"]click['"],[\s\S]*?\n\}\);/);
    expect(m, 'btnOpenPairing handler が見つからない').not.toBeNull();
    expect(m[0]).toMatch(/showPairing\(\)/);
    expect(m[0]).not.toMatch(/exitViewModeToSetup\(/);
  });
});
