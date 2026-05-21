// b40 直し1-b: 配布元 (実 GSI / OSM endpoint) を意図的に叩く pages_live 系 2 spec 専用の config。
// default `playwright.config.js` の testIgnore で除外したこれらを、 人間が手動で 1 回だけ
// 走らせるための経路。 webServer を持たず、 実 URL (Pages 配信サーバ / 配布元) を直に相手にする。
//
// 既存 `playwright.pages.config.js` は pages_audit (= ローカル `_site/`、 port 18765) 専用、
// 本 config とは責務が別 ── 1 つの config に pages_audit と pages_live を混ぜない。
//
// 本 config は配布元を「意図的に」叩く手動経路なので、 pin 1 の配布元到達 gate
// (= e2e/base-test.js) の対象外。 ゆえに pages_live 系 2 spec は @playwright/test を直 import する。
//
// 実行: npx playwright test --config=e2e/playwright.pages-live.config.js
// CI からは .github/workflows/pages-live-verify.yml が workflow_dispatch (手動) で本 config を呼ぶ。
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['pages_live_fetch.spec.js', 'pages_live_terrain_render.spec.js'],
  timeout: 30_000,
  use: {
    channel: 'chrome',
    headless: true,
  },
  // webServer 無し ── 実 Pages 配信サーバ / 配布元を直接相手にするため、 ローカル server を立てない。
});
