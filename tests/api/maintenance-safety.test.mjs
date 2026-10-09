import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import batch from '../../api/admin/_batch.js';
import { makeSessionToken } from '../../api/admin/_login.js';
import { autolinkOnce } from '../../api/admin/_dictionary.js';
import { upsertSubscription } from '../../api/push/_store.js';
import { catalogRecords } from '../../api/_articles.js';

function response() {
  return { code: 200, status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }, setHeader() {} };
}
const json = (body, status = 200) => ({ ok: status < 300, status,
  json: async () => body, text: async () => JSON.stringify(body) });

function environment(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const before = process.env[key];
    process.env[key] = value;
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }
}

function mockBatch(t, catalog) {
  environment(t, { ADMIN_PASSWORD: 'fixture', GITHUB_TOKEN: 'fixture' });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (rawUrl, options = {}) => {
    assert.ok(!options.method || options.method === 'GET', 'no GitHub writes expected');
    const path = decodeURIComponent(new URL(rawUrl).pathname.split('/contents/')[1]);
    calls.push(path);
    return path === 'blog/blog-shared.js'
      ? json({ content: Buffer.from(catalog).toString('base64'), sha: 'fixture' })
      : json({}, 404);
  });
  return { calls, async run(body) {
    const res = response();
    await batch({ method: 'POST', headers: { cookie: 'hs_admin_session=' + makeSessionToken('fixture') }, body }, res);
    return res;
  } };
}

test('batch rejects malformed targets and filters before reading or writing any article', async t => {
  const { run, calls } = mockBatch(t, "DN.ARTICLES=[{slug:'first',cat:'rx'}];");
  for (const invalid of [
    { slugs: 'first' }, { slugs: null }, { slugs: {} }, { slugs: ['../admin'] },
    { slugs: Array(51).fill('first') }, { filter: [] }, { filter: 'rx' },
    { filter: null }, { filter: {} }, { filter: { category: 'rx' } }, { filter: { cat: false } },
  ]) {
    assert.equal((await run({ ops: ['seo-fix'], ...invalid })).code, 400, JSON.stringify(invalid));
  }
  const empty = await run({ ops: ['seo-fix'], slugs: [] });
  assert.equal(empty.code, 200);
  assert.equal(empty.body.total, 0);
  assert.deepEqual(calls, []);
});

test('batch uses literal catalog records for filters and limits derived targets too', async t => {
  const { run, calls } = mockBatch(t, `DN.ARTICLES=[
    {title:'A } literal ]; boundary',cat:"rx",slug:"first"},
    {slug:'second',cat:'research'}
  ];`);
  const res = await run({ ops: ['seo-fix'], filter: { cat: 'rx' } });
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.results.map(r => r.slug), ['first']);
  assert.deepEqual(calls, ['blog/blog-shared.js', 'blog/first.html']);
});

test('batch fails closed for an invalid or oversized catalog', async t => {
  for (const [catalog, status] of [
    ["DN.ARTICLES=[{slug:'first',title:unsupported()}];", 500],
    ['DN.ARTICLES=[' + Array.from({ length: 51 }, (_, n) => `{slug:'article-${n}',cat:'rx'}`).join(',') + '];', 400],
  ]) {
    await t.test(String(status), async t => {
      const { run, calls } = mockBatch(t, catalog);
      assert.equal((await run({ ops: ['seo-fix'] })).code, status);
      assert.deepEqual(calls, ['blog/blog-shared.js']);
    });
  }
});

const entry = (anchor = '') => ({ en: 'retina', def: 'retina tissue "<test>"', anchor });
const page = body => '<!doctype html><html><head><title>retina</title></head><body>' + body + '</body></html>';

test('dictionary does not rematch inserted markup or overlapping long terms', () => {
  const dict = { retina: entry(), ret: entry() };
  const source = page('<p data-zh="retina ret" data-en="translated">retina and ret, retina</p>');
  const out = autolinkOnce(source, dict);
  assert.match(out, /data-term="retina"/);
  assert.match(out, /data-term="ret"/);
  assert.doesNotMatch(out, /data-term="<|title="<span/);
  assert.equal((out.match(/class="hs-dict"/g) || []).length, 2);
  assert.ok(out.includes('data-zh="retina ret" data-en="translated"'));
  assert.equal(autolinkOnce(out, dict), out);
});

test('dictionary recognizes existing tooltip links regardless of attribute order', () => {
  const dict = { retina: entry('topic') };
  const source = page('<p>retina retina</p>');
  const out = autolinkOnce(source, dict);
  assert.equal(autolinkOnce(out, dict), out);
  const already = page("<p><a data-term='retina' class='other hs-dict-link' href='/blog/topic'>retina</a> retina</p>");
  assert.equal(autolinkOnce(already, dict), already);
});

test('dictionary edits only prose text, preserves entities and protects HTML subtrees', () => {
  const before = '<H2>retina</H2><!-- retina > comment --><a title="a > b">retina</a>' +
    '<SCRIPT>retina</SCRIPT><pre><p>retina</p></pre><svg><text>retina</text></svg>' +
    '<template><p>retina</p></template><textarea>retina</textarea>';
  const source = page('<article>' + before + '<p title="retina > ret">&retina; &#123; retina</p></article>');
  const out = autolinkOnce(source, { retina: entry() });
  assert.ok(out.includes(before));
  assert.ok(out.includes('<p title="retina > ret">&retina; &#123; <span'));
  assert.equal(out.replace(/<span class="hs-dict"[^>]*>retina<\/span>/, 'retina'), source);
});

test('dictionary is idempotent and preserves authored bytes across the published corpus', async () => {
  const catalog = await readFile(new URL('../../blog/blog-shared.js', import.meta.url), 'utf8');
  const dict = { '\u8996\u7db2\u819c': entry(), '\u8996\u7db2\u819c\u525d\u96e2': entry('floaters-retinal-detachment'),
    '\u9ec3\u6591\u90e8': entry(), '\u9ec3\u6591\u90e8\u75c5\u8b8a': entry() };
  let changed = 0;
  for (const { values: { slug } } of catalogRecords(catalog)) {
    const source = await readFile(new URL(`../../blog/${slug}.html`, import.meta.url), 'utf8');
    const out = autolinkOnce(source, dict);
    assert.equal(autolinkOnce(out, dict), out, slug);
    const unwrap = text => text.replace(/<(span|a) (?:href="[^"]*" )?class="hs-dict(?:-link)?"[^>]*>([^<]*)<\/\1>/g, '$2');
    assert.equal(unwrap(out), unwrap(source), slug);
    if (out !== source) changed++;
  }
  assert.ok(changed > 0, 'must exercise real article text');
});

test('push admission uses one atomic command for simultaneous subscriptions at the limit', async t => {
  environment(t, { KV_REST_API_URL: 'https://fixture.invalid', KV_REST_API_TOKEN: 'fixture' });
  const stored = new Map([['existing', { endpoint: 'existing' }]]);
  const commands = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (String(url).includes('/get/')) return json({ result: '1' });
    assert.equal(url, 'https://fixture.invalid/pipeline');
    const [command] = JSON.parse(options.body);
    commands.push(command);
    assert.equal(command[0], 'EVAL');
    assert.deepEqual(command.slice(2, 4), ['1', 'push:subscribers:v2']);
    assert.match(command[1], /HEXISTS/);
    assert.match(command[1], /HLEN/);
    assert.match(command[1], /HSET/);
    const [, , , , endpoint, payload, limit] = command;
    const exists = stored.has(endpoint);
    if (!exists && stored.size >= Number(limit)) return json([{ result: [-1, stored.size] }]);
    stored.set(endpoint, JSON.parse(payload));
    return json([{ result: [exists ? 0 : 1, stored.size] }]);
  });
  const results = await Promise.all(['one', 'two'].map(endpoint => upsertSubscription({ endpoint }, 2)));
  assert.equal(results.filter(r => r.inserted).length, 1);
  assert.equal(results.filter(r => r.full).length, 1);
  assert.equal(stored.size, 2);
  const refresh = await upsertSubscription({ endpoint: 'existing', ts: 'refreshed' }, 2);
  assert.deepEqual(refresh, { inserted: false, count: 2 });
  assert.equal(stored.get('existing').ts, 'refreshed');
  assert.equal(commands.length, 3);
});

test('push storage refuses missing, failed or malformed atomic results', async t => {
  environment(t, { KV_REST_API_URL: 'https://fixture.invalid', KV_REST_API_TOKEN: 'fixture' });
  let reply;
  t.mock.method(globalThis, 'fetch', async url => String(url).includes('/get/')
    ? json({ result: '1' }) : json(reply));
  for (reply of [[], [{ error: 'WRONGTYPE' }], [{ result: null }], [{ result: [2, 1] }], [{ result: [1, -1] }], [{ result: [1, '2'] }]]) {
    await assert.rejects(upsertSubscription({ endpoint: 'one' }, 2), /storage|subscription/i);
  }
});
