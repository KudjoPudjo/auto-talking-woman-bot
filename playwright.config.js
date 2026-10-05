import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3211',
    browserName: 'chromium',
    channel: process.env.CI ? undefined : 'msedge',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node src/server.js --demo',
    url: 'http://127.0.0.1:3211',
    env: { PORT: '3211', DEMO_DATA_FILE: `./data/e2e-${Date.now()}.json` },
    reuseExistingServer: false,
  },
  reporter: 'list',
});
