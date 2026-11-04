// /api/admin/exam-draft against an isolated in-memory GitHub: never contacts KV,
// GitHub or production. Runs the real api/admin/_exam-draft.js and
// _exam-content.js over the real data/exam files. The fake follows GitHub's
// documented shapes for the object media type (a directory is an object with
// `entries`; files above 1 MB come back with encoding "none" and no content).
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import crypto from 'node:crypto';
import handler, { BRANCH, MANIFEST, MAX_BODY, notePath, manifestText } from '../../api/admin/_exam-draft.js';
import * as content from '../../api/admin/_exam-content.js';
import { makeSessionToken } from '../../api/admin/_login.js';

const OWNER = 'expertise88864', REPO = 'user-hsiao', TOKEN = 'server-only-token';
const HOST = 'hsiao.chendermatologist.com', ORIGIN = 'https://' + HOST;
const EXPL = 'data/exam/explanations.json';
const lf = text => text.replace(/\r\n/g, '\n');
const read = path => lf(fs.readFileSync(path, 'utf8'));
const sha1 = value => crypto.createHash('sha1').update(value).digest('hex');
const blobSha = bytes => sha1(Buffer.concat([Buffer.from('blob ' + bytes.length + '\0'), bytes]));
const sha = text => blobSha(Buffer.from(text));
const plain = value => JSON.parse(JSON.stringify(value));

const NOTES = Object.fromEntries(fs.readdirSync('data/exam/notes').filter(name => /^bcsc\d+-\d+\.htm$/.test(name))
  .map(name => [name.slice(4, -4), read('data/exam/notes/' + name)]));
const DATA_FILES = ['chapters.json', 'chapter_zh.json', 'tags.json', 'toc_en.json', 'simplified_chars.txt', 'questions.json']
  .map(name => 'data/exam/' + name);
const EXPL_TEXT = read(EXPL), EXPL_DATA = JSON.parse(EXPL_TEXT);
const TAGS = JSON.parse(read('data/exam/tags.json')), TOC = JSON.parse(read('data/exam/toc_en.json'));
const CHAPTERS = JSON.parse(read('data/exam/chapters.json'));
const SIMPLIFIED = content.simplifiedSet(read('data/exam/simplified_chars.txt'));
const BOOKS = new Set(CHAPTERS.map(book => book.book));
const NOTE = '1-4', OTHER = '12-4', ID_A = '2', ID_B = '3', ID_C = '4';
const onPage = key => new Set(Object.entries(TAGS).filter(([, t]) => t.ch.includes(key)).map(([n]) => Number(n)));
const SIMPLIFIED_CHAR = [...SIMPLIFIED][0];

function fixture() {
  const calls = [], blobs = new Map(), trees = new Map(), commits = new Map(), refs = new Map();
  const store = value => { const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value); const id = blobSha(bytes); blobs.set(id, bytes); return id; };
  const files = new Map([[EXPL, store(EXPL_TEXT)], ['README.md', store('readme')]]);
  for (const path of DATA_FILES) files.set(path, store(read(path)));
  for (const [key, text] of Object.entries(NOTES)) files.set(notePath(key), store(text));
  const mainTree = sha1('main-tree'), main = sha1('main');
  trees.set(mainTree, files); commits.set(main, { tree: { sha: mainTree }, parents: [], message: 'main' }); refs.set('main', main);
  const h = { calls, blobs, trees, commits, refs, main, cookie: 'hs_admin_session=' + encodeURIComponent(makeSessionToken('fixture')) };
  const treeOf = commitSha => trees.get(commits.get(commitSha).tree.sha);
  h.fileAt = (commitSha, path) => { const id = treeOf(commitSha).get(path); return id ? blobs.get(id).toString('utf8') : null; };
  h.addCommit = (parent, changes, message = 'x') => {
    const tree = new Map(treeOf(parent));
    for (const [path, text] of Object.entries(changes)) tree.set(path, store(text));
    const treeId = sha1(JSON.stringify([...tree])); trees.set(treeId, tree);
    const id = sha1(JSON.stringify([treeId, parent, message, commits.size]));
    commits.set(id, { tree: { sha: treeId }, parents: [parent], message });
    return id;
  };
  h.moveMain = changes => { h.main = h.addCommit(refs.get('main'), changes, 'main moves'); refs.set('main', h.main); return h.main; };
  h.fetch = async (url, options) => {
    url = String(url);
    assert.ok(url.startsWith(`https://api.github.com/repos/${OWNER}/${REPO}/`), url);
    assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store'); assert.ok(options.signal);
    assert.equal(options.headers.Authorization, 'Bearer ' + TOKEN);
    const u = new URL(url), route = decodeURIComponent(u.pathname.replace(`/repos/${OWNER}/${REPO}/`, ''));
    if (route.startsWith('contents/')) assert.equal(options.headers.Accept, 'application/vnd.github.object+json');
    const body = options.body && JSON.parse(options.body);
    calls.push({ method: options.method, path: route, body });
    if (options.method !== 'GET') {
      // Writes are limited to objects and the one draft ref, never main.
      assert.ok(['git/blobs', 'git/trees', 'git/commits', 'git/refs', 'git/refs/heads/' + BRANCH].includes(route), 'unexpected write ' + route);
      if (route === 'git/refs') assert.equal(body.ref, 'refs/heads/' + BRANCH);
      if (route.startsWith('git/refs/heads/')) assert.equal(body.force, false, 'the ref update is a non-force compare-and-swap');
    }
    if (h.failRead && options.method === 'GET' && route.startsWith(h.failRead)) {
      return Response.json({ message: 'private upstream detail ' + TOKEN }, { status: 503 });
    }
    let result;
    if (route.startsWith('git/ref/heads/')) {
      const name = route.slice('git/ref/heads/'.length), value = refs.get(name);
      if (!value) return Response.json({ message: 'Not Found' }, { status: 404 });
      result = { ref: 'refs/heads/' + name, object: { type: 'commit', sha: value } };
    } else if (route.startsWith('contents/')) {
      const commit = commits.get(u.searchParams.get('ref'));
      assert.ok(commit, 'reads use a known immutable commit');
      const tree = trees.get(commit.tree.sha), path = route.slice('contents/'.length);
      if (tree.has(path)) {
        const bytes = blobs.get(tree.get(path));
        result = { type: 'file', sha: tree.get(path), size: bytes.length, encoding: 'base64', content: bytes.toString('base64') };
        if (h.corrupt === path) result.content = Buffer.from('x'.repeat(bytes.length)).toString('base64');
        if (bytes.length > 1_000_000) { result.encoding = 'none'; result.content = ''; }
      } else {
        const prefix = path + '/';
        const entries = [...tree].filter(([name]) => name.startsWith(prefix) && !name.slice(prefix.length).includes('/'))
          .map(([name, id]) => ({ type: 'file', name: name.slice(prefix.length), path: name, sha: id, size: blobs.get(id).length }));
        if (!entries.length) return Response.json({ message: 'Not Found' }, { status: 404 });
        result = { type: 'dir', name: path.split('/').pop(), path, sha: sha1(path), size: 0, entries };
      }
    } else if (route.startsWith('git/blobs/')) {
      const id = route.slice('git/blobs/'.length), bytes = blobs.get(id);
      assert.ok(bytes);
      result = { sha: id, size: bytes.length, encoding: 'base64', content: bytes.toString('base64') };
    } else if (route.startsWith('git/commits/')) {
      const id = route.slice('git/commits/'.length), value = commits.get(id);
      result = { sha: id, tree: value.tree, parents: value.parents.map(parent => ({ sha: parent })) };
    } else if (route === 'git/blobs') {
      assert.equal(body.encoding, 'base64');
      result = { sha: store(Buffer.from(body.content, 'base64')) };
    } else if (route === 'git/trees') {
      const tree = new Map(trees.get(body.base_tree));
      for (const entry of body.tree) {
        assert.equal(entry.mode, '100644'); assert.equal(entry.type, 'blob');
        tree.set(entry.path, entry.sha || store(entry.content));
      }
      const id = sha1(JSON.stringify([...tree])); trees.set(id, tree); result = { sha: id };
    } else if (route === 'git/commits') {
      const id = sha1(JSON.stringify(body) + calls.length);
      commits.set(id, { tree: { sha: body.tree }, parents: body.parents, message: body.message });
      if (h.raceOnCommit) { const hook = h.raceOnCommit; h.raceOnCommit = null; hook(); }
      result = { sha: id };
    } else if (route === 'git/refs' || route.startsWith('git/refs/heads/')) {
      const exists = refs.has(BRANCH);
      if (route === 'git/refs' ? exists : commits.get(body.sha).parents[0] !== refs.get(BRANCH)) {
        return Response.json({ message: 'Update is not a fast forward' }, { status: 422 });
      }
      refs.set(BRANCH, body.sha); result = { ref: 'refs/heads/' + BRANCH, object: { type: 'commit', sha: body.sha } };
    } else assert.fail('unexpected GitHub API path: ' + route);
    if (h.tamper) result = h.tamper(route, result);
    return Response.json(result);
  };
  h.send = async (method, query = {}, body, headers = {}) => {
    const req = { method, query, headers: { host: HOST, cookie: h.cookie, origin: ORIGIN, 'sec-fetch-site': 'same-origin',
      'content-type': 'application/json', ...headers } };
    for (const [k, v] of Object.entries(req.headers)) if (v === null) delete req.headers[k];
    if (body !== undefined) req.body = body;
    const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.code = n; return this; },
      json(v) { this.body = v; return this; } };
    const original = globalThis.fetch;
    const env = { ADMIN_PASSWORD: process.env.ADMIN_PASSWORD, GITHUB_TOKEN: process.env.GITHUB_TOKEN,
      GITHUB_OWNER: process.env.GITHUB_OWNER, GITHUB_REPO: process.env.GITHUB_REPO, GITHUB_BRANCH: process.env.GITHUB_BRANCH };
    Object.assign(process.env, { ADMIN_PASSWORD: 'fixture', GITHUB_TOKEN: TOKEN, GITHUB_OWNER: OWNER, GITHUB_REPO: REPO, GITHUB_BRANCH: 'main' },
      h.env || {});
    for (const [k, v] of Object.entries(h.env || {})) if (v === undefined) delete process.env[k];
    globalThis.fetch = h.fetch;
    try { await handler(req, res); }
    finally {
      globalThis.fetch = original;
      for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes(TOKEN) && !text.includes('private upstream detail'), 'no credential or provider detail in the response');
    assert.equal(res.headers['Cache-Control'], 'no-store, max-age=0');
    return { status: res.code, body: res.body, headers: res.headers };
  };
  h.get = query => h.send('GET', query);
  h.post = (body, headers) => h.send('POST', {}, body, headers);
  h.writes = () => calls.filter(call => call.method !== 'GET');
  h.head = () => refs.get(BRANCH);
  return h;
}

const NOTE_TOKEN = key => sha(NOTES[key]);
const EXPL_TOKEN = sha(EXPL_TEXT);
const editedNote = (key = NOTE) => NOTES[key].replace('</ul>', '<li>新增一行重點。<span class="ref">p.1</span></li>\n</ul>');
function editedEntry(id = ID_A, tag = '修訂') {
  const entry = plain(EXPL_DATA[id]);
  entry.summary = entry.summary + '（' + tag + '）';
  entry.items[0].text = entry.items[0].text + '補充說明。';
  return entry;
}
const noteBody = (extra = {}) => ({ kind: 'note', key: NOTE, content: editedNote(), baseBlobSha: NOTE_TOKEN(NOTE), ...extra });
const explBody = (id = ID_A, extra = {}) => ({ kind: 'expl', id, entry: editedEntry(id), baseBlobSha: EXPL_TOKEN, ...extra });

test('access: admin session, same-origin writes, JSON only, methods and server configuration', async () => {
  const h = fixture();
  h.cookie = '';
  for (const [method, query, body] of [['GET', { mode: 'list' }], ['GET', { kind: 'note', key: NOTE }], ['GET', { kind: 'expl', id: ID_A }], ['POST', {}, noteBody()]]) {
    const result = await h.send(method, query, body);
    assert.equal(result.status, 401); assert.deepEqual(result.body, { ok: false, error: 'login_required' });
  }
  h.cookie = 'hs_admin_session=' + encodeURIComponent(makeSessionToken('another-password'));
  assert.equal((await h.get({ mode: 'list' })).status, 401, 'a session signed with another secret is refused');
  h.cookie = 'hs_admin_session=' + encodeURIComponent(makeSessionToken('fixture'));
  for (const headers of [{ origin: 'https://evil.test' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' },
    { 'sec-fetch-site': null }, { origin: null }, { origin: 'http://' + HOST }]) {
    const result = await h.post(noteBody(), headers);
    assert.equal(result.status, 403, JSON.stringify(headers)); assert.equal(result.body.error, 'same_origin_required');
  }
  assert.equal((await h.post(noteBody(), { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await h.post(noteBody(), { 'content-type': 'application/x-www-form-urlencoded' })).status, 415);
  const put = await h.send('PUT', {});
  assert.equal(put.status, 405); assert.equal(put.headers.Allow, 'GET, POST');
  h.env = { ADMIN_PASSWORD: undefined };
  assert.equal((await h.get({ mode: 'list' })).status, 401, 'no admin password configured means no session');
  h.env = { GITHUB_TOKEN: undefined };
  const unconfigured = await h.get({ mode: 'list' });
  assert.equal(unconfigured.status, 503); assert.equal(unconfigured.body.error, 'github_not_configured');
  h.env = { GITHUB_BRANCH: BRANCH };
  assert.equal((await h.get({ mode: 'list' })).body.error, 'github_not_configured', 'the draft branch can never be the base');
  assert.deepEqual(h.calls.filter(call => call.method !== 'GET'), [], 'rejected requests never write');
  assert.ok(h.calls.every(call => call.path.startsWith('git/ref/heads/')), 'only the configuration probe reached GitHub');
});

test('the dispatcher routes /api/admin/exam-draft to the handler', async () => {
  const dispatcher = (await import('../../api/admin/[op].js')).default;
  const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; } };
  await dispatcher({ method: 'GET', query: { op: 'exam-draft', mode: 'list' }, headers: {} }, res);
  assert.equal(res.code, 401); assert.deepEqual(res.body, { ok: false, error: 'login_required' });
});

test('reads: chapter list, a note and an explanation from main', async () => {
  const h = fixture();
  const list = await h.get({ mode: 'list' });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  const keys = Object.keys(NOTES).sort((a, b) => { const [x, y] = a.split('-').map(Number), [p, q] = b.split('-').map(Number); return x - p || y - q; });
  assert.deepEqual(list.body.notes.map(row => row.key), keys);
  const row = list.body.notes.find(item => item.key === NOTE);
  assert.equal(row.title, CHAPTERS.find(b => b.book === 1).chapters.find(c => c.ch === 4).title);
  assert.equal(typeof row.book, 'string');
  assert.deepEqual(list.body.draft, { exists: false, notes: [], explanations: [], updated: null });
  const note = await h.get({ kind: 'note', key: NOTE });
  assert.deepEqual(note.body, { ok: true, key: NOTE, content: NOTES[NOTE], source: 'main', blobSha: NOTE_TOKEN(NOTE) });
  const expl = await h.get({ kind: 'expl', id: ID_A });
  assert.equal(expl.status, 200);
  assert.deepEqual(expl.body.entry, EXPL_DATA[ID_A]); assert.equal(expl.body.source, 'main'); assert.equal(expl.body.blobSha, EXPL_TOKEN);
  assert.equal(typeof expl.body.question.stem, 'string'); assert.deepEqual(Object.keys(expl.body.question.options), ['A', 'B', 'C', 'D']);
  assert.ok(h.calls.some(call => call.path.startsWith('git/blobs/')), 'the 2.7 MB explanations file is read through its Git blob');
  const missing = await h.get({ kind: 'note', key: '1-99' });
  assert.equal(missing.status, 404); assert.equal(missing.body.error, 'unknown_note');
  for (const key of ['0-1', '1', '1-4x', '../1-4', '', undefined]) {
    const r = await h.get({ kind: 'note', key }); assert.equal(r.status, 400, String(key)); assert.equal(r.body.error, 'invalid_chapter');
  }
  assert.equal((await h.get({ kind: 'note', key: [NOTE, OTHER] })).body.error, 'invalid_chapter', 'repeated parameters are refused');
  const unknown = await h.get({ kind: 'expl', id: '99999' });
  assert.equal(unknown.status, 404); assert.equal(unknown.body.error, 'unknown_question');
  for (const id of ['0', '02', '1-1', 'abc', '']) { const r = await h.get({ kind: 'expl', id }); assert.equal(r.status, 400); assert.equal(r.body.error, 'invalid_id'); }
  assert.equal((await h.get({})).body.error, 'invalid_request');
  assert.deepEqual(h.writes(), []);
});

test('note save: branch created from main, canonical manifest, verified, then reads come from the draft', async () => {
  const h = fixture();
  const saved = await h.post(noteBody());
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const body = editedNote();
  assert.equal(saved.body.blobSha, sha(body)); assert.equal(saved.body.head, h.head());
  assert.equal(saved.body.branch, BRANCH); assert.equal(saved.body.published, false);
  assert.equal(h.commits.get(h.head()).parents[0], h.main, 'the branch starts from the main head');
  assert.equal(h.commits.get(h.head()).message, 'CMS exam draft: note bcsc' + NOTE);
  assert.equal(h.fileAt(h.head(), notePath(NOTE)), body);
  const text = h.fileAt(h.head(), MANIFEST), manifest = JSON.parse(text);
  assert.equal(text, manifestText(manifest));
  assert.deepEqual(Object.keys(manifest), ['version', 'baseMain', 'updated', 'notes', 'explanations']);
  assert.equal(manifest.baseMain, h.main); assert.deepEqual(manifest.notes, [NOTE]); assert.deepEqual(manifest.explanations, []);
  assert.match(manifest.updated, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.deepEqual(saved.body.draft, { exists: true, notes: [NOTE], explanations: [], updated: manifest.updated });
  assert.equal(h.refs.get('main'), h.main, 'main is untouched');
  assert.deepEqual(h.writes().map(call => call.path), ['git/blobs', 'git/trees', 'git/commits', 'git/refs']);

  const reread = await h.get({ kind: 'note', key: NOTE });
  assert.deepEqual(reread.body, { ok: true, key: NOTE, content: body, source: 'draft', blobSha: saved.body.blobSha });
  assert.equal((await h.get({ kind: 'note', key: OTHER })).body.source, 'main');
  assert.deepEqual((await h.get({ mode: 'list' })).body.draft.notes, [NOTE]);

  const first = h.head();
  const again = await h.post({ kind: 'note', key: NOTE, content: body + '\n', baseBlobSha: saved.body.blobSha });
  assert.equal(again.status, 200); assert.equal(h.commits.get(h.head()).parents[0], first);
  assert.equal(h.writes().at(-1).path, 'git/refs/heads/' + BRANCH);
  const second = await h.post({ kind: 'note', key: OTHER, content: editedNote(OTHER), baseBlobSha: NOTE_TOKEN(OTHER) });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.deepEqual(second.body.draft.notes, [NOTE, OTHER], 'keys sort by section then chapter');
  assert.equal(JSON.parse(h.fileAt(h.head(), MANIFEST)).baseMain, h.main, 'baseMain stays the original main');
  assert.equal(h.fileAt(h.head(), notePath(NOTE)), body + '\n');
  assert.equal((await h.post({ kind: 'note', key: NOTE, content: body, baseBlobSha: saved.body.blobSha })).status, 409);
});

test('note save normalizes CRLF to LF; the unchanged note is accepted as it is', async () => {
  const h = fixture();
  assert.equal((await h.post(noteBody({ content: editedNote().replace(/\n/g, '\r\n') }))).status, 200);
  assert.equal(h.fileAt(h.head(), notePath(NOTE)), editedNote());
  const same = fixture();
  assert.equal((await same.post(noteBody({ content: NOTES[NOTE] }))).status, 200);
  assert.equal(same.fileAt(same.head(), notePath(NOTE)), NOTES[NOTE]);
});

test('note sanitizer: every committed note passes unchanged', () => {
  assert.equal(Object.keys(NOTES).length >= 200, true);
  for (const [key, text] of Object.entries(NOTES)) {
    assert.equal(content.validateNote(text, { onPage: onPage(key), headings: TOC[key], simplified: SIMPLIFIED }), text, key);
  }
});

test('note sanitizer: what _gen_exam.py or the page cannot take is rejected with a readable reason', async () => {
  const h = fixture();
  const base = NOTES[NOTE];
  const check = async (source, pattern, status = 400, error = 'invalid_note') => {
    const result = await h.post(noteBody({ content: source }));
    assert.equal(result.status, status, source.slice(-160) + ' => ' + JSON.stringify(result.body));
    assert.equal(result.body.error, error); assert.match(result.body.reason, pattern, source.slice(-160));
  };
  const add = extra => base.replace('</ul>', extra + '\n</ul>');
  const top = extra => base + extra + '\n';
  await check(add('<li><script>alert(1)</script></li>'), /<script>/);
  await check(add('<li><style>p{}</style></li>'), /<style>/);
  await check(add('<li><a href="https://x.test">x</a></li>'), /<a>/);
  await check(add('<li><img src="x.png"></li>'), /<img>/);
  await check(add('<li><iframe></iframe></li>'), /<iframe>/);
  await check(add('<li><svg></svg></li>'), /<svg>/);
  await check(add('<li style="color:red">x</li>'), /style/);
  await check(add('<li onclick="x()">x</li>'), /onclick/);
  await check(add("<li><span class='ref' onclick='x()'>x</span></li>"), /開始標籤/);
  await check(add('<li><span class=ref>x</span></li>'), /開始標籤/);
  await check(add('<li><span class="evil">x</span></li>'), /evil/);
  await check(add('<li><span class="ref num">x</span></li>'), /class/);
  await check(add('<li><span>x</span></li>'), /class/);
  await check(add('<li class="ref">x</li>'), /class/);
  await check(add('<li id="np-1">x</li>'), /id/);
  await check(add('<li><mark class="ex-key">x</mark></li>'), /class/);
  await check(top('<div class="hs-redflag-box"><p>x</p></div>'), /hs-redflag-box/);
  await check(top('<table class="ted-table" style="x"><tbody><tr><td>x</td></tr></tbody></table>'), /style/);
  await check(top('<table class="ted-table"><tbody><tr><th scope="all">a</th></tr></tbody></table>'), /scope/);
  await check(top('<table class="ted-table"><tbody><tr><td colspan="0">a</td></tr></tbody></table>'), /colspan/);
  await check(top('<table class="ted-table"><tbody><tr><td><table class="ted-table"><tbody><tr><td>x</td></tr></tbody></table></td></tr></tbody></table>'), /巢狀/);
  await check(top('<table class="ted-table"><p>moved</p><tbody><tr><td>x</td></tr></tbody></table>'), /位置|移到/);
  await check(top('<table class="ted-table">loose<tbody><tr><td>x</td></tr></tbody></table>'), /位置|移到/);
  await check(top('<table class="ted-table"><tr><td>x</td></tr></table>'), /缺少開始標籤|錯亂|位置|移到/);
  await check(add('<!-- note -->'), /註解/);
  await check(add('<![CDATA[x]]>'), /註解/);
  await check(add('<li>a</div> b</li>'), /結束標籤/);
  await check(add('<li>one<li>two</li>'), /結束標籤/);
  await check(add('<li>x</LI>'), /結束標籤/);
  await check(add('<li>x</li >'), /結束標籤/);
  await check(add('<li>a</br></li>'), /結束標籤|錯亂|位置|<br>/);
  await check(add('<li>a<br/></li>'), /開始標籤/);
  await check(add('<li>a' + String.fromCharCode(1) + 'b</li>'), /控制字元/);
  await check('<body>' + base, /./);
  await check('stray text\n' + base, /最外層/);
  await check('<p>before the first heading</p>\n' + base, /<h2/);
  await check(top('<li>x</li>'), /最外層/);
  await check(top('<span class="ref">x</span>'), /最外層/);
  await check(base.replace('<ul>', '<div class="keypoint"><h2 id="ch4-s99">x</h2></div>\n<ul>'), /最外層/);
  await check('', /空/);
  await check('  \n', /空/);
  // {{q:N}} labels: only questions tagged to this chapter, only that syntax.
  const foreign = [...Array(1800).keys()].map(n => n + 1).find(n => !onPage(NOTE).has(n));
  await check(add(`<li>x{{q:${foreign}}}</li>`), new RegExp('不屬於本章.*' + foreign));
  await check(add('<li>x{{q:}}</li>'), /\{\{q/);
  await check(add('<li>x{{q:2,,3}}</li>'), /\{\{q/);
  await check(add('<li>x{{hit:2}}</li>'), /\{\{/);
  await check(add('<li>x{{q:2}</li>'), /\{\{/);
  // Public notes never disclose an answer; Traditional Chinese only.
  await check(add('<li>本題答案是 B。</li>'), /答案/);
  await check(add('<li>故選 C。</li>'), /答案/);
  await check(add('<li>following the exam convention</li>'), /答案/);
  await check(add('<li>' + SIMPLIFIED_CHAR + '</li>'), /簡體/);
  // The outline (toc_en.json) cannot change from the editor; heading ids stay unique.
  await check(base.replace('id="ch4-s1"', 'id="ch4-new"'), /toc_en/);
  await check(base.replace(/<h2 id="ch4-s2">[\s\S]*?(?=<h2 )/, ''), /toc_en|缺少的 id/);
  await check(base.replace('<h2 id="ch4-s1">', '<h2>'), /h2|id/);
  await check(base.replace('<h3>', '<h3 id="ch4-s2">'), /重複/);
  await check(base.replace('<h3>', '<h3 id="np-3">'), /id/);
  await check(base.replace('<h3>', '<h3 id="Bad_Id">'), /id/);
  assert.deepEqual(h.writes(), [], 'nothing rejected reaches Git');
  // Size cap on the note itself.
  await check(add('<li>' + 'x'.repeat(620_000) + '</li>'), /600 KB/, 413, 'too_large');
});

test('ANSWER_LEAK matches the generator: a letter followed by a CJK character is not an option letter', () => {
  assert.ok(content.ANSWER_LEAK.test('答案為 B。'));
  assert.ok(content.ANSWER_LEAK.test('答案為（A）'));
  assert.ok(!content.ANSWER_LEAK.test('答案為B型肝炎'), 'Python \\b treats CJK as word characters');
  assert.ok(!content.ANSWER_LEAK.test('Answer Key'), 'case-sensitive like the Python pattern');
});

test('explanation save changes only that entry and keeps the file byte for byte', async () => {
  const h = fixture();
  const saved = await h.post(explBody());
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const updated = h.fileAt(h.head(), EXPL);
  assert.equal(saved.body.blobSha, sha(updated));
  const expected = JSON.parse(EXPL_TEXT); expected[ID_A] = editedEntry();
  assert.equal(updated, JSON.stringify(expected, null, 1));
  const marker = line => /^ "\d+": \{$/.test(line);
  const before = EXPL_TEXT.split('\n'), after = updated.split('\n');
  const start = before.indexOf(' "' + ID_A + '": {'), end = start + 1 + before.slice(start + 1).findIndex(marker);
  assert.ok(start > 0 && end > start);
  const tail = before.length - end;
  assert.deepEqual(after.slice(0, start), before.slice(0, start));
  assert.deepEqual(after.slice(after.length - tail), before.slice(end));
  assert.notDeepEqual(after.slice(start, after.length - tail), before.slice(start, end));
  assert.deepEqual(Object.keys(JSON.parse(updated)), Object.keys(EXPL_DATA), 'key order is kept');
  assert.ok(!updated.endsWith('\n'));
  assert.equal(h.commits.get(h.head()).message, 'CMS exam draft: explanation ' + ID_A);
  assert.deepEqual(JSON.parse(h.fileAt(h.head(), MANIFEST)).explanations, [ID_A]);
  const reread = await h.get({ kind: 'expl', id: ID_A });
  assert.deepEqual(reread.body.entry, editedEntry()); assert.equal(reread.body.source, 'draft'); assert.equal(reread.body.blobSha, saved.body.blobSha);
});

test('explanation drafts accumulate and newer main text is never reverted', async () => {
  const h = fixture();
  const first = await h.post(explBody(ID_A));
  assert.equal(first.status, 200);
  const mainEdited = JSON.parse(EXPL_TEXT); mainEdited[ID_C] = { ...mainEdited[ID_C], summary: mainEdited[ID_C].summary + '（main 修改）' };
  h.moveMain({ [EXPL]: JSON.stringify(mainEdited, null, 1) });
  const other = await h.get({ kind: 'expl', id: ID_B });
  assert.equal(other.body.source, 'main'); assert.equal(other.body.blobSha, sha(h.fileAt(h.main, EXPL)));
  const second = await h.post({ kind: 'expl', id: ID_B, entry: editedEntry(ID_B, '第二題'), baseBlobSha: other.body.blobSha });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  const merged = JSON.parse(h.fileAt(h.head(), EXPL));
  assert.deepEqual(merged[ID_A], editedEntry(ID_A));
  assert.deepEqual(merged[ID_B], editedEntry(ID_B, '第二題'));
  assert.equal(merged[ID_C].summary, mainEdited[ID_C].summary, 'an entry changed on main after the branch was created is kept');
  assert.deepEqual(second.body.draft.explanations, [ID_A, ID_B]);
  assert.equal((await h.post({ kind: 'expl', id: ID_A, entry: editedEntry(ID_A, '三'), baseBlobSha: first.body.blobSha })).status, 409);
  const reread = await h.get({ kind: 'expl', id: ID_A });
  assert.equal(reread.body.blobSha, second.body.blobSha);
  assert.equal((await h.post({ kind: 'expl', id: ID_A, entry: editedEntry(ID_A, '三'), baseBlobSha: reread.body.blobSha })).status, 200);
  const tenth = await h.post({ kind: 'expl', id: '10', entry: editedEntry('10'), baseBlobSha: sha(h.fileAt(h.main, EXPL)) });
  assert.equal(tenth.status, 200, JSON.stringify(tenth.body));
  assert.deepEqual(tenth.body.draft.explanations, [ID_A, ID_B, '10'], 'question ids sort numerically');
});

test('every explanation re-saved unchanged reproduces the stored file exactly', () => {
  assert.equal(JSON.stringify(EXPL_DATA, null, 1), EXPL_TEXT, 'JS serialization equals the committed bytes');
  const rules = { books: BOOKS, simplified: SIMPLIFIED };
  for (const id of Object.keys(EXPL_DATA)) assert.deepEqual(content.validateEntry(plain(EXPL_DATA[id]), EXPL_DATA[id], rules), EXPL_DATA[id], id);
  for (const id of [ID_A, '1774']) assert.equal(content.replaceExplanation(EXPL_TEXT, id, plain(EXPL_DATA[id]), rules).text, EXPL_TEXT, id);
  // Key order in the request does not change the bytes.
  const entry = plain(EXPL_DATA[ID_A]);
  const shuffled = { items: entry.items.map(it => ({ refs: it.refs, text: it.text, label: it.label, answer: it.answer, key: it.key })),
    flags: entry.flags, summary: entry.summary, answer: entry.answer };
  assert.equal(content.replaceExplanation(EXPL_TEXT, ID_A, shuffled, rules).text, EXPL_TEXT);
});

test('explanation schema: bad shapes and values are rejected before anything is written', async () => {
  const h = fixture();
  const attempt = async (mutate, pattern, id = ID_A, status = 400, error = 'invalid_entry') => {
    const entry = editedEntry(EXPL_DATA[id] ? id : ID_A); mutate(entry);
    const result = await h.post({ kind: 'expl', id, entry, baseBlobSha: EXPL_TOKEN });
    assert.equal(result.status, status, JSON.stringify(result.body)); assert.equal(result.body.error, error);
    if (pattern) assert.match(result.body.reason, pattern);
  };
  const correct = entry => entry.items.findIndex(it => it.answer);
  await attempt(e => { e.extra = 1; }, /extra/);
  await attempt(e => { delete e.flags; }, /flags/);
  await attempt(e => { delete e.answer; }, /answer/);
  await attempt(e => { e.summary = ''; }, /summary/);
  await attempt(e => { e.summary = 'a\nb'; }, /換行/);
  await attempt(e => { e.summary = ' 前面有空白'; }, /空白/);
  await attempt(e => { e.summary = 'x'.repeat(1001); }, /1000/);
  await attempt(e => { e.items.pop(); }, /四個/);
  await attempt(e => { e.items[1].key = 'E'; }, /key/);
  await attempt(e => { [e.items[0], e.items[1]] = [e.items[1], e.items[0]]; }, /key/);
  await attempt(e => { e.items[0].extra = true; }, /extra/);
  await attempt(e => { e.items[0].answer = 'yes'; }, /true\/false/);
  await attempt(e => { e.items.forEach(it => { it.answer = true; }); }, /剛好有一個/);
  await attempt(e => { e.items.forEach(it => { it.answer = false; }); }, /剛好有一個/);
  await attempt(e => { e.answer = e.items[(correct(e) + 1) % 4].key; }, /不一致/);
  await attempt(e => { e.items[0].label = ''; }, /label/);
  await attempt(e => { e.items[0].text = 'x'.repeat(2001); }, /2000/);
  await attempt(e => { e.items[0].refs = [[99, '1']]; }, /冊別/);
  await attempt(e => { e.items[0].refs = [['1', '1']]; }, /冊別/);
  await attempt(e => { e.items[0].refs = [[1, '276-277']]; }, /頁碼/);
  await attempt(e => { e.items[0].refs = [[1, 'p.1']]; }, /頁碼/);
  await attempt(e => { e.items[0].refs = [[1]]; }, /冊, 頁/);
  await attempt(e => { e.items[0].refs = Array(11).fill([1, '1']); }, /10/);
  await attempt(e => { e.flags = ['']; }, /flags/);
  await attempt(e => { e.flags = 'x'; }, /flags/);
  await attempt(e => { e.items[2].text += SIMPLIFIED_CHAR; }, /簡體/);
  await attempt(() => {}, /沒有題號/, '99999', 404, 'unknown_question');
  for (const bad of [{ kind: 'expl', id: ID_A, entry: editedEntry(), baseBlobSha: 'nope' }, { kind: 'expl', id: '1-1', entry: {}, baseBlobSha: EXPL_TOKEN },
    { kind: 'other', baseBlobSha: EXPL_TOKEN }, { kind: 'expl', id: ID_A, entry: editedEntry(), baseBlobSha: EXPL_TOKEN, extra: 1 }, [1]]) {
    const result = await h.post(bad); assert.equal(result.status, 400, JSON.stringify(bad));
  }
  assert.deepEqual(h.writes(), []);
});

test('explanation save fails closed when the stored file is not in the exact json.dumps format', async () => {
  const h = fixture();
  h.moveMain({ [EXPL]: EXPL_TEXT + '\n' });
  const result = await h.post({ ...explBody(), baseBlobSha: sha(EXPL_TEXT + '\n') });
  assert.equal(result.status, 409); assert.equal(result.body.error, 'format_mismatch');
  assert.deepEqual(h.writes(), []);
});

test('a stale baseBlobSha is a conflict and nothing is written', async () => {
  const h = fixture();
  assert.equal((await h.post(noteBody())).status, 200);
  const head = h.head(), writes = h.writes().length;
  assert.equal((await h.post(noteBody({ content: editedNote() + '\n' }))).status, 409, 'the main token is stale once the chapter is drafted');
  assert.equal((await h.post(noteBody({ baseBlobSha: 'b'.repeat(40) }))).body.error, 'conflict');
  assert.equal((await h.post(explBody(ID_A, { baseBlobSha: 'c'.repeat(40) }))).status, 409);
  assert.equal(h.head(), head); assert.equal(h.writes().length, writes);
  const moved = fixture();
  moved.moveMain({ [notePath(NOTE)]: NOTES[NOTE] + '\n' });
  assert.equal((await moved.post(noteBody())).status, 409, 'a token from before main changed the file is stale');
  assert.deepEqual(moved.writes(), []);
});

test('a concurrent writer makes the ref update fail as a conflict', async () => {
  const h = fixture();
  const first = await h.post(noteBody());
  h.raceOnCommit = () => h.refs.set(BRANCH, h.addCommit(h.head(), { [notePath(OTHER)]: 'other' }));
  const raced = await h.post({ kind: 'note', key: NOTE, content: editedNote() + '\n', baseBlobSha: first.body.blobSha });
  assert.equal(raced.status, 409); assert.equal(raced.body.error, 'conflict');
  const created = fixture();
  created.raceOnCommit = () => created.refs.set(BRANCH, created.addCommit(created.main, { 'x.txt': 'y' }));
  const result = await created.post(noteBody());
  assert.equal(result.status, 409); assert.equal(result.body.error, 'conflict');
});

test('body cap, malformed JSON and malformed draft records', async () => {
  const h = fixture();
  const big = JSON.stringify(noteBody({ content: 'x'.repeat(MAX_BODY) }));
  assert.equal((await h.post(big)).status, 413);
  assert.equal((await h.post(noteBody({ content: 'x'.repeat(MAX_BODY) }))).status, 413, 'a parsed body over the cap is refused too');
  assert.equal((await h.post('{}', { 'content-length': String(MAX_BODY + 1) })).status, 413);
  assert.equal((await h.post('{not json')).status, 400);
  assert.equal((await h.post('null')).status, 400);
  assert.deepEqual(h.writes(), []);
  const withoutManifest = fixture();
  withoutManifest.refs.set(BRANCH, withoutManifest.addCommit(withoutManifest.main, { 'x.txt': 'y' }));
  assert.equal((await withoutManifest.post(noteBody())).body.error, 'invalid_draft_record');
  assert.equal((await withoutManifest.get({ mode: 'list' })).status, 502);
  const good = { version: 1, baseMain: 'a'.repeat(40), updated: '2026-11-04T00:00:00Z', notes: [], explanations: [] };
  for (const record of ['{"version":2}\n', '[]\n', JSON.stringify(good) + '\n', JSON.stringify(good, null, 1),
    manifestText({ ...good, notes: [4] }), manifestText({ ...good, notes: ['12-4', '1-4'] }), manifestText({ ...good, notes: ['1-4', '1-4'] }),
    manifestText({ ...good, explanations: ['10', '9'] }), manifestText({ ...good, explanations: [2] }), manifestText({ ...good, extra: 1 }),
    manifestText({ ...good, baseMain: 'zz' }), manifestText({ ...good, updated: 'yesterday' })]) {
    const broken = fixture();
    broken.refs.set(BRANCH, broken.addCommit(broken.main, { [MANIFEST]: record }));
    const result = await broken.post(noteBody());
    assert.equal(result.status, 502, record); assert.equal(result.body.error, 'invalid_draft_record');
    assert.deepEqual(broken.writes(), []);
  }
  const fine = fixture();
  fine.refs.set(BRANCH, fine.addCommit(fine.main, { [MANIFEST]: manifestText({ ...good, notes: ['1-4', '12-4'], explanations: ['9', '10'] }) }));
  assert.equal((await fine.get({ mode: 'list' })).status, 200, 'a well-formed manifest is accepted');
});

test('upstream failures and tampered repository data fail closed without leaking details', async () => {
  const h = fixture();
  h.failRead = 'contents/data/exam/notes';
  const failed = await h.get({ mode: 'list' });
  assert.equal(failed.status, 502); assert.match(failed.body.error, /^github_/);
  const rules = fixture();
  rules.failRead = 'contents/data/exam/toc_en.json';
  assert.equal((await rules.post(noteBody())).status, 502, 'validation data that cannot be read stops the save');
  assert.deepEqual(rules.writes(), []);
  const tampered = fixture();
  tampered.corrupt = notePath(NOTE);
  const bad = await tampered.get({ kind: 'note', key: NOTE });
  assert.equal(bad.status, 502); assert.equal(bad.body.error, 'invalid_repository_content');
  const mismatch = fixture();
  mismatch.tamper = (route, result) => route === 'git/blobs/' + EXPL_TOKEN ? { ...result, content: Buffer.from('x'.repeat(result.size)).toString('base64') } : result;
  assert.equal((await mismatch.get({ kind: 'expl', id: ID_A })).status, 502);
  const wrongBlob = fixture();
  wrongBlob.tamper = (route, result) => route === 'git/blobs' ? { sha: 'e'.repeat(40) } : result;
  assert.equal((await wrongBlob.post(noteBody())).body.error, 'save_not_verified');
  const unverified = fixture();
  unverified.tamper = (route, result) => route === 'git/refs' ? { object: { sha: 'f'.repeat(40) } } : result;
  const notVerified = await unverified.post(noteBody());
  assert.equal(notVerified.status, 502); assert.equal(notVerified.body.error, 'save_not_verified');
  const timeout = fixture();
  timeout.fetch = async () => { const error = new Error('timed out'); error.name = 'TimeoutError'; throw error; };
  assert.equal((await timeout.get({ mode: 'list' })).body.error, 'github_timeout');
  const denied = fixture();
  denied.fetch = async () => Response.json({ message: 'Bad credentials ' + TOKEN }, { status: 401 });
  assert.equal((await denied.get({ mode: 'list' })).body.error, 'github_token_invalid');
});
