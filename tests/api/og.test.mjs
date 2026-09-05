import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import * as og from '../../api/og.js';

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
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === 'fonts.googleapis.com') {
      return new Response('@font-face { src: url(https://fonts.gstatic.com/test.ttf) format(\'truetype\'); }');
    }
    if (url.hostname === 'fonts.gstatic.com') return new Response(font);
    if (url.hostname === 'api.github.com') return new Response('Unavailable', { status: 503 });
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
  } finally {
    globalThis.fetch = originalFetch;
  }
});
