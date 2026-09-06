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
  retries: process.env.CI ? 2 : 0,
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
    // Block third-party analytics / ad-tech that load asynchronously and
    // can leak into screenshots (GTM iframes, Clarity overlay, etc.)
    // serviceWorkers controlled per-test below.
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
