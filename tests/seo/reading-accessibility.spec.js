const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
test.use({ serviceWorkers: 'block' });

for (const [route, name] of [['/tools', /眼睛畏光/], ['/en/tools', /Eyes sensitive to light/]]) {
  test(`calculator labels name and focus every field on ${route}`, async ({ page }) => {
    await page.goto(route);
    const fields = page.locator('.hs-calc-input');
    await expect(fields).toHaveCount(20);
    await expect(fields.first()).toHaveAccessibleName(name);
    const labels = await fields.evaluateAll(inputs => inputs.map(input => ({
      id: input.id,
      named: input.labels.length === 1 && !!input.labels[0].textContent.trim(),
    })));
    expect(new Set(labels.map(label => label.id)).size).toBe(20);
    expect(labels.every(label => label.id && label.named)).toBe(true);
    await page.locator(`label[for="${labels[0].id}"]`).click();
    await expect(fields.first()).toBeFocused();
  });
}

test('font controls announce their state and cannot take focus when hidden', async ({ page }) => {
  await page.goto('/blog/dry-eye-myths');
  const controls = page.locator('#hs-font-sizer');
  await expect(controls).toHaveJSProperty('inert', true);
  await page.evaluate(() => window.scrollTo(0, 650));
  await expect(controls).toHaveAttribute('aria-hidden', 'false');
  // The region name must remain available to assistive technology without
  // expanding the floating toolbar with a visible label.
  await expect(controls).toHaveAccessibleName('字型大小調整');
  const label = controls.locator('#hs-font-size-label');
  await expect(label).toHaveCSS('position', 'absolute');
  await expect(label).toHaveCSS('overflow', 'hidden');
  const labelBounds = await label.boundingBox();
  expect(labelBounds.width).toBeLessThanOrEqual(1);
  expect(labelBounds.height).toBeLessThanOrEqual(1);
  const large = controls.getByRole('button', { name: '字型大小調整 大', exact: true });
  await large.click();
  await expect(large).toHaveAttribute('aria-pressed', 'true');
  await expect(controls.locator('[aria-pressed="true"]')).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem('hs-font-size'))).toBe('L');
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(controls).toHaveJSProperty('inert', true);
  await expect(controls).toHaveAttribute('aria-hidden', 'true');
});

test('newsletter remains readable when the device requests dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/blog/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('#dn-newsletter').scrollIntoViewIfNeeded();
  const result = await new AxeBuilder({ page }).include('#dn-newsletter')
    .withTags(['wcag2a', 'wcag2aa', 'best-practice']).analyze();
  expect(result.violations).toEqual([]);
});


test('rendered English-locale footer passes axe and real contrast defects still fail', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'en-US', serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    await page.goto(test.info().project.use.baseURL + '/blog/dry-eye-myths');
    await page.locator('#hs-osdi').waitFor({ state: 'attached' });
    const footer = page.locator('.mag-foot-bot');
    await require('../../scripts/a11y-rendering.cjs').prepareA11yPage(page);
    const scan = () => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'best-practice']).analyze();
    expect((await scan()).violations).toEqual([]);
    // The same scan must still reject a genuinely unreadable rendered footer.
    await footer.evaluate(element => { element.style.color = '#454139'; });
    const broken = await scan();
    expect(broken.violations.map(violation => violation.id)).toContain('color-contrast');
  } finally { await context.close(); }
});


test('audit preparation supports the tools page plain footer', async ({ page }) => {
  await page.goto('/tools');
  await page.locator('#hs-osdi').waitFor({ state: 'attached' });
  await require('../../scripts/a11y-rendering.cjs').prepareA11yPage(page);
  await expect(page.locator('footer')).toBeInViewport();
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'best-practice']).analyze();
  expect(result.violations).toEqual([]);
});
