import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { catalogRecords, patchCatalogFields } from '../../api/_articles.js';
import save, { articleBlobSha } from '../../api/admin/_save.js';
import md from '../../api/admin/_md.js';
import precompute from '../../api/admin/_precompute-meta.js';
import { makeSessionToken } from '../../api/admin/_login.js';
import { kvMigrateJSONHash } from '../../api/_kv.js';

const catalog = String.raw`DN.ARTICLES = [
  { slug:'first', title:'Before } after', title_en:'Sjögren\'s', date:'2026-08-01', words:1, minutes:2 },
  { slug:'second', title:'Second', title_en:'literal words:99, minutes:10', date:'2026-08-01', },
];`;
const article = '<html><head><title>fixture</title></head><body><article class="max-w-3xl"><div id="proseZh"><p>Current article '+ 'word '.repeat(40) + '</p></div></article></body></html>';
const respond = () => ({ code: 200, status(n) { this.code = n; return this; }, json(body) { this.body = body; return this; }, setHeader() {} });
const json = (data, status = 200) => ({ok: status < 300, status, json: async () => data, text: async () => JSON.stringify(data)});

test('catalog updates target fields, preserve quoted braces and escapes, and are idempotent', () => {
  const original = catalogRecords(catalog);
  assert.equal(original[0].values.title_en, "Sjögren's");
  const updates = { first: { words: 40, minutes: 3 }, second: { words: 70, minutes: 4 } };
  const patched = patchCatalogFields(catalog, updates);
  assert.equal(patchCatalogFields(patched, updates), patched);
  assert.equal(catalogRecords(patched)[0].values.title, 'Before } after');
  assert.equal(catalogRecords(patched)[1].values.title_en, 'literal words:99, minutes:10');
  assert.equal(catalogRecords(patched)[1].values.words, 70);
  assert.throws(() => patchCatalogFields(catalog, { absent: { words: 3 } }), /not found/);
  assert.throws(() => catalogRecords("DN.ARTICLES=[{slug:'a',title:danger()}];"), /literal/);
});

test('current repository catalog parses without eval', async () => {
  const source = await readFile(new URL('../../blog/blog-shared.js', import.meta.url), 'utf8');
  assert.ok(catalogRecords(source).length >= 20);
});

test('actual CMS handlers protect revisions and bilingual data and allow repeat metadata runs', async () => {
  const originalFetch = globalThis.fetch;
  const originalPassword = process.env.ADMIN_PASSWORD, originalToken = process.env.GITHUB_TOKEN;
  process.env.ADMIN_PASSWORD = 'fixture-password'; process.env.GITHUB_TOKEN = 'fixture-token';
  const headers = { cookie: 'hs_admin_session=' + makeSessionToken(process.env.ADMIN_PASSWORD) };
  let currentArticle = article, currentCatalog = catalog, writes = [];
  globalThis.fetch = async (url, options = {}) => {
    url = String(url);
    if (options.method === 'PUT') {
      currentCatalog = Buffer.from(JSON.parse(options.body).content, 'base64').toString();
      writes.push(currentCatalog); return json({commit: {sha: 'commit'}});
    }
    if (url.includes('/contents/')) {
      const value = url.includes('blog-shared.js') ? currentCatalog : currentArticle;
      return json({content: Buffer.from(value).toString('base64'), sha: articleBlobSha(value)});
    }
    if (url.includes('/git/ref/')) return json({object: {sha: 'head'}});
    if (url.endsWith('/git/commits/head')) return json({tree: {sha: 'tree'}});
    if (url.endsWith('/git/blobs')) { writes.push(JSON.parse(options.body).content); return json({sha: 'blob'}); }
    if (url.endsWith('/git/trees')) return json({sha: 'new-tree'});
    if (url.endsWith('/git/commits')) return json({sha: 'new-commit'});
    if (url.includes('/git/refs/')) return json({object: {sha: 'new-commit'}});
    throw Error('Unexpected mock request '+url);
  };
  try {
    let res=respond(); await save({method:'GET',headers,query:{slug:'first'}},res);
    const base=res.body.sha; assert.equal(res.body.html,article);
    currentArticle=article.replace('Current article','Newer remote edit');
    res=respond(); await save({method:'POST',headers,body:{slug:'first',html:article,baseSha:base}},res);
    assert.equal(res.code,409); assert.equal(writes.length,0);
    res=respond(); await save({method:'POST',headers,body:{slug:'first',html:article}},res);
    assert.equal(res.code,409); assert.equal(writes.length,0);
    res=respond(); await save({method:'POST',headers,body:{slug:'first',html:article,baseSha:articleBlobSha(currentArticle)}},res);
    assert.equal(res.code,200);assert.equal(res.body.sha,articleBlobSha(article));assert.equal(writes[0],article);
    writes=[];
    currentArticle=article.replace('<p>', '<p data-zh="中文" data-en="English translation">');
    res=respond(); await md({method:'GET',headers,query:{slug:'first'}},res);
    assert.equal(res.body.editable,false);
    const mdResult=res.body;
    res=respond(); await md({method:'POST',headers,body:{slug:'first',markdown:mdResult.markdown,baseSha:mdResult.sha}},res);
    assert.equal(res.code,409);assert.equal(writes.length,0);
    currentArticle=article;
    res=respond();await md({method:'POST',headers,body:{slug:'first',markdown:'A safe ordinary paragraph',baseSha:'a'.repeat(40)}},res);
    assert.equal(res.code,409);
    res=respond();await md({method:'POST',headers,body:{slug:'first',markdown:'A safe ordinary paragraph',baseSha:articleBlobSha(article)}},res);
    assert.equal(res.code,200);
    res=respond();await precompute({method:'POST',headers,body:{}},res);assert.equal(res.code,200);
    const firstRun=currentCatalog;
    res=respond();await precompute({method:'POST',headers,body:{}},res);assert.equal(res.code,200);assert.equal(res.body.noop,true);
    assert.equal(currentCatalog,firstRun);assert.equal(catalogRecords(firstRun)[0].values.title,'Before } after');
  } finally {
    globalThis.fetch=originalFetch;
    if(originalPassword===undefined)delete process.env.ADMIN_PASSWORD;else process.env.ADMIN_PASSWORD=originalPassword;
    if(originalToken===undefined)delete process.env.GITHUB_TOKEN;else process.env.GITHUB_TOKEN=originalToken;
  }
});

test('migration fails closed on KV errors and retries the entire atomic operation', async () => {
  const originalFetch=globalThis.fetch;
  const url=process.env.KV_REST_API_URL, token=process.env.KV_REST_API_TOKEN;
  process.env.KV_REST_API_URL='https://fixture.invalid';process.env.KV_REST_API_TOKEN='fixture';
  let calls=0;
  globalThis.fetch=async (_,options) => {
    const [command]=JSON.parse(options.body); calls++;
    assert.equal(command[0],'EVAL');assert.deepEqual(command.slice(2),['3','legacy','hash','marker']);
    assert.match(command[1],/HSETNX/);assert.ok(command[1].indexOf('HSETNX')<command[1].indexOf("redis.call('SET'"));
    return calls===1?json({error:'transient'},503):json([{result:1}]);
  };
  try { await assert.rejects(kvMigrateJSONHash('legacy','hash','marker'),/migration failed/); await kvMigrateJSONHash('legacy','hash','marker'); assert.equal(calls,2); }
  finally {globalThis.fetch=originalFetch;if(url===undefined)delete process.env.KV_REST_API_URL;else process.env.KV_REST_API_URL=url;if(token===undefined)delete process.env.KV_REST_API_TOKEN;else process.env.KV_REST_API_TOKEN=token;}
});


test('background replay retains conflicting snapshots with their original version', async () => {
  const { runInNewContext } = await import('node:vm');
  const source = await readFile(new URL('../../sw.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function drainSavesOnce()');
  const end = source.indexOf('function drainSaves()', start);
  const deleted = [], messages = [], requests = [];
  const sha = 'a'.repeat(40);
  const context = {
    readQueuedSaves: async () => [
      {id: 1, slug: 'example', html: '<html>draft</html>', baseSha: sha, token: 'capability'},
      {id: 2, slug: 'other', html: '<html>valid</html>', baseSha: sha, token: 'capability'},
    ],
    deleteQueuedSave: async id => deleted.push(id),
    fetch: async (_, opts) => { const body = JSON.parse(opts.body); requests.push(body); return {ok:body.slug === 'other',status:body.slug === 'other' ? 200 : 409}; },
    self: {clients:{matchAll:async () => [{postMessage:m => messages.push(m)}]}},
  };
  await runInNewContext(source.slice(start, end) + '\ndrainSavesOnce()', context);
  assert.equal(requests[0].baseSha, sha);
  assert.equal(requests.length, 2);
  assert.deepEqual(deleted, [2]);
  assert.equal(messages[0].type, 'BG_SYNC_CONFLICT');
});


test('both edit handlers return 409 for late SHA/ref races and keep transient errors distinct', async () => {
  const oldFetch = globalThis.fetch;
  const oldPassword = process.env.ADMIN_PASSWORD, oldToken = process.env.GITHUB_TOKEN;
  process.env.ADMIN_PASSWORD = 'fixture'; process.env.GITHUB_TOKEN = 'fixture';
  const headers = {cookie:'hs_admin_session=' + makeSessionToken('fixture')};
  try {
    for (const handler of [save, md]) {
      for (const race of ['check', 'ref', 'transient']) {
        let current = article, patches = 0, successfulWrites = 0;
        globalThis.fetch = async (rawUrl, opts = {}) => {
          const url = new URL(String(rawUrl));
          if (url.pathname.includes('/contents/')) {
            const isCatalog = url.pathname.includes('blog-shared.js');
            if (!isCatalog && race === 'check' && url.searchParams.get('ref') === 'head') current = article.replace('Current article','Concurrent edit');
            const text = isCatalog ? catalog : current;
            return json({content:Buffer.from(text).toString('base64'),sha:articleBlobSha(text)});
          }
          if (url.pathname.includes('/git/ref/')) return json({object:{sha:'head'}});
          if (url.pathname.endsWith('/git/commits/head')) return json({tree:{sha:'tree'}});
          if (url.pathname.endsWith('/git/blobs')) return json({sha:'blob'});
          if (url.pathname.endsWith('/git/trees')) return json({sha:'new-tree'});
          if (url.pathname.endsWith('/git/commits')) return json({sha:'new-commit'});
          if (opts.method === 'PATCH') {
            patches++;
            if (race === 'ref') current = article.replace('Current article','Concurrent edit');
            return json({error:race},race === 'transient' ? 503 : 422);
          }
          successfulWrites++;
          throw Error('Unexpected request ' + rawUrl);
        };
        const res = respond();
        await handler({method:'POST',headers,body:{slug:'first',html:article.replace('Current article','User edit'),markdown:'User edited paragraph with enough text',baseSha:articleBlobSha(article)}},res);
        assert.equal(res.code,race === 'transient' ? 500 : 409, `${handler === save ? 'save' : 'md'}:${race}`);
        assert.equal(patches,race === 'check' ? 0 : 1);
        assert.equal(successfulWrites,0);
      }
    }
  } finally {
    globalThis.fetch=oldFetch;
    if(oldPassword === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD=oldPassword;
    if(oldToken === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN=oldToken;
  }
});
