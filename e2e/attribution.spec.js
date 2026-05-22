// E2E test: 地図タイルの帰属表示 (#attrib) が実ブラウザで可視であることを固定する。
//
// task-g (= 国土地理院 / OpenStreetMap 帰属表示の検証・修復)。
//
// vitest の静的 grep テスト (web/tests/integration_overlay_z_order.test.js) は
// #attrib 要素・verifyAttributionVisible 関数がソースに存在することしか pin できない。
// 「DOM に実在し実ブラウザで可視」(= display/visibility/opacity が表示状態、 他要素に
// 覆われていない) は実ブラウザでないと固定できない ── それを担うのがこの e2e。
//
// 起動方式は e2e/pairing_to_ride.spec.js を踏襲:
//   - ?test=1     → initTestMode: fake client、 500ms 後に自動 ride 開始
//   - ?consent=dev → intro overlay を物理 bypass
// playwright.config.js の webServer が bridge を自動起動する。
//
// なぜ riding state で pin するか: 地図タイルが描画される state でのみ帰属表示は意味を持つ。
// riding は ?test=1&consent=dev で確実に到達できる。#attrib は state 非依存で常時表示する
// 設計 (position:fixed / z-index 2001 / state 別 hide なし) なので、 riding で可視なら
// 他 state でも可視。

import { test, expect } from './base-test.js';

test('地図タイルの帰属表示 (#attrib) が riding 画面で可視、 GSI / OSM 両方の出典を含む', async ({ page }) => {
  // ?noterrain=1: 地形タイルを取得しない (= 配布元を叩かない)。 #attrib の可視性は地形と
  // 無関係なので、 地形ゼロでこのテストは成立する (= b40 / handoff 方針)。
  await page.goto('http://127.0.0.1:8000/?test=1&consent=dev&noterrain=1');

  // riding 到達まで待つ (pairing_to_ride.spec.js 同様、 bootEnv + 地形 boot + 500ms timer)。
  await expect(page.locator('body')).toHaveClass(/state-riding/, { timeout: 20_000 });

  const attrib = page.locator('#attrib');

  // 1. #attrib が実ブラウザで可視 (= display:none / visibility:hidden / opacity:0 / 0 サイズ
  //    なら fail)。「要素が消えた」「display:none を inject された」を捕まえる。
  await expect(attrib).toBeVisible();

  // 2. GSI と OSM 両方の出典文字列を含む (= 配布元 2 者の出典明示義務)。
  await expect(attrib).toContainText('国土地理院');
  await expect(attrib).toContainText('OpenStreetMap');

  // 3. getComputedStyle で display / visibility / opacity を直接 assert
  //    (= CSS で隠された状態を toBeVisible とは別経路でも捕まえる)。
  const style = await attrib.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { display: cs.display, visibility: cs.visibility, opacity: cs.opacity };
  });
  expect(style.display).not.toBe('none');
  expect(style.visibility).not.toBe('hidden');
  expect(parseFloat(style.opacity)).toBeGreaterThan(0);

  // 4. #attrib が他要素に覆われていないこと: 中心点を elementFromPoint で引き、 返る要素が
  //    #attrib 自身またはその子孫であることを確認 (= z-index で overlay に覆われたら別要素が
  //    返り fail)。「他要素に覆われた」を捕まえる。
  const topmostIsAttrib = await attrib.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit === el || el.contains(hit);
  });
  expect(topmostIsAttrib).toBe(true);

  // 5. GSI 利用規約が要求する地理院タイル一覧へのリンクを持つ (= CLAUDE.md の #attrib 要件)。
  await expect(attrib.locator('a[href*="maps.gsi.go.jp/development/ichiran.html"]')).toHaveCount(1);
});

test('brief 32 / b46: 帰属表示 (#attrib) が地形データローダー画面表示中も可視 (= overlay z-index 1450 < attrib z-index 2001)', async ({ page }) => {
  // b46: 起動シーンの第一段は地形データローダー画面 (= #intro-overlay の DOM 枠を再利用)。
  //   この画面表示中も #attrib が overlay の下に隠れないことを pin (= GSI 利用規約
  //   「出典クレジット必須」 + brief 32 軸 7 要件)。
  // ?noterrain=1: 地形タイルを取得しない (= 配布元を叩かない)。 #attrib の可視性は
  //   地形データローダー画面表示中も地形と無関係なので、 地形ゼロでこのテストは成立する。
  await page.goto('http://127.0.0.1:8000/?noterrain=1');
  await expect(page.locator('#intro-overlay')).toHaveClass(/visible/, { timeout: 20_000 });

  const attrib = page.locator('#attrib');
  await expect(attrib).toBeVisible();
  await expect(attrib).toContainText('国土地理院');
  await expect(attrib).toContainText('OpenStreetMap');

  // intro overlay 中心点と attrib 領域が重ならない、 もしくは attrib が上層に来ていることを
  // elementFromPoint で確認 (= z-index 比較を計算で確認するのではなく実 DOM stack で pin)。
  const topmostIsAttrib = await attrib.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit === el || el.contains(hit);
  });
  expect(topmostIsAttrib).toBe(true);
});
