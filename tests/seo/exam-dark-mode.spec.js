const { test, expect } = require('@playwright/test');
test.use({ serviceWorkers: 'block' });

// Owner report 2026-10-16: in dark mode the outline buttons on /exam were
// unreadable (dark text on a dark background). Scan every public exam page
// shell in dark mode for colour-contrast problems.
for (const route of ['/exam', '/exam/bcsc12-4', '/exam/concepts', '/exam/practice', '/exam/review', '/exam/search', '/exam/progress', '/exam/login']) {
  test(`exam page is readable in dark mode: ${route}`, async ({ page }) => {
    await page.route('**/api/exam/data**', r => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(route);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const AxeBuilder = require('@axe-core/playwright').default;
    const result = await new AxeBuilder({ page }).include('main').withRules(['color-contrast']).analyze();
    expect(result.violations.map(v => v.nodes.map(n => n.target.join(' ')).join(', '))).toEqual([]);
  });
}
