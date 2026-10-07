import assert from 'node:assert/strict';
import test from 'node:test';
import policy from '../../assets/telemetry.js';
import { telemetryExclusion } from '../../api/_telemetry.js';
import ingest from '../../api/cwv-ingest.js';
import search from '../../api/search-log.js';
import abStats from '../../api/admin/_ab-stats.js';
import login, { makeSessionToken } from '../../api/admin/_login.js';
import cwvDashboard from '../../api/admin/_cwv.js';

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

test('CWV stores only versioned coarse context and discards arbitrary identifying payload fields', async t => {
  const calls = setup(t);
  for (const context of [
    { contextVersion: 1, viewportBand: 'narrow', assetEpoch: '20260711' },
    { contextVersion: 1, viewportBand: '<img>', assetEpoch: '20260711?secret' },
    { contextVersion: '1', viewportBand: 'wide', assetEpoch: '20260711' },
    { viewportBand: 'wide', assetEpoch: '20260711' },
  ]) {
    const res = response();
    await ingest({ method: 'POST', headers, body: { name: 'CLS', value: 0,
      page: '/blog/fixture', version: 'web-vitals-6', id: 'fixture-context', ...context,
      width: 390, userAgent: 'private', query: 'private', body: 'private', visitorId: 'private' } }, res);
    assert.equal(res.body.stored, true);
    const sample = JSON.parse(JSON.parse(calls.at(-1).options.body)[0][2]);
    assert.deepEqual(Object.keys(sample).sort(), (context.contextVersion === 1
      ? ['v', 'p', 't', 'version', 'id', 'contextVersion', 'viewportBand', 'assetEpoch']
      : ['v', 'p', 't', 'version', 'id']).sort());
    if (context.contextVersion === 1) {
      assert.equal(sample.viewportBand, context.viewportBand === 'narrow' ? 'narrow' : 'unknown');
      assert.equal(sample.assetEpoch, context.assetEpoch === '20260711' ? '20260711' : 'unknown');
    }
  }
  const before = calls.length;
  const excluded = response();
  await ingest({ method: 'POST', headers: { ...headers, cookie: 'hs_telemetry_optout=1' },
    body: { name: 'LCP', value: 100, contextVersion: 1, viewportBand: 'narrow', assetEpoch: '20260711' } }, excluded);
  assert.equal(excluded.body.stored, false);
  assert.equal(calls.length, before);
});

test('synthetic first-party receipt survives authenticated readback with latest-ID context and unknown history', async t => {
  setup(t);
  const gaKeys = ['GA4_PROPERTY_ID', 'GA4_SERVICE_ACCOUNT_JSON'];
  const previous = Object.fromEntries(gaKeys.map(key => [key, process.env[key]]));
  gaKeys.forEach(key => delete process.env[key]);
  t.after(() => gaKeys.forEach(key => {
    if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  }));
  const samples = [{ v: 0, t: Date.now(), version: 'web-vitals-6', id: 'historical' }];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://kv.example.test/pipeline', 'fixture never sends to production KV or GA4');
    const commands = JSON.parse(options.body);
    return { ok: true, json: async () => commands.map(([command, key, value]) => {
      if (command === 'LPUSH') { samples.unshift(JSON.parse(value)); return { result: samples.length }; }
      if (command === 'LRANGE') return { result: key.endsWith(':CLS') ? samples.map(JSON.stringify) : [] };
      return { result: command === 'GET' ? null : 1 };
    }) };
  });
  for (const [band, value] of [['wide', 900], ['narrow', 100]]) {
    const res = response();
    await ingest({ method: 'POST', headers, body: { name: 'CLS', value, page: '/blog/fixture',
      version: 'web-vitals-6', id: 'revised', contextVersion: 1, viewportBand: band, assetEpoch: '20260711' } }, res);
    assert.equal(res.body.stored, true);
  }
  const res = response();
  await cwvDashboard({ method: 'GET', query: { range: '7d' }, headers: {
    cookie: 'hs_admin_session=' + makeSessionToken(process.env.ADMIN_PASSWORD) } }, res);
  assert.equal(res.code, 200);
  const cls = res.body.metrics.find(m => m.name === 'CLS');
  assert.equal(cls.samples, 2);
  assert.equal(cls.p75, 0.1);
  assert.equal(cls.cohorts.totalSamples, 2);
  assert.equal(cls.cohorts.groups.some(g => g.viewportBand === 'wide'), false);
  assert.equal(cls.cohorts.groups.find(g => g.viewportBand === 'unknown').p75, 0);
});

test('reporter keeps the existing fallback and GA4 contract, then excludes a later privacy opt-out', () => {
  const sent = [], ga = [];
  const win = { location: { ...context, origin: 'https://' + policy.HOST,
      href: 'https://' + policy.HOST + context.pathname }, innerWidth: 768,
    document: { cookie: '', body: { classList: { contains: () => false } } },
    navigator: { userAgent: HUMAN }, Blob,
    fetch: (url, options) => { sent.push({ url, options }); return Promise.resolve({}); },
    gtag: (...args) => ga.push(args) };
  const reporter = policy.createVitalsReporter(win, { src: 'https://' + policy.HOST + '/blog/blog-shared.min.js?v=20260711' });
  assert.equal(reporter.capture().viewportBand, 'medium');
  win.innerWidth = 390;
  reporter.send('CLS', 0.125, 'fallback');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, '/api/cwv-ingest');
  assert.equal(sent[0].options.keepalive, true);
  assert.deepEqual(JSON.parse(sent[0].options.body), { name: 'CLS', value: 125, page: context.pathname,
    version: 'web-vitals-6', id: 'fallback', contextVersion: 1, viewportBand: 'medium', assetEpoch: '20260711' });
  assert.deepEqual(ga, [['event', 'CLS', { event_category: 'Web Vitals', event_label: 'fallback', value: 125, non_interaction: true }]]);
  win.document.cookie = 'hs_telemetry_optout=1';
  reporter.send('LCP', 100, 'excluded');
  assert.equal(sent.length, 1); assert.equal(ga.length, 1);
  for (const src of ['https://elsewhere.test/blog/blog-shared.min.js?v=20260711',
    'https://' + policy.HOST + '/other.js?v=20260711', '', undefined]) {
    win.innerWidth = NaN;
    assert.deepEqual(policy.createVitalsReporter(win, { src }).capture(),
      { contextVersion: 1, assetEpoch: 'unknown', viewportBand: 'unknown' });
  }
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
