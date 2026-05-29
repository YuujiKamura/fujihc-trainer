// b62 E2E: 機器設定パネルの大気散乱スライダーが、操作で atmosphere の散乱 uniform を
// 実際に動かし、viewer を固まらせないことを実ブラウザで pin する。
//
// misleading test 回避 (drift catalog NG-R5-14): スライダー DOM が「存在する」「クリック
// しても例外が出ない」だけでは、白濁⇔青澄みが動いた証明にならない ── スライダー要素が
// あって描画が壊れていても緑になる。本 spec は:
//   (1) atmoMie スライダーを操作 → window.__goalTest.atmo の uAtmoBetaMie uniform を
//       page.evaluate で読み、値が実際に変わったことを assert する。
//   (2) 操作後も描画ループ (window.__goalTest.frames) が進み続けることを assert する
//       (= viewer が固まらない、user_journey の frame 進行確認と同型)。
// 散乱の「見た目」(青い透明感) そのものは test では pin しきれない ── ?cap=1 実画面目視が
// 中核検証。本 spec は配線の数値正しさに限る。
//
// ?test=1&consent=dev&noterrain=1: TEST_MODE で trainer / BLE を skip し riding まで自動
// 進行、noterrain で地形タイルを配布元から取らず平坦地形で組む (= b40 見張りに触れない)。
// noterrain でも map3d boot は走り scene / atmosphere は生成される。
import { test, expect } from './base-test.js';
import { waitForPaintComplete } from './_helpers/paint_complete.js';

const VIEWER_URL = 'http://127.0.0.1:8000/index.html?test=1&consent=dev&noterrain=1';

// control_panel.js の createSliderRow は input.id を 'rng_' + def.key にする。
const MIE_SLIDER_ID = '#rng_atmoMie';

// control_panel の input リスナを実際に通して raw 値を流す ── 物理ドラッグではなく
// value 代入 + 'input' イベント dispatch (CLAUDE.md: GUI test でマウスを占有しない)。
// 経由する配線: input 'input' → applyControl → def.apply → mapRenderer.setAtmosphereParams。
async function setSlider(page, selector, raw) {
  await page.evaluate(({ sel, v }) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`slider ${sel} が DOM に無い`);
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, { sel: selector, v: raw });
}

// atmosphere の Mie 散乱 uniform (uAtmoBetaMie の x 成分) を読む。
async function readMieUniform(page) {
  return page.evaluate(() => {
    const atmo = window.__goalTest && window.__goalTest.atmo;
    return atmo ? atmo.uAtmoBetaMie.value.x : null;
  });
}

test('atmoMie スライダー操作で atmosphere の Mie uniform が実際に変わる', async ({ page }) => {
  await page.goto(VIEWER_URL);
  // riding まで自動進行 (attribution.spec.js と同経路)。この間に map3d boot が走り
  // scene + atmosphere が生成される。
  await expect(page.locator('body')).toHaveClass(/state-riding/, { timeout: 20_000 });
  // b130: slider 操作前に描画完了を pin (= atmosphere uniform は描画が走らないと意味なし).
  await waitForPaintComplete(page, { waitTerrainMesh: false });
  // atmosphere uniform が読める state まで待つ (= scene 生成完了)。
  await page.waitForFunction(() => !!(window.__goalTest && window.__goalTest.atmo),
    { timeout: 30_000 });

  // スライダーを下げる (raw 2 = βMie 2e-6) → uniform を読む。
  await setSlider(page, MIE_SLIDER_ID, 2);
  const low = await readMieUniform(page);
  expect(low, 'Mie uniform が読めない').not.toBeNull();

  // スライダーを上げる (raw 40 = βMie 40e-6、白濁側) → uniform が増える。
  await setSlider(page, MIE_SLIDER_ID, 40);
  const high = await readMieUniform(page);
  expect(high, 'Mie スライダーを上げても uniform が変わらない (配線断)').toBeGreaterThan(low);

  // スライダーを 0 (純 Rayleigh) → uniform も 0 付近へ。
  await setSlider(page, MIE_SLIDER_ID, 0);
  const zero = await readMieUniform(page);
  expect(zero, 'Mie 0 で uniform が下がらない').toBeLessThan(low);
});

test('atmoMie スライダー操作後も描画ループが固まらない', async ({ page }) => {
  await page.goto(VIEWER_URL);
  await expect(page.locator('body')).toHaveClass(/state-riding/, { timeout: 20_000 });
  // b130: slider 操作前に描画完了を pin (= atmosphere uniform は描画が走らないと意味なし).
  await waitForPaintComplete(page, { waitTerrainMesh: false });
  await page.waitForFunction(() => !!(window.__goalTest && window.__goalTest.atmo),
    { timeout: 30_000 });

  // スライダーを動かす。
  await setSlider(page, MIE_SLIDER_ID, 38);
  // 描画ループ生存カウンタ (_tickCount) が進み続けることを確認 ── スライダー操作で
  // viewer が例外で固まれば frames は止まる。
  const f1 = await page.evaluate(() => window.__goalTest.frames);
  await page.waitForTimeout(600);
  const f2 = await page.evaluate(() => window.__goalTest.frames);
  expect(f2, `描画ループが進んでいない (f1=${f1} f2=${f2}、スライダー操作で固まった疑い)`)
    .toBeGreaterThan(f1);
});
