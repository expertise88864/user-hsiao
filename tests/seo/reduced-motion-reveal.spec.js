const { test, expect } = require('@playwright/test');
test.use({ serviceWorkers: 'block' });

// Regression 2026-10-17: axe on production /blog/ found article cards 3–5 at
// opacity 0.17–0.38 for reduced-motion readers. DN.bindRevealOnScroll's inline
// opacity/transform/transition beat the reduced-motion CSS. Reduced motion must
// leave every card fully opaque with no fade, whether it is set before load or
// switched on after the reveal effect has started.

async function settle(page) {
  // The reveal effect is bound in the idle phase; wait for it, then scroll the
  // whole page so IntersectionObserver / scroll timelines get a chance to run.
  await page.waitForFunction(() => window.DN && document.readyState === 'complete');
  await page.evaluate(() => new Promise(resolve => (window.requestIdleCallback || setTimeout)(() => resolve(), { timeout: 2000 })));
  await page.evaluate(async () => {
    const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    for (let y = 0; y < document.documentElement.scrollHeight; y += 300) { window.scrollTo(0, y); await frame(); }
    window.scrollTo(0, 0);
    await frame();
  });
}

async function cards(page) {
  return page.evaluate(() => [...document.querySelectorAll('.article-list-item, .hs-pin-card, .reveal, .myth-card')]
    .filter(el => getComputedStyle(el).display !== 'none')
    .map(el => ({
      card: el.getAttribute('href') || el.className,
      opacity: getComputedStyle(el).opacity,
      transform: getComputedStyle(el).transform,
      animations: el.getAnimations().filter(a => a.playState === 'running').length,
    })));
}

function expectStill(list) {
  expect(list.length).toBeGreaterThan(4);
  expect(list.filter(c => c.opacity !== '1' || !['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(c.transform) || c.animations)).toEqual([]);
}

for (const route of ['/blog/', '/']) {
  test(`reduced motion from the start keeps every card opaque: ${route}`, async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce', serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.goto(route);
    await settle(page);
    await expect(page.locator('#hs-reveal-css')).toHaveCount(0);
    expectStill(await cards(page));
    await context.close();
  });

  test(`reduced motion switched on after load neutralises the reveal: ${route}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(route);
    await page.waitForFunction(() => document.getElementById('hs-reveal-css'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await settle(page);
    expectStill(await cards(page));
  });
}
