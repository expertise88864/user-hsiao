const { defineConfig, devices } = require('@playwright/test');

const LOCAL_URL = 'http://127.0.0.1:43173';
const externalBaseUrl = process.env.PW_BASE_URL;

module.exports = defineConfig({
  testDir: './tests/seo',
  timeout: 90_000,
  webServer: externalBaseUrl ? undefined : {
    command: 'node tests/seo/static-server.js',
    url: LOCAL_URL,
    env: { ...process.env, PORT: '43173' },
    reuseExistingServer: false,
    timeout: 30_000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: externalBaseUrl || LOCAL_URL,
    ...devices['Desktop Chrome'],
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    trace: 'on-first-retry',
  },
});
