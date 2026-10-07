import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { editorFixtureRoute, captureEditorTasks } = require('../../scripts/preview-editor-tasks.cjs');

const base = new URL('https://candidate.vercel.app/');
async function requestFixture(url, method = 'GET') {
  const writes = [], outcome = {};
  await editorFixtureRoute(base, '<p>Disposable fixture</p>', writes)({
    request: () => ({ url: () => url, method: () => method }),
    abort: () => { outcome.aborted = true; },
    fulfill: response => { outcome.response = response; },
    continue: () => { outcome.transmitted = true; },
  });
  return { writes, ...outcome };
}

test('Preview editor fixture prevents save, upload, telemetry and external write requests from reaching a server', async () => {
  for (const url of ['/api/admin/save', '/api/admin/upload', '/api/analytics', 'https://external.example/collect']) {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const result = await requestFixture(new URL(url, base).href, method);
      assert.equal(result.aborted, true);
      assert.equal(result.transmitted, undefined);
      assert.deepEqual(result.writes, [url.startsWith('/') ? url : 'external']);
    }
  }
});

test('Preview editor fixture reads synthetic source while private endpoints and external analytics stay isolated', async () => {
  const source = await requestFixture(new URL('/api/admin/save?slug=existing-article', base).href);
  assert.equal(source.response.json.html, '<p>Disposable fixture</p>');
  assert.equal(source.transmitted, undefined);
  for (const path of ['/api/admin/history', '/api/admin/analytics', '/api/admin/site-version', '/admin/', '/admin.html']) {
    const result = await requestFixture(new URL(path, base).href);
    assert.equal(result.response.status, 503);
    assert.equal(result.transmitted, undefined);
  }
  assert.equal((await requestFixture('https://www.google-analytics.com/g/collect?query=private')).aborted, true);
  assert.equal((await requestFixture(new URL('/blog/blog-admin.js?v=20260712', base).href)).transmitted, true);
  assert.equal((await requestFixture('https://fonts.gstatic.com/font.woff2')).transmitted, true);
});

test('Preview editor capture refuses Production or credential-bearing origins before creating a browser context', async () => {
  const browser = { newContext() { assert.fail('Invalid target must not start a context'); } };
  for (const url of ['https://hsiao.chendermatologist.com/', 'https://user:secret@candidate.vercel.app/', 'https://candidate.vercel.app/?token=secret']) {
    await assert.rejects(captureEditorTasks(browser, new URL(url), [], 'a'.repeat(40), 'owner/repository'));
  }
});
