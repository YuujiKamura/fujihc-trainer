import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
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
  },
});
