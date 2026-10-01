const { test: base, expect } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../..');
const sources = ['index.html', 'api/admin/_new.js'];

function bootstrap(source) {
  const html = fs.readFileSync(path.join(root, source), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const fonts = scripts.filter((match) => match[1].includes("getElementById('hs-fonts')"));
  if (fonts.length !== 1) throw new Error(`Expected one font bootstrap in ${source}`);
  return fonts[0][1];
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

// Real cross-origin CSS responses, deliberately without Timing-Allow-Origin.
// Holding either response controls the load order without synthetic load events.
const test = base.extend({
  fontServers: async ({ page }, use) => {
    let cssPending;
    let htmlPending;
    let requestCount = 0;
    const css = http.createServer((req, res) => {
      requestCount++;
      const send = () => {
        const failed = req.url.includes('failed');
        res.writeHead(failed ? 404 : 200, {
          'Content-Type': 'text/css', 'Cache-Control': 'public, max-age=3600', Connection: 'close',
        });
        res.end(failed ? '' : ':root{--hs-font-css-applied:yes}');
      };
      if (req.url.includes('late')) cssPending = send;
      else send();
    });
    const cssOrigin = await listen(css);
    const html = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://fixture.invalid');
      const script = bootstrap(url.searchParams.get('source'));
      const mode = url.searchParams.get('mode');
      const cssUrl = `${cssOrigin}/${mode}.css`;
      const hash = crypto.createHash('sha256').update(script).digest('base64');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8', Connection: 'close',
        'Content-Security-Policy': `default-src 'none'; script-src 'sha256-${hash}'; style-src ${cssOrigin}; base-uri 'none'`,
      });
      res.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><link id="hs-fonts" rel="preload" as="style" href="${cssUrl}">`);
      const finish = () => res.end(`<script>${script}</script><noscript><link rel="stylesheet" href="${cssUrl}"></noscript></head><body><h1>Font loading diagnostic</h1></body></html>`);
      if (mode === 'early') htmlPending = finish;
      else finish();
    });
    const htmlOrigin = await listen(html);
    try {
      await use({
        url: (source, mode) => `${htmlOrigin}/?source=${encodeURIComponent(source)}&mode=${mode}`,
        cssOrigin,
        releaseHtml: () => { if (!htmlPending) throw new Error('HTML was not held'); htmlPending(); },
        releaseCss: () => { if (!cssPending) throw new Error('CSS was not held'); cssPending(); },
        requests: () => requestCount,
      });
    } finally {
      // This fixture depends on page so sockets close before browser teardown.
      await close(html);
      await close(css);
    }
  },
});

async function expectApplied(page) {
  await expect(page.locator('#hs-fonts')).toHaveAttribute('rel', 'stylesheet');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement)
    .getPropertyValue('--hs-font-css-applied').trim())).toBe('yes');
}

for (const source of sources) {
  test(`${source}: CSS completed before bootstrap still applies`, async ({ page, fontServers }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const response = page.waitForResponse(`${fontServers.cssOrigin}/early.css`);
    const navigation = page.goto(fontServers.url(source, 'early'));
    await (await response).finished();
    await expect(page.locator('#hs-fonts')).toBeAttached();
    await expect.poll(() => page.evaluate(() => performance.getEntriesByName(document.getElementById('hs-fonts').href).length)).toBeGreaterThan(0);
    await expect(page.locator('#hs-fonts')).toHaveAttribute('rel', 'preload');
    fontServers.releaseHtml();
    await navigation;
    await expectApplied(page);
    expect(errors).toEqual([]);
  });

  test(`${source}: CSS completed after bootstrap still applies`, async ({ page, fontServers }) => {
    await page.goto(fontServers.url(source, 'late'), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#hs-fonts')).toHaveAttribute('rel', 'preload');
    // The preload request can begin after DOMContentLoaded on a busy runner.
    await expect.poll(() => fontServers.requests()).toBe(1);
    fontServers.releaseCss();
    await expectApplied(page);
  });

  test(`${source}: failed CSS leaves readable fallback`, async ({ page, fontServers }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(fontServers.url(source, 'failed'));
    await expect(page.getByRole('heading', { name: 'Font loading diagnostic' })).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--hs-font-css-applied').trim())).toBe('');
    expect(errors).toEqual([]);
    expect(fontServers.requests()).toBeLessThanOrEqual(2);
  });

  test.describe(`${source}: JavaScript disabled`, () => {
    test.use({ javaScriptEnabled: false });
    test('noscript stylesheet remains usable', async ({ page, fontServers }) => {
      await page.goto(fontServers.url(source, 'noscript'));
      await expect(page.getByRole('heading', { name: 'Font loading diagnostic' })).toBeVisible();
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--hs-font-css-applied').trim())).toBe('yes');
    });
  });
}
