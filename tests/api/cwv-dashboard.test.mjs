import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import handler from '../../api/admin/_cwv.js';
import { makeSessionToken } from '../../api/admin/_login.js';
import { summarizeCwvSamples } from '../../api/_cwv_samples.js';
import dashboard from '../../assets/admin-cwv.js';

const NAMES = ['LCP', 'CLS', 'INP', 'FCP', 'TTFB'];
const ENV = ['ADMIN_PASSWORD', 'KV_REST_API_URL', 'KV_REST_API_TOKEN',
  'GA4_PROPERTY_ID', 'GA4_SERVICE_ACCOUNT_JSON'];
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const sa = JSON.stringify({ client_email: 'fixture@example.test',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });

function fixture(t, { kv = {}, ga4, legacy = {}, kvFailure = false, invalidGa4 = false,
  kvStall, oauthStall = false } = {}) {
  const original = Object.fromEntries(ENV.map(key => [key, process.env[key]]));
  ENV.forEach(key => delete process.env[key]);
  process.env.ADMIN_PASSWORD = 'cwv-test-password';
  if (kv !== null) {
    process.env.KV_REST_API_URL = 'https://kv.example.test';
    process.env.KV_REST_API_TOKEN = 'fixture';
  }
  if (ga4 || invalidGa4) {
    process.env.GA4_PROPERTY_ID = 'properties/123';
    process.env.GA4_SERVICE_ACCOUNT_JSON = invalidGa4 ? '{}' : sa;
  }
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    if (url === 'https://kv.example.test/pipeline') {
      if (kvFailure) return { ok: false, status: 503, text: async () => 'fixture outage' };
      const [command, key] = JSON.parse(options.body)[0];
      const name = key.split(':').pop();
      if (name === kvStall) return stallUntilAborted(options.signal);
      return { ok: true, json: async () => [{ result: command === 'LRANGE'
        ? (kv[name] || []) : (legacy[name] == null ? null : JSON.stringify(legacy[name])) }] };
    }
    if (url === 'https://oauth2.googleapis.com/token') {
      if (oauthStall) return stallUntilAborted(options.signal);
      return { ok: true, json: async () => ({ access_token: 'fixture-token' }) };
    }
    if (url.startsWith('https://analyticsdata.googleapis.com/')) {
      const body = JSON.parse(options.body);
      return ga4(body.dimensionFilter.filter.stringFilter.value, body, options.signal);
    }
    throw new Error('Unexpected external request in test');
  });
  t.after(() => ENV.forEach(key => {
    if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
  }));
  async function run(range = '28d', authenticated = true) {
    const req = { method: 'GET', query: { range }, headers: {
      cookie: authenticated ? 'hs_admin_session=' + makeSessionToken(process.env.ADMIN_PASSWORD) : '',
    } };
    const res = { code: 0, headers: {}, body: null,
      setHeader(key, value) { this.headers[key] = value; },
      status(value) { this.code = value; return this; },
      json(value) { this.body = value; return this; },
    };
    await handler(req, res);
    return res;
  }
  return { run, requests };
}

const raw = (v, id, t = Date.now()) => ({ v, t, id, version: 'web-vitals-6' });
function stallUntilAborted(signal) {
  assert.ok(signal instanceof AbortSignal, 'provider request must be abortable');
  return new Promise((resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}
const report = (count, sum) => ({ ok: true, json: async () => ({ rows: [
  { metricValues: [{ value: String(count) }, { value: String(sum) }] },
] }) });

test('equal averages can have different raw p75; use nearest rank and retain zero', () => {
  const a = summarizeCwvSamples('LCP', [1, 1, 1, 9].map((v, i) => raw(v, 'a' + i)), 0);
  const b = summarizeCwvSamples('LCP', [0, 2, 4, 6].map((v, i) => raw(v, 'b' + i)), 0);
  assert.equal(a.avg, b.avg);
  assert.equal(a.p75, 1);
  assert.equal(b.p75, 4);
  const zero = summarizeCwvSamples('CLS', [raw(0, 'zero')], 0);
  assert.equal(zero.samples, 1);
  assert.equal(zero.p75, 0);
  assert.equal(summarizeCwvSamples('CLS', [], 0), null);
});

test('partial KV remains usable without GA4, with final-ID dedup and CLS normalization', async t => {
  const f = fixture(t, { kv: {
    CLS: [raw(100, 'page-a'), raw(25, 'page-a', Date.now() - 1), raw(200, 'page-b'),
      { v: 900, t: Date.now() }, { v: 1, t: 'invalid' }],
  } });
  const res = await f.run();
  assert.equal(res.code, 200);
  const cls = res.body.metrics.find(m => m.name === 'CLS');
  assert.equal(cls.samples, 2);
  assert.equal(cls.avg, 0.15);
  assert.equal(cls.p75, 0.2);
  assert.equal(cls.method, 'web-vitals-6');
  assert.equal(res.body.metrics[0].p75, null);
  assert.equal(res.body.metrics[0].samples, 0);
  assert.equal(res.body.collection.ga4.status, 'not_configured');
  assert.match(res.headers['Cache-Control'], /no-store/);
});

test('missing configuration and failed reads are unavailable, never fabricated zero', async t => {
  const f = fixture(t, { kv: null });
  const res = await f.run();
  assert.equal(res.code, 200);
  assert.ok(res.body.metrics.every(m => m.samples === null && m.p75 === null && m.avg === null));
  assert.equal(res.body.collection.kv.configured, false);
  assert.equal((await f.run('7d', false)).code, 401);
  assert.equal(f.requests.length, 0);
});

test('KV outage is visible even when no GA4 fallback is configured', async t => {
  const f = fixture(t, { kvFailure: true });
  const res = await f.run();
  assert.ok(res.body.metrics.every(m => m.status === 'unavailable' && m.samples === null));
  assert.equal(res.body.issues.length, NAMES.length);
});

test('corrupt KV reservoirs are unavailable while expired valid samples are confirmed empty', async t => {
  const f = fixture(t, { kv: {
    LCP: ['{invalid-json'],
    CLS: [{ v: 'invalid', t: Date.now() }],
    INP: [raw(200, 'expired', Date.now() - 40 * 86400_000)],
  }, legacy: { FCP: [{ value: 123 }] } });
  const res = await f.run();
  for (const name of ['LCP', 'CLS', 'FCP']) {
    const metric = res.body.metrics.find(m => m.name === name);
    assert.equal(metric.status, 'unavailable');
    assert.equal(metric.samples, null);
    assert.ok(res.body.issues.some(i => i.source === 'kv' && i.metric === name));
  }
  const expired = res.body.metrics.find(m => m.name === 'INP');
  assert.equal(expired.status, 'no_samples');
  assert.equal(expired.samples, 0);
});

test('stalled KV, OAuth or a single GA4 report cannot discard other measured results', async t => {
  // Accelerate actual AbortSignals, rather than resolving the mocked stalled
  // requests. A keepalive timer allows Node's unref'ed abort timers to fire.
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, 'timeout', ms => {
    assert.equal(ms, 5000);
    return timeout(25);
  });
  const keepalive = setInterval(() => {}, 100);
  try {
    for (const provider of ['kv', 'oauth', 'ga4']) {
      await t.test(provider, async child => {
        const f = fixture(child, { kv: { LCP: [raw(2000, 'a')] },
          kvStall: provider === 'kv' ? 'INP' : null,
          oauthStall: provider === 'oauth',
          ga4: provider === 'kv' ? null : (name, body, signal) =>
            provider === 'ga4' && name === 'INP' ? stallUntilAborted(signal) : report(2, 100),
        });
        const res = await f.run();
        assert.equal(res.code, 200);
        assert.equal(res.body.metrics[0].p75, 2000);
        assert.ok(res.body.issues.some(i => i.source === provider ||
          (provider === 'oauth' && i.source === 'ga4')));
        if (provider === 'ga4') {
          assert.equal(res.body.metrics[1].status, 'mean_only');
          assert.equal(res.body.collection.ga4.status, 'partial');
        }
      });
    }
  } finally { clearInterval(keepalive); }
});

test('GA4 exposes event mean only and counts the selected calendar days inclusively', async t => {
  const f = fixture(t, { kv: null, ga4: (name, body) => {
    assert.deepEqual(body.dateRanges, [{ startDate: '6daysAgo', endDate: 'today' }]);
    return report(4, name === 'CLS' ? 400 : 12);
  } });
  const res = await f.run('7d');
  assert.ok(res.body.metrics.every(m => m.p75 === null && m.status === 'mean_only'));
  assert.equal(res.body.metrics[0].avg, 3);
  assert.equal(res.body.metrics[1].avg, 0.1);
  assert.equal(res.body.metrics[0].samples, 4);
  assert.equal(res.body.collection.ga4.window, 'calendar-days-including-today');
});

test('GA4 no events differs from no provider, and malformed aggregates do not become zero', async t => {
  const f = fixture(t, { kv: null, ga4: name => name === 'INP'
    ? { ok: true, json: async () => ({ rows: [{ metricValues: [{ value: null }, { value: null }] }] }) }
    : { ok: true, json: async () => ({ rowCount: 0 }) } });
  const res = await f.run();
  assert.equal(res.body.metrics[0].samples, 0);
  assert.equal(res.body.metrics[0].p75, null);
  const inp = res.body.metrics.find(m => m.name === 'INP');
  assert.equal(inp.samples, null);
  assert.equal(inp.status, 'unavailable');
  assert.equal(res.body.collection.ga4.status, 'partial');
});

test('one failed GA4 metric preserves successful GA4 and measured KV results', async t => {
  const f = fixture(t, { kv: { LCP: [raw(2500, 'a')] }, ga4: name => name === 'INP'
    ? { ok: false, status: 503 } : report(2, 800) });
  const res = await f.run();
  assert.equal(res.body.metrics[0].p75, 2500);
  assert.equal(res.body.metrics[1].status, 'mean_only');
  assert.equal(res.body.collection.ga4.status, 'partial');
  assert.ok(res.body.issues.some(i => i.metric === 'INP'));
});

test('invalid GA4 setup preserves raw KV rather than failing the entire dashboard', async t => {
  const f = fixture(t, { kv: { LCP: [raw(1500, 'a')] }, invalidGa4: true });
  const res = await f.run();
  assert.equal(res.code, 200);
  assert.equal(res.body.metrics[0].p75, 1500);
  assert.equal(res.body.collection.ga4.status, 'invalid_config');
});

test('KV explicitly bounds a 90-day selection to a rolling 30-day sample, including legacy data', async t => {
  const f = fixture(t, { kv: { LCP: [raw(100, 'new'), raw(9999, 'old', Date.now() - 40 * 86400_000)] },
    legacy: { CLS: [{ v: 50, t: Date.now() - 1 }, { v: 100, t: Date.now() }] } });
  const res = await f.run('90d');
  assert.equal(res.body.days, 90);
  assert.equal(res.body.metrics[0].windowDays, 30);
  assert.equal(res.body.metrics[0].samples, 1);
  assert.equal(res.body.metrics[0].p75, 100);
  assert.equal(res.body.metrics[1].method, 'legacy');
  assert.equal(res.body.metrics[1].p75, 0.1);
});

test('dashboard keeps missing p75 neutral, shows measured zero, and escapes public-derived values', () => {
  const html = dashboard.render({ metrics: [
    { name: 'LCP', source: 'ga4', status: 'mean_only', samples: 4, avg: 0, p75: null, windowDays: 7 },
    { name: 'CLS', source: 'kv', status: 'measured', samples: 1, avg: 0, p75: 0, windowDays: 7 },
    { name: 'INP', source: null, status: 'unavailable', samples: null, avg: null, p75: null },
    { name: '<img src=x onerror=alert(1)>', source: 'kv', status: 'no_samples', samples: 0, p75: null },
  ], collection: { ga4: { status: 'partial' } } });
  assert.match(html, /僅平均值，無法判定 p75/);
  assert.match(html, /0\.000/);
  assert.match(html, /樣本 p75 良好/);
  assert.match(html, /尚無可用數據/);
  assert.doesNotMatch(html, /<img src/);
  assert.match(html, /&lt;img/);
  assert.match(html, /無可用樣本/);
});

test('a slow older range cannot replace a newer dashboard result or show a stale error', async () => {
  const html = await readFile(new URL('../../admin.html', import.meta.url), 'utf8');
  const start = html.indexOf('let cwvLoadId = 0;');
  const end = html.indexOf('// ───────────────── CSP violation report viewer', start);
  assert.ok(start > 0 && end > start);
  const range = { value: '28d' }, host = { innerHTML: '' };
  const pending = [];
  const context = vm.createContext({ API: '/api/admin', window: { HsiaoCwvDashboard: dashboard },
    escapeHTML: value => String(value),
    document: { getElementById: id => id === 'cwv-range' ? range : host },
    fetch: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
  });
  vm.runInContext(html.slice(start, end), context);
  const data = days => ({ metrics: [{ name: 'CLS', source: 'kv', status: 'measured',
    samples: 1, avg: 0, p75: 0, windowDays: days }] });
  for (const rejectOlder of [false, true]) {
    range.value = '28d';
    const older = context.loadCWV();
    const first = pending.shift();
    range.value = '7d';
    const newer = context.loadCWV();
    pending.shift().resolve({ ok: true, json: async () => data(7) });
    await newer;
    if (rejectOlder) first.reject(new Error('old request failed'));
    else first.resolve({ ok: true, json: async () => data(28) });
    await older;
    assert.match(host.innerHTML, /滾動 7 天/);
    assert.doesNotMatch(host.innerHTML, /滾動 28 天|網路錯誤/);
  }
});
