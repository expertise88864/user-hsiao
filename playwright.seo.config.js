const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/seo',
  timeout: 90_000,
  webServer: {
    command: 'node tests/seo/static-server.js',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.PW_BASE_URL || 'http://127.0.0.1:4173',
    ...devices['Desktop Chrome'],
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    trace: 'on-first-retry',
  },
});
