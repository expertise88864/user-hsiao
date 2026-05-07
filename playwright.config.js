// Playwright config for HsiaoEye visual regression tests.
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/visual',
  timeout: 60_000,
  expect: { toHaveScreenshot: { threshold: 0.18 } },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.PW_BASE_URL || 'https://hsiao.chendermatologist.com',
    trace: 'on-first-retry',
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
  },
  snapshotPathTemplate: 'tests/visual/snapshots/{testFilePath}/{arg}{ext}',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
