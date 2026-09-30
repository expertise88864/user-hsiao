import assert from 'node:assert/strict';
import test from 'node:test';
import policy from '../../assets/telemetry.js';
import { telemetryExclusion } from '../../api/_telemetry.js';
import ingest from '../../api/cwv-ingest.js';
import search from '../../api/search-log.js';
import abStats from '../../api/admin/_ab-stats.js';
import login, { makeSessionToken } from '../../api/admin/_login.js';

const HUMAN = 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36';
const context = { hostname: policy.HOST, protocol: 'https:', pathname: '/blog/glaucoma-comprehensive-guide', userAgent: HUMAN };
const headers = { host: policy.HOST, origin: 'https://' + policy.HOST, 'user-agent': HUMAN };
const response = () => ({ code: 0, headers: {},
  setHeader(key, value) { this.headers[key] = value; },
  status(code) { this.code = code; return this; },
  json(body) { this.body = body; return this; }, end() { return this; },
});
function setup(t) {
  const keys = ['VERCEL_ENV', 'ADMIN_PASSWORD', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'SEARCH_LOG_ENABLED'];
  const originals = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.VERCEL_ENV = 'production';
  process.env.ADMIN_PASSWORD = 'eligibility-fixture-password';
  process.env.KV_REST_API_URL = 'https://kv.example.test';
  process.env.KV_REST_API_TOKEN = 'fixture';
  process.env.SEARCH_LOG_ENABLED = '1';
  t.after(() => keys.forEach(key => {
    if (originals[key] === undefined) delete process.env[key]; else process.env[key] = originals[key];
  }));
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.ok(String(url).startsWith('https://kv.example.test/'), 'never write to GitHub or analytics in tests');
    calls.push({ url, options });
    const commands = options?.body ? JSON.parse(options.body) : [];
    return { ok: true, json: async () => String(url).endsWith('/pipeline')
      ? commands.map(([cmd]) => ({ result: cmd === 'HGETALL' ? [] : 1 }))
      : { result: String(url).includes('/hgetall/') ? [] : 1 } };
  });
  return calls;
}

test('canonical HTTPS readers are eligible; Preview, editor, automation and privacy opt-outs are excluded', () => {
  assert.equal(policy.exclusionReason(context), null);
  for (const [change, reason] of [
    [{ hostname: 'user-hsiao-test.vercel.app' }, 'environment'], [{ hostname: 'localhost' }, 'environment'],
    [{ protocol: 'http:' }, 'environment'], [{ pathname: '/admin/' }, 'admin'],
    [{ pathname: '/en/admin.html' }, 'admin'], [{ search: '?admin=1' }, 'admin'],
    [{ adminEditing: true }, 'admin'], [{ optOut: true }, 'opt_out'],
    [{ doNotTrack: '1' }, 'privacy_preference'], [{ globalPrivacyControl: true }, 'privacy_preference'],
    [{ webdriver: true }, 'automation'], [{ userAgent: 'Googlebot' }, 'automation'],
    [{ userAgent: 'HeadlessChrome' }, 'automation'], [{ prerendering: true }, 'prerender'],
  ]) assert.equal(policy.exclusionReason({ ...context, ...change }), reason);
  assert.equal(policy.exclusionReason({ ...context, pathname: '/blog/administering-eye-drops' }), null);
});

test('server requires production and the canonical origin, independently excludes signed admin sessions', t => {
  setup(t);
  const req = { headers: { ...headers } };
  assert.equal(telemetryExclusion(req), null);
  process.env.VERCEL_ENV = 'preview';
  assert.equal(telemetryExclusion(req), 'environment');
  process.env.VERCEL_ENV = 'production';
  for (const [change, reason] of [
    [{ origin: 'https://candidate.vercel.app' }, 'environment'],
    [{ referer: 'https://' + policy.HOST + '/blog/glaucoma-comprehensive-guide?admin=1' }, 'admin'],
    [{ referer: 'https://elsewhere.example/' }, 'environment'],
    [{ cookie: 'hs_admin_session=' + makeSessionToken(process.env.ADMIN_PASSWORD) }, 'admin'],
    [{ cookie: 'hs_telemetry_optout=1' }, 'opt_out'], [{ cookie: 'hs_admin_session=%invalid' }, 'invalid_session'],
    [{ dnt: '1' }, 'privacy_preference'], [{ 'sec-gpc': '1' }, 'privacy_preference'],
    [{ 'user-agent': 'Playwright' }, 'automation'],
  ]) assert.equal(telemetryExclusion({ headers: { ...headers, ...change } }), reason);
  assert.equal(telemetryExclusion({ headers: { ...headers, cookie: 'hs_admin_session=forged' } }), null);
  assert.equal(telemetryExclusion({ headers: { host: policy.HOST, 'user-agent': HUMAN } }), null);
  assert.equal(telemetryExclusion({ headers: {} }), 'environment');
});

test('excluded public endpoints make no growth-storage writes; opt-out never authorizes private stats', async t => {
  const calls = setup(t);
  for (const [handler, body] of [
    [ingest, { name: 'CLS', value: 0 }], [search, { q: '乾眼' }],
    [abStats, { testId: 'fixture', variantIndex: 0, event: 'exposure' }],
  ]) {
    const res = response();
    await handler({ method: 'POST', headers: { ...headers, cookie: 'hs_telemetry_optout=1' }, body }, res);
    assert.ok([200, 202, 204].includes(res.code));
    if (res.body) assert.equal(res.body.stored, false);
  }
  assert.equal(calls.length, 0);
  const res = response();
  await abStats({ method: 'GET', headers: { ...headers, cookie: 'hs_telemetry_optout=1' }, query: {} }, res);
  assert.equal(res.code, 401);
});

test('CWV accepts measured zero and only reports stored after successful bounded KV persistence', async t => {
  const calls = setup(t);
  const req = { method: 'POST', headers, body: { name: 'CLS', value: 0, page: '/blog/fixture', version: 'web-vitals-6', id: 'fixture-1' } };
  let res = response();
  await ingest(req, res);
  assert.deepEqual(res.body, { ok: true, stored: true, source: 'kv' });
  const commands = JSON.parse(calls[0].options.body);
  assert.deepEqual(commands.slice(1), [['LTRIM', 'cwv:samples:v2:CLS', '0', '999'], ['EXPIRE', 'cwv:samples:v2:CLS', '2592000']]);
  const sample = JSON.parse(commands[0][2]);
  assert.equal(sample.v, 0); assert.equal(sample.id, 'fixture-1');
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 503, text: async () => 'fixture outage' }));
  res = response(); await ingest(req, res);
  assert.equal(res.code, 503); assert.notEqual(res.body.stored, true);
  delete process.env.KV_REST_API_TOKEN;
  res = response(); await ingest(req, res);
  assert.equal(res.body.stored, false); assert.equal(res.body.reason, 'not_configured');
});

test('eligible search and A/B counters still persist; successful login preserves private auth and adds anonymous opt-out', async t => {
  const calls = setup(t);
  let res = response();
  await search({ method: 'POST', headers, body: { q: '乾眼' } }, res);
  assert.equal(res.code, 204); assert.equal(calls.length, 2);
  res = response();
  await abStats({ method: 'POST', headers, body: { testId: 'fixture', variantIndex: 0, event: 'exposure' } }, res);
  assert.equal(res.body.stored, true);
  const [operation] = JSON.parse(calls[2].options.body);
  assert.equal(calls.length, 3, 'counter, optional name and index use one checked script');
  assert.equal(operation[0], 'EVAL');
  assert.deepEqual(operation.slice(2, 8), ['2', 'ab:fixture', 'ab:_index', '0:exp', '', '']);
  res = response();
  await login({ method: 'POST', headers, body: { password: process.env.ADMIN_PASSWORD } }, res);
  assert.equal(res.code, 200);
  const cookies = res.headers['Set-Cookie'];
  assert.equal(cookies.length, 2);
  assert.match(cookies[0], /hs_admin_session=.+; HttpOnly; Secure; SameSite=Strict; Path=\/; Max-Age=28800/);
  assert.equal(cookies[1], 'hs_telemetry_optout=1; Secure; SameSite=Strict; Path=/; Max-Age=28800');
  const out = response(); await login({ method: 'DELETE', headers }, out);
  assert.match(out.headers['Set-Cookie'], /hs_admin_session=;.*Max-Age=0/);
  assert.doesNotMatch(out.headers['Set-Cookie'], /hs_telemetry_optout/);
});

test('A/B storage errors never report stored or retry a partially acknowledged count', async t => {
  setup(t);
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    requests++;
    const [operation] = JSON.parse(options.body);
    assert.equal(operation[0], 'EVAL');
    assert.deepEqual(operation.slice(2, 8), ['2', 'ab:failed', 'ab:_index', '1:exp', '1:name', 'fixture B']);
    return { ok: true, json: async () => [{ error: 'Invalid A/B storage type' }] };
  });
  const res = response();
  await abStats({ method: 'POST', headers, body: { testId: 'failed', variantIndex: 1, event: 'exposure', variantName: 'fixture B' } }, res);
  assert.equal(res.code, 503); assert.notEqual(res.body.stored, true);
  assert.equal(requests, 1);
  const reserved = response();
  await abStats({ method: 'POST', headers, body: { testId: '_index', variantIndex: 1, event: 'exposure' } }, reserved);
  assert.equal(reserved.code, 400); assert.equal(requests, 1);
});
