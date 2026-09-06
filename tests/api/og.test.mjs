import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import * as og from '../../api/og.js';
import { FALLBACK_ARTICLES } from '../../api/_content_snapshot.js';

test('API package independently declares and locks its OG runtime dependency', async () => {
  const readJSON = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
  const root = await readJSON('../../package.json');
  const api = await readJSON('../../api/package.json');
  const lock = await readJSON('../../api/package-lock.json');
  assert.equal(api.dependencies?.['@vercel/og'], root.dependencies['@vercel/og']);
  assert.equal(lock.packages[''].dependencies['@vercel/og'], api.dependencies['@vercel/og']);
  assert.ok(lock.packages['node_modules/@vercel/og']?.integrity);
});

test('OG route uses the Node.js Web handler instead of an Edge bundle', () => {
  assert.equal(typeof og.GET, 'function');
  assert.notEqual(og.config?.runtime, 'edge');
  assert.notEqual(og.config?.runtime, 'experimental-edge');
});

test('OG handler renders PNG responses for titles and offline catalog fallback', async () => {
  // Exercise the real @vercel/og renderer without depending on Google Fonts
  // or GitHub availability. Font appearance is not a visual baseline here.
  const font = await readFile(new URL('../../node_modules/@vercel/og/dist/Geist-Regular.ttf', import.meta.url));
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
  let malformed = false;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === 'fonts.googleapis.com') {
      return new Response('@font-face { src: url(https://fonts.gstatic.com/test.ttf) format(\'truetype\'); }');
    }
    if (url.hostname === 'fonts.gstatic.com') return new Response(font);
    if (url.hostname === 'api.github.com') return malformed
      ? Response.json({content:Buffer.from("DN.ARTICLES=[{slug:'bad',title:unsupported()}];").toString('base64'),sha:'fixture'})
      : new Response('Unavailable', { status: 503 });
    throw new Error(`Unexpected network request: ${url.origin}`);
  };
  try {
    for (const query of ['title=Test&tag=Education', 'slug=glaucoma-comprehensive-guide']) {
      const response = await og.GET(new Request(`https://example.test/api/og?${query}`));
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /^image\/png/);
      assert.equal(response.headers.get('cache-control'), 'public, max-age=86400, s-maxage=3600, stale-while-revalidate=604800');
      const png = Buffer.from(await response.arrayBuffer());
      assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      assert.equal(png.readUInt32BE(16), 1200);
      assert.equal(png.readUInt32BE(20), 630);
    }
    malformed = true;
    process.env.GITHUB_TOKEN = 'fixture-token';
    const article = FALLBACK_ARTICLES.find(a => a.slug === 'glaucoma-comprehensive-guide');
    const reference = await og.GET(new Request('https://example.test/api/og?' + new URLSearchParams({slug:article.slug,title:article.title,tag:article.tag})));
    const fallback = await og.GET(new Request('https://example.test/api/og?slug='+article.slug));
    assert.deepEqual(Buffer.from(await fallback.arrayBuffer()), Buffer.from(await reference.arrayBuffer()), 'malformed catalog must retain the article card, not a generic card');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = originalToken;
  }
});
