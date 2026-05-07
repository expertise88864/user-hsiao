// Visual regression tests for HsiaoEye — Playwright + git-tracked snapshots.
//
// To update baselines locally:
//   PW_BASE_URL=https://hsiao.chendermatologist.com npx playwright test --update-snapshots
//
// Pages covered: home, blog index, top-3 articles, tools, English mirror.
// Each page is captured at 3 viewports (mobile/tablet/desktop) so we catch
// responsive regressions.

const { test, expect } = require('@playwright/test');

const BASE = process.env.PW_BASE_URL || 'https://hsiao.chendermatologist.com';

const PAGES = [
  { name: 'home',           path: '/' },
  { name: 'blog-index',     path: '/blog/' },
  { name: 'dry-eye-myths',  path: '/blog/dry-eye-myths' },
  { name: 'pediatric-myopia', path: '/blog/pediatric-myopia-control' },
  { name: 'floaters',       path: '/blog/floaters-retinal-detachment' },
  { name: 'tools',          path: '/tools' },
  { name: 'en-home',        path: '/en/' },
];

const VIEWPORTS = [
  { name: 'mobile',  width: 390,  height: 844 },
  { name: 'tablet',  width: 820,  height: 1180 },
  { name: 'desktop', width: 1440, height: 900 },
];

for (const page of PAGES) {
  for (const vp of VIEWPORTS) {
    test(`${page.name} @ ${vp.name}`, async ({ page: pw }) => {
      await pw.setViewportSize(vp);
      await pw.goto(BASE + page.path, { waitUntil: 'networkidle' });
      // Wait for fonts to load (Noto Serif TC etc.)
      await pw.evaluate(() => document.fonts.ready);
      // Stabilise: hide cursor, freeze CSS animations
      await pw.addStyleTag({
        content: `*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; caret-color: transparent !important; }
                  /* Hide elements with non-deterministic content */
                  #hs-progress-widget, #hs-totop, #hs-bookmark, #hs-print-btn { display: none !important; }`,
      });
      await pw.waitForTimeout(500);  // settle
      await expect(pw).toHaveScreenshot(`${page.name}-${vp.name}.png`, {
        fullPage: vp.name !== 'mobile',  // mobile = first viewport only (faster)
        maxDiffPixelRatio: 0.02,         // tolerate 2% diff (font subpixel, etc.)
        animations: 'disabled',
      });
    });
  }
}
