import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // b40: 配布元 (国土地理院 / OpenStreetMap) を実際に叩く spec と、 専用 config を持つ
  // pages_audit を、 ふだんの `npx playwright test` から物理排除する。 これらは手動専用:
  //   pages_live_fetch / pages_live_terrain_render … 実 GSI / OSM を叩く。
  //     手動時は `npx playwright test --config=e2e/playwright.pages-live.config.js`。
  //   pages_audit … ローカル `_site/` 専用、 `e2e/playwright.pages.config.js` 経由。
  // この testIgnore を外すと `npx playwright test` が無断で配布元を叩く事故が再発する。
  testIgnore: [
    '**/pages_audit.spec.js',
    '**/pages_live_fetch.spec.js',
    '**/pages_live_terrain_render.spec.js',
  ],
  timeout: 30_000,
  use: {
    channel: 'chrome',
    headless: true,
  },
  webServer: {
    command: 'python -m fujihill.bridge --dummy --http-port 8000 --port 8765',
    url: 'http://127.0.0.1:8000/',
    reuseExistingServer: true,
    timeout: 15_000,
    // b62: bridge の web 配信 root は fujihill パッケージの __file__ 相対。 editable
    // install は常に元 repo を指すため、 git worktree から e2e を回すと worktree の
    // web/ ではなく元 repo の web/ が配信され、 worktree の変更が検証されない。
    // PYTHONPATH=src で worktree の src/fujihill を優先 import させ、 配信 root を
    // worktree に向ける。 通常 checkout でも src layout で同じ repo を指すので無害。
    env: { PYTHONPATH: 'src' },
  },
});
