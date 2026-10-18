// Local regression for scripts/sw-smoke.cjs, the service-worker check that the
// Delivery verification workflow runs once against the exact Preview.
const { test, expect } = require('@playwright/test');
const { serviceWorkerContract, serviceWorkerSmoke } = require('../../scripts/sw-smoke.cjs');

test.use({ serviceWorkers: 'allow' });

test('the home page registers, installs and precaches the worker and serves the offline page', async ({ context, page, baseURL }) => {
  const result = await serviceWorkerSmoke(context, page, baseURL);
  expect(result.state).toBe('activated');
  expect(result.precached).toContain('/offline');
  expect(result.precached).not.toContain('/');
  expect(result.homeDownloads).toBe(1);
});

test('the shell tier lists only canonical URLs that Vercel serves without a redirect', () => {
  const { cache, shell } = serviceWorkerContract();
  expect(cache).toMatch(/^hs-v\d+$/);
  for (const entry of shell) {
    expect(entry, entry).not.toMatch(/\.html$/);
    if (entry !== '/') expect(entry, entry).not.toMatch(/\/$/);
  }
});
