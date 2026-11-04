import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import sitemap from '../../api/sitemap.js';

test('dynamic sitemap discovers the indexable Chinese anatomy tool without inventing an English mirror', async () => {
  const originalFetch = globalThis.fetch;
  const previous = Object.fromEntries(['GH_TOKEN', 'GITHUB_TOKEN'].map(key => [key, process.env[key]]));
  process.env.GH_TOKEN = 'fixture-token'; process.env.GITHUB_TOKEN = 'fixture-token';
  globalThis.fetch = async () => { throw new Error('isolated sitemap fallback fixture'); };
  const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; }, send(body) { this.body = body; return this; } };
  try {
    await sitemap({ method: 'GET', headers: {} }, res);
    assert.equal(res.code, 200);
    const url = 'https://hsiao.chendermatologist.com/tools/eye-3d';
    const blocks = res.body.match(/<url>[\s\S]*?<\/url>/g);
    const entry = blocks.filter(block => block.includes(`<loc>${url}</loc>`));
    assert.equal(entry.length, 1, 'the public tool must be submitted exactly once');
    assert.ok(entry[0].includes(`hreflang="zh-Hant-TW" href="${url}"`));
    assert.ok(entry[0].includes(`href="${url}"`));
    assert.ok(!entry[0].includes('hreflang="en"'));
    assert.ok(!res.body.includes('/en/tools/eye-3d'));
    const source = await readFile(new URL('../../tools/eye-3d.html', import.meta.url), 'utf8');
    assert.ok(source.includes(`rel="canonical" href="${url}"`));
    assert.ok(!/<meta\s+name="robots"[^>]*noindex/i.test(source));
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('Last-Modified follows the newest <lastmod>, so an exam-only update is not answered with 304', async () => {
  const originalFetch = globalThis.fetch;
  const previous = Object.fromEntries(['GH_TOKEN', 'GITHUB_TOKEN'].map(key => [key, process.env[key]]));
  process.env.GH_TOKEN = 'fixture-token'; process.env.GITHUB_TOKEN = 'fixture-token';
  globalThis.fetch = async () => { throw new Error('isolated sitemap fallback fixture'); };
  const call = async headers => {
    const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; },
      status(code) { this.code = code; return this; }, send(body) { this.body = body; return this; },
      end() { return this; } };
    await sitemap({ method: 'GET', headers }, res);
    return res;
  };
  try {
    const first = await call({});
    assert.equal(first.code, 200);
    const dates = [...first.body.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map(m => m[1].slice(0, 10));
    const newest = dates.reduce((a, b) => (b > a ? b : a));
    assert.equal(first.headers['Last-Modified'], new Date(`${newest}T00:00:00Z`).toUTCString());
    // A client holding a copy from the day before the newest page date must get the new XML.
    const dayBefore = new Date(Date.parse(`${newest}T00:00:00Z`) - 86400000).toUTCString();
    assert.equal((await call({ 'if-modified-since': dayBefore })).code, 200);
    assert.equal((await call({ 'if-modified-since': first.headers['Last-Modified'] })).code, 304);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
