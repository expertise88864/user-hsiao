import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { isAdminRequest, requireAdmin } from '../../api/admin/_auth.js';
import { makeSessionToken } from '../../api/admin/_login.js';
import errors from '../../api/errors.js';

test('optional browser error reports share reader exclusions and never persist excluded reports', async t => {
  const keys = ['VERCEL_ENV', 'ADMIN_PASSWORD', 'KV_REST_API_URL', 'KV_REST_API_TOKEN'];
  const originals = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { VERCEL_ENV: 'production', ADMIN_PASSWORD: 'isolated-errors-fixture',
    KV_REST_API_URL: 'https://kv.example.test', KV_REST_API_TOKEN: 'fixture' });
  t.after(() => keys.forEach(key => {
    if (originals[key] === undefined) delete process.env[key]; else process.env[key] = originals[key];
  }));
  const logs = [], writes = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.ok(String(url).startsWith('https://kv.example.test/'));
    writes.push({ url, options }); return { ok: true };
  });
  const headers = { host: 'hsiao.chendermatologist.com', origin: 'https://hsiao.chendermatologist.com',
    'user-agent': 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36' };
  const send = async change => {
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, end() {}, json() {} };
    await errors({ method: 'POST', headers: { ...headers, ...change }, body: { type: 'error', message: 'fixture' } }, res);
    assert.equal(res.code, 204);
  };
  for (const change of [
    { origin: 'https://candidate.vercel.app' }, { cookie: 'hs_telemetry_optout=1' }, { dnt: '1' }, { 'sec-gpc': '1' },
    { 'user-agent': 'HeadlessChrome' }, { cookie: 'hs_admin_session=%invalid' },
    { cookie: 'hs_admin_session=' + makeSessionToken(process.env.ADMIN_PASSWORD) },
    { referer: 'https://hsiao.chendermatologist.com/blog/fixture?admin=1' },
  ]) await send(change);
  process.env.VERCEL_ENV = 'preview'; await send({}); process.env.VERCEL_ENV = 'production';
  assert.equal(logs.length, 0); assert.equal(writes.length, 0);
  await send({});
  assert.equal(logs.length, 1); assert.equal(writes.length, 2);
});

test('malformed session cookies fail closed with 401 and valid sessions still work', t => {
  const original = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = 'isolated-followup-fixture';
  t.after(() => {
    if (original === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = original;
  });
  for (const cookie of ['hs_admin_session=%', 'hs_admin_session=%E0%A4%A', 'hs_admin_session=%invalid']) {
    const req = { headers: { cookie } };
    assert.equal(isAdminRequest(req), false);
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    assert.equal(requireAdmin(req, res), false);
    assert.equal(res.code, 401);
  }
  assert.equal(isAdminRequest({ headers: { cookie: 'hs_admin_session=' + makeSessionToken(process.env.ADMIN_PASSWORD) } }), true);
});

const adminSource = readFileSync(new URL('../../blog/blog-admin.js', import.meta.url), 'utf8');
const encodingSource = adminSource.slice(adminSource.indexOf('    function encodeAt('), adminSource.indexOf('    var _avifProbeResult'));

for (const mode of ['reject', 'constructor-throws', 'missing-offscreen', 'success', 'no-encoder', 'canvas-throws', 'reader-fails']) {
  test(`actual image encoder settles using the native fallback when necessary: ${mode}`, async () => {
    let fallbackCalls = 0;
    const context = vm.createContext({
      window: { ImageEncoder: mode === 'no-encoder' ? undefined : true },
      ImageEncoder: class {
        constructor() { if (mode === 'constructor-throws') throw Error('unsupported'); }
        async encode() { if (mode !== 'success') throw Error('encode rejected'); return { data: Uint8Array.of(65) }; }
      },
      OffscreenCanvas: mode === 'missing-offscreen' ? undefined : class {
        getContext() { return { drawImage() {} }; }
        transferToImageBitmap() { return { close() {} }; }
      },
      document: { createElement() {
        fallbackCalls++;
        if (mode === 'canvas-throws') throw Error('canvas unavailable');
        return { getContext: () => ({ drawImage() {} }), toBlob(callback) { callback({}); } };
      } },
      FileReader: class {
        readAsDataURL() {
          if (mode === 'reader-fails') this.onerror(Error('reader failed'));
          else { this.result = 'data:image/webp;base64,RkFMTEJBQ0s='; this.onload(); }
        }
      },
      btoa: value => Buffer.from(value, 'binary').toString('base64'),
    });
    vm.runInContext(encodingSource, context);
    let timer;
    const pending = context.encodeAt({ width: 200, height: 100, image: {} }, 100, 'image/webp', 0.82);
    const settled = Promise.race([pending, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('encoding never settled')), 300);
    })]);
    try {
      if (mode === 'canvas-throws' || mode === 'reader-fails') await assert.rejects(settled, /canvas unavailable|reader failed/);
      else assert.equal(await settled, mode === 'success' ? 'QQ==' : 'RkFMTEJBQ0s=');
      assert.equal(fallbackCalls, mode === 'success' ? 0 : 1);
    } finally { clearTimeout(timer); }
  });
}
