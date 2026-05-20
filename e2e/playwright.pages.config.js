// brief 33 責務 4: Pages 配信物 (= _site/) に対する e2e。
// 既存 playwright.config.js は bridge mode (= python -m fujihc.bridge で web/ を serve) で動く、
// 本 config は Pages 配信物に対する独立 e2e。
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'pages_audit.spec.js',
  timeout: 30_000,
  use: {
    channel: 'chrome',
    headless: true,
    baseURL: 'http://127.0.0.1:18765/',
  },
  webServer: {
    // _site/ を http.server で serve (= Pages 環境の simulation)、 18765 port で起動
    command: 'python -m http.server 18765 --directory _site',
    url: 'http://127.0.0.1:18765/',
    reuseExistingServer: false,
    timeout: 10_000,
    cwd: '..',
  },
});
