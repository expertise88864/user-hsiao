// Playwright config for HsiaoEye visual regression tests.
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/visual',
  timeout: 90_000,            // 90s — production cold-cache + font load can be slow
  expect: {
    // Pixel-level diff tolerance (per pixel). 0.2 is the Playwright default;
    // we tighten slightly to catch real visual changes but allow font subpixel
    // jitter across Linux/macOS rendering.
    toHaveScreenshot: { threshold: 0.18, maxDiffPixelRatio: 0.025 },
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // No automatic retries. 10/14-10/17 CI history had zero flaky passes: every
  // retried screenshot failed all three attempts (reviewed content changes
  // awaiting owner-approved baselines), so retries only tripled the requests
  // to the deployment under test. A failure must be diagnosed, not re-rolled.
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.PW_BASE_URL || 'https://hsiao.chendermatologist.com',
    // Protected Preview traces may contain authentication cookies. Screenshots
    // and assertion output remain available without persisting credentials.
    trace: process.env.PW_BASE_URL ? 'off' : 'on-first-retry',
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    // Disable JS animations in headless context — reduces flake from
    // reveal-on-scroll, view-transitions, hover effects.
    reducedMotion: 'reduce',
    // The service worker never paints and a first visit is not controlled by
    // it, but installing it precaches the shell on every fresh context: block
    // it here. scripts/sw-smoke.cjs (Delivery verification) tests the worker.
    serviceWorkers: 'block',
  },
  snapshotPathTemplate: 'tests/visual/snapshots/{testFilePath}/{arg}{ext}',
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Force a stable color scheme + DPI so screenshots are deterministic
        colorScheme: 'light',
        deviceScaleFactor: 1,
      },
    },
  ],
});
