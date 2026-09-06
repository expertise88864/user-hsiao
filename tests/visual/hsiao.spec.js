// Visual regression tests for HsiaoEye — Playwright + git-tracked snapshots.
//
// To update baselines locally:
//   PW_BASE_URL=https://hsiao.chendermatologist.com npx playwright test --update-snapshots
//
// Pages covered: home, blog index, top-3 articles, tools, English mirror.
// Each page is captured at 3 viewports (mobile / tablet / desktop) so we
// catch responsive regressions.

const { test, expect } = require('@playwright/test');

const BASE = process.env.PW_BASE_URL || 'https://hsiao.chendermatologist.com';

const PAGES = [
  { name: 'home',             path: '/' },
  { name: 'blog-index',       path: '/blog/' },
  { name: 'dry-eye-myths',    path: '/blog/dry-eye-myths' },
  { name: 'pediatric-myopia', path: '/blog/pediatric-myopia-control' },
  { name: 'floaters',         path: '/blog/floaters-retinal-detachment' },
  { name: 'tools',            path: '/tools' },
  { name: 'en-home',          path: '/en/' },
];

const VIEWPORTS = [
  { name: 'mobile',  width: 390,  height: 844 },
  { name: 'tablet',  width: 820,  height: 1180 },
  { name: 'desktop', width: 1440, height: 900 },
];

// Block flaky third-party requests that pollute screenshots (analytics
// pixels, ad iframes, font CDN slowness sometimes causes FOIT in shot).
test.beforeEach(async ({ page, context }) => {
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (
      url.includes('googletagmanager.com') ||
      url.includes('google-analytics.com') ||
      url.includes('googlesyndication.com') ||
      url.includes('clarity.ms') ||
      url.includes('doubleclick.net')
    ) {
      route.abort();
      return;
    }
    route.continue();
  });
});

for (const page of PAGES) {
  for (const vp of VIEWPORTS) {
    test(`${page.name} @ ${vp.name}`, async ({ page: pw }) => {
      await pw.setViewportSize(vp);
      // Hero selection and any A/B sampling must be deterministic in snapshots.
      await pw.addInitScript(() => { Math.random = () => 0; });
      const response = await pw.goto(BASE + page.path, { waitUntil: 'networkidle', timeout: 60_000 });
      expect(response && response.status(), 'Never accept an HTTP error as a baseline').toBe(200);
      expect(new URL(pw.url()).origin, 'Never screenshot a login or production redirect').toBe(new URL(BASE).origin);
      await expect(pw.locator('main')).toBeVisible();
      await expect(pw.locator('h1').first()).toBeVisible();

      // Wait for fonts (Noto Serif TC + Inter) to fully load
      await pw.evaluate(() => document.fonts.ready);

      if (page.name === 'home' || page.name === 'en-home') {
        await pw.waitForFunction(() => (
          window.DN &&
          [...document.querySelectorAll('#hs-article-list .article-list-item')]
            .filter(el => getComputedStyle(el).display !== 'none').length === 5
        ));
        await expect(pw.locator('.home-faq')).toBeVisible();
      }

      // Stabilise rendering:
      //   - kill all CSS animations / transitions / view-transitions
      //   - hide non-deterministic floating widgets (progress bar, scroll-to-top)
      //   - hide the EN banner timestamp on /en/ pages
      //   - freeze caret blink
      await pw.addStyleTag({
        content: `*, *::before, *::after {
          animation: none !important;
          transition: none !important;
          caret-color: transparent !important;
        }
        ::view-transition-old(*), ::view-transition-new(*) { animation: none !important; }
        #hs-progress-widget, #hs-totop, #hs-bookmark, #hs-print-btn, #hs-pwa-btn,
        #hs-pwa-ios, #hs-sw-toast, #hs-feedback, .hs-push-btn,
        [data-google-query-id], iframe[src*="googletagmanager"], iframe[src*="doubleclick"] {
          display: none !important;
        }
        /* Hide the relative-time badges (e.g. "5 days ago") that change daily */
        time[data-relative], .hs-relative-time { display: none !important; }`,
      });

      // Scroll to top to standardise position, then settle
      await pw.evaluate(() => window.scrollTo(0, 0));
      await pw.waitForTimeout(700);

      const hasHorizontalOverflow = await pw.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      );
      expect(hasHorizontalOverflow, `${page.name} @ ${vp.name} has horizontal overflow`).toBe(false);

      await expect(pw).toHaveScreenshot(`${page.name}-${vp.name}.png`, {
        // mobile = above-the-fold only (faster, less brittle to long-page changes)
        // tablet/desktop = full page
        fullPage: vp.name !== 'mobile',
        animations: 'disabled',
        timeout: 15_000,
      });
    });
  }
}
