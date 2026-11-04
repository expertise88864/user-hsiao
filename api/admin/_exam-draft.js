/**
 * GET/POST /api/admin/exam-draft — the admin exam editor's drafts.
 *
 * Edits chapter study notes (data/exam/notes/bcsc<key>.htm) and one question's
 * explanation at a time (data/exam/explanations.json). Writes go ONLY to the
 * fixed branch cms-exam/drafts with the Git Data API (blob → tree → commit →
 * non-forced ref update, a compare-and-swap). This endpoint cannot update main,
 * choose another branch or repository, or publish. The maintainer integrates a
 * draft with _pull_exam_drafts.py on a codex/* branch, runs the build chain, CI
 * and the PR review (api/admin/README.md "考試內容草稿").
 *
 * Auth: the existing admin session cookie (_auth.js isAdminRequest); the GitHub
 * token comes from the server environment (getRepoConfig) and is never returned.
 * POST additionally requires a same-origin browser request with a JSON body.
 *
 *   GET  ?mode=list                → chapters with notes + the draft record
 *   GET  ?kind=note&key=1-1        → { content, source, blobSha }
 *   GET  ?kind=expl&id=128         → { entry, question, source, blobSha }
 *   POST {kind:'note', key, content, baseBlobSha}
 *   POST {kind:'expl', id, entry, baseBlobSha}
 */
import { createHash } from 'node:crypto';
import { isAdminRequest, getRepoConfig } from './_auth.js';
import {
  ExamContentError, NOTE_KEY, QUESTION_ID, MAX_NOTE_BYTES, simplifiedSet,
  validateNote, replaceExplanation, composeExplanations, readExplanation,
} from './_exam-content.js';

export const BRANCH = 'cms-exam/drafts';
export const MANIFEST = '.cms-exam/drafts.json';
const NOTES_DIR = 'data/exam/notes';
const EXPLANATIONS = 'data/exam/explanations.json';
const DATA = {
  chapters: 'data/exam/chapters.json', chapterZh: 'data/exam/chapter_zh.json', tags: 'data/exam/tags.json',
  toc: 'data/exam/toc_en.json', simplified: 'data/exam/simplified_chars.txt', questions: 'data/exam/questions.json',
};
const SHA = /^(?!0{40}$)[a-f0-9]{40}$/;
const NAME = /^[A-Za-z0-9_.-]{1,100}$/;
export const MAX_BODY = 1_000_000;
const MAX_NOTE_FILE = 1_000_000;
const MAX_EXPLANATIONS_FILE = 6_000_000;
const MAX_DATA_FILE = 2_000_000;
const MAX_API_RESPONSE = 9_000_000;
const TIMEOUT_MS = 15_000;

class DraftError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
function fail(status, code) { throw new DraftError(status, code); }

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(status).json(body);
}
function validSha(value, status = 400, code = 'invalid_revision') {
  if (typeof value !== 'string' || !SHA.test(value)) fail(status, code);
  return value;
}
export function gitBlobSha(bytes) {
  return createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
}
function compareKeys(a, b) {
  const [ab, ac] = a.split('-').map(Number), [bb, bc] = b.split('-').map(Number);
  return ab - bb || ac - bc;
}
const byNumber = (a, b) => Number(a) - Number(b);

// ------------------------------------------------------------------ GitHub
async function readCapped(response, limit) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) fail(502, 'invalid_repository_content');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}

function github() {
  const { owner, repo, token } = getRepoConfig();
  if (!token) fail(503, 'github_not_configured');
  if (!NAME.test(owner || '') || !NAME.test(repo || '')) fail(503, 'github_not_configured');
  const base = `https://api.github.com/repos/${owner}/${repo}/`;
  // `missing` = a 404 is an answer (null), not a failure; `ref` = 422 on a ref write is a conflict.
  return async (method, path, body, { missing = false, ref = false } = {}) => {
    const headers = {
      Accept: path.startsWith('contents/') ? 'application/vnd.github.object+json' : 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'HsiaoEye-ExamDrafts/1.0',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetch(base + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      fail(502, error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'github_timeout' : 'github_fetch_failed');
    }
    if (response.status === 404 && missing) { await response.body?.cancel().catch(() => {}); return null; }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if (ref && (response.status === 409 || response.status === 422)) fail(409, 'conflict');
      if (response.status === 401) fail(502, 'github_token_invalid');
      if (response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')) fail(502, 'github_rate_limited');
      if (response.status === 403) fail(502, 'github_forbidden');
      fail(502, 'github_fetch_failed');
    }
    const bytes = await readCapped(response, MAX_API_RESPONSE);
    try { return JSON.parse(bytes.toString('utf8')); } catch (_) { fail(502, 'invalid_repository_content'); }
  };
}

async function branchHead(api, branch) {
  const data = await api('GET', 'git/ref/heads/' + branch.split('/').map(encodeURIComponent).join('/'), undefined, { missing: true });
  if (data === null) return null;
  if (!data || data.ref !== 'refs/heads/' + branch || data.object?.type !== 'commit' || !SHA.test(data.object.sha || '')) {
    fail(502, 'invalid_repository_ref');
  }
  return data.object.sha;
}

// The Contents API omits files above 1 MB; then the immutable Git blob is read.
// Either way the bytes must hash to the advertised blob SHA.
async function file(api, path, commit, limit, optional = false) {
  const data = await api('GET', 'contents/' + path + '?ref=' + commit, undefined, { missing: optional });
  if (data === null) return null;
  if (!data || data.type !== 'file' || !SHA.test(data.sha || '') || !Number.isInteger(data.size) ||
      data.size < 0 || data.size > limit) fail(502, 'invalid_repository_content');
  const blob = data.encoding === 'base64' && typeof data.content === 'string' ? data : await api('GET', 'git/blobs/' + data.sha);
  if (!blob || blob.encoding !== 'base64' || typeof blob.content !== 'string' || (blob !== data && blob.sha !== data.sha)) {
    fail(502, 'invalid_repository_content');
  }
  const base64 = blob.content.replace(/\s/g, '');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) fail(502, 'invalid_repository_content');
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length !== data.size || gitBlobSha(bytes) !== data.sha) fail(502, 'invalid_repository_content');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (_) { fail(502, 'invalid_repository_content'); }
  return { sha: data.sha, text };
}
async function json(api, path, commit, optional = false) {
  const stored = await file(api, path, commit, MAX_DATA_FILE, optional);
  if (!stored) return null;
  try { return JSON.parse(stored.text); } catch (_) { fail(502, 'invalid_repository_content'); }
}

// ------------------------------------------------------------- draft record
// The record lists exactly which sources differ from main; only those are read
// from the branch (everything else from current main) and only those are pulled.
export function manifestText(record) { return JSON.stringify(record, null, 1) + '\n'; }
export function parseManifest(text) {
  let record;
  try { record = JSON.parse(text); } catch (_) { fail(502, 'invalid_draft_record'); }
  const keys = ['version', 'baseMain', 'updated', 'notes', 'explanations'];
  if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).join() !== keys.join() ||
      record.version !== 1 || !SHA.test(record.baseMain || '') || typeof record.updated !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(record.updated) || !Number.isFinite(Date.parse(record.updated)) ||
      !Array.isArray(record.notes) || !Array.isArray(record.explanations) ||
      record.notes.some(key => typeof key !== 'string' || !NOTE_KEY.test(key)) ||
      record.explanations.some(id => typeof id !== 'string' || !QUESTION_ID.test(id)) ||
      [...record.notes].sort(compareKeys).join() !== record.notes.join() || new Set(record.notes).size !== record.notes.length ||
      [...record.explanations].sort(byNumber).join() !== record.explanations.join() ||
      new Set(record.explanations).size !== record.explanations.length ||
      manifestText(record) !== text) fail(502, 'invalid_draft_record');
  return record;
}
function view(record) {
  return record ? { exists: true, notes: record.notes, explanations: record.explanations, updated: record.updated }
    : { exists: false, notes: [], explanations: [], updated: null };
}
async function state(api) {
  const { branch } = getRepoConfig();
  if (!NAME.test(branch || '') || branch === BRANCH) fail(503, 'github_not_configured');
  const main = await branchHead(api, branch);
  if (!main) fail(502, 'invalid_repository_ref');
  const head = await branchHead(api, BRANCH);
  let record = null;
  if (head) {
    const stored = await file(api, MANIFEST, head, 200_000, true);
    if (!stored) fail(502, 'invalid_draft_record');
    record = parseManifest(stored.text);
  }
  return { main, head, record };
}

// ------------------------------------------------------------------ reads
function noteKey(value) {
  if (typeof value !== 'string' || !NOTE_KEY.test(value)) fail(400, 'invalid_chapter');
  return value;
}
function questionId(value) {
  if (typeof value !== 'string' || !QUESTION_ID.test(value)) fail(400, 'invalid_id');
  return value;
}
export const notePath = key => `${NOTES_DIR}/bcsc${key}.htm`;
async function readNote(api, loaded, key) {
  const fromDraft = !!loaded.record && loaded.record.notes.includes(key);
  const stored = await file(api, notePath(key), fromDraft ? loaded.head : loaded.main, MAX_NOTE_FILE, true);
  if (!stored) fail(404, 'unknown_note');
  return { ...stored, source: fromDraft ? 'draft' : 'main' };
}
async function readExplanations(api, loaded, id) {
  const fromDraft = !!loaded.record && loaded.record.explanations.includes(id);
  const stored = await file(api, EXPLANATIONS, fromDraft ? loaded.head : loaded.main, MAX_EXPLANATIONS_FILE);
  return { ...stored, source: fromDraft ? 'draft' : 'main' };
}

async function list(api) {
  const loaded = await state(api);
  const listing = await api('GET', 'contents/' + NOTES_DIR + '?ref=' + loaded.main);
  const rows = Array.isArray(listing) ? listing : listing && listing.type === 'dir' && Array.isArray(listing.entries) ? listing.entries : null;
  if (!rows) fail(502, 'invalid_repository_content');
  const keys = rows.map(row => row && row.type === 'file' && /^bcsc([1-9]\d?-[1-9]\d?)\.htm$/.exec(row.name || ''))
    .filter(Boolean).map(match => match[1]).sort(compareKeys);
  // Titles are decoration only: a missing or odd file never blocks the editor.
  const titles = new Map(), zh = new Map();
  try {
    for (const book of await json(api, DATA.chapters, loaded.main, true) || []) {
      for (const ch of book.chapters || []) titles.set(`${book.book}-${ch.ch}`, { book: String(book.title || '').slice(0, 120), title: String(ch.title || '').slice(0, 200) });
    }
  } catch (_) { titles.clear(); }
  try {
    for (const [key, names] of Object.entries(await json(api, DATA.chapterZh, loaded.main, true) || {})) {
      if (Array.isArray(names) && typeof names[0] === 'string') zh.set(key, names[0].slice(0, 80));
    }
  } catch (_) { zh.clear(); }
  return {
    ok: true,
    notes: keys.map(key => ({ key, ...(titles.get(key) || {}), ...(zh.has(key) ? { zh: zh.get(key) } : {}) })),
    draft: view(loaded.record),
  };
}

async function questionOf(api, loaded, id) {
  try {
    const questions = await json(api, DATA.questions, loaded.main, true);
    const q = Array.isArray(questions) && questions.find(row => row && String(row.n) === id);
    if (!q || typeof q.stem !== 'string' || !q.options || typeof q.options !== 'object') return null;
    return { stem: q.stem, options: Object.fromEntries(Object.entries(q.options).filter(([, v]) => typeof v === 'string')) };
  } catch (_) { return null; } // context for the editor only
}

// ------------------------------------------------------------------ writes
function bodyOf(req) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') fail(415, 'json_required');
  const declared = Number(req.headers['content-length'] || 0);
  if (!Number.isFinite(declared) || declared > MAX_BODY) fail(413, 'too_large');
  let body;
  try { body = req.body; } catch (_) { fail(400, 'invalid_request'); }
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') {
    if (Buffer.byteLength(body) > MAX_BODY) fail(413, 'too_large');
    try { body = JSON.parse(body); } catch (_) { fail(400, 'invalid_request'); }
  } else if (body && typeof body === 'object') {
    if (Buffer.byteLength(JSON.stringify(body)) > MAX_BODY) fail(413, 'too_large');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'invalid_request');
  return body;
}

async function rules(api, commit, names) {
  const loaded = {};
  for (const name of names) {
    const stored = await file(api, DATA[name], commit, MAX_DATA_FILE);
    if (name === 'simplified') { loaded.simplified = simplifiedSet(stored.text); continue; }
    try { loaded[name] = JSON.parse(stored.text); } catch (_) { fail(502, 'invalid_repository_content'); }
  }
  return loaded;
}

async function save(api, input) {
  const fields = input.kind === 'note' ? ['kind', 'key', 'content', 'baseBlobSha']
    : input.kind === 'expl' ? ['kind', 'id', 'entry', 'baseBlobSha'] : null;
  if (!fields || Object.keys(input).some(k => !fields.includes(k)) || fields.some(k => !(k in input))) fail(400, 'invalid_request');
  validSha(input.baseBlobSha);
  const loaded = await state(api);
  const previous = loaded.record || { version: 1, baseMain: loaded.main, updated: '', notes: [], explanations: [] };
  let path, text, notes = previous.notes, explanations = previous.explanations, label;
  if (input.kind === 'note') {
    const key = noteKey(input.key);
    const current = await readNote(api, loaded, key);
    if (current.sha !== input.baseBlobSha) fail(409, 'conflict');
    // The rules come from the main commit the edit is based on.
    const data = await rules(api, loaded.main, ['tags', 'toc', 'simplified']);
    const onPage = new Set(Object.entries(data.tags || {})
      .filter(([, tag]) => tag && Array.isArray(tag.ch) && tag.ch.includes(key)).map(([n]) => Number(n)));
    text = validateNote(input.content, { onPage, headings: (data.toc || {})[key], simplified: data.simplified });
    path = notePath(key);
    notes = [...new Set([...notes, key])].sort(compareKeys);
    label = 'note bcsc' + key;
    if (Buffer.byteLength(text) > Math.min(MAX_NOTE_FILE, MAX_NOTE_BYTES)) fail(413, 'too_large');
  } else {
    const id = questionId(input.id);
    const current = await readExplanations(api, loaded, id);
    if (current.sha !== input.baseBlobSha) fail(409, 'conflict');
    const data = await rules(api, loaded.main, ['chapters', 'simplified']);
    const books = new Set((Array.isArray(data.chapters) ? data.chapters : []).map(book => book && book.book).filter(Number.isInteger));
    // Rebuild from current main plus the drafted entries, then change this one.
    const drafted = previous.explanations;
    const draftCopy = !drafted.length ? null : current.source === 'draft' ? current
      : await file(api, EXPLANATIONS, loaded.head, MAX_EXPLANATIONS_FILE);
    const mainCopy = current.source === 'main' ? current : await file(api, EXPLANATIONS, loaded.main, MAX_EXPLANATIONS_FILE);
    text = replaceExplanation(composeExplanations(mainCopy.text, draftCopy && draftCopy.text, drafted), id, input.entry,
      { books, simplified: data.simplified }).text;
    path = EXPLANATIONS;
    explanations = [...new Set([...explanations, id])].sort(byNumber);
    label = 'explanation ' + id;
    if (Buffer.byteLength(text) > MAX_EXPLANATIONS_FILE) fail(413, 'too_large');
  }
  const record = { version: 1, baseMain: previous.baseMain, updated: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), notes, explanations };
  const parentSha = loaded.head || loaded.main;
  const parent = await api('GET', 'git/commits/' + parentSha);
  if (!parent || !SHA.test(parent.tree?.sha || '')) fail(502, 'invalid_repository_content');
  const bytes = Buffer.from(text, 'utf8');
  const blob = await api('POST', 'git/blobs', { content: bytes.toString('base64'), encoding: 'base64' });
  const blobSha = validSha(blob && blob.sha, 502, 'save_not_verified');
  if (blobSha !== gitBlobSha(bytes)) fail(502, 'save_not_verified');
  const tree = await api('POST', 'git/trees', { base_tree: parent.tree.sha, tree: [
    { path, mode: '100644', type: 'blob', sha: blobSha },
    { path: MANIFEST, mode: '100644', type: 'blob', content: manifestText(record) },
  ] });
  const commit = await api('POST', 'git/commits', {
    message: 'CMS exam draft: ' + label, tree: validSha(tree && tree.sha, 502, 'save_not_verified'), parents: [parentSha],
  });
  const next = validSha(commit && commit.sha, 502, 'save_not_verified');
  // A non-forced update is the compare-and-swap: a concurrent save makes it a
  // non-fast-forward (422 → conflict). The branch is created from main only when absent.
  const result = loaded.head
    ? await api('PATCH', 'git/refs/heads/' + BRANCH.split('/').map(encodeURIComponent).join('/'), { sha: next, force: false }, { ref: true })
    : await api('POST', 'git/refs', { ref: 'refs/heads/' + BRANCH, sha: next }, { ref: true });
  if (!result || !result.object || result.object.sha !== next) fail(502, 'save_not_verified');
  try {
    const accepted = await file(api, path, next, input.kind === 'note' ? MAX_NOTE_FILE : MAX_EXPLANATIONS_FILE);
    const acceptedRecord = await file(api, MANIFEST, next, 200_000);
    if (accepted.sha !== blobSha || accepted.text !== text || acceptedRecord.text !== manifestText(record)) fail(502, 'save_not_verified');
  } catch (_) { fail(502, 'save_not_verified'); }
  return { ok: true, head: next, blobSha, branch: BRANCH, draft: view(record), published: false };
}

// Browsers send Origin and Sec-Fetch-Site on fetch(); both must say same-origin.
function sameOrigin(req) {
  const h = req.headers || {};
  const host = String(h.host || '');
  if (!host || h['sec-fetch-site'] !== 'same-origin' || typeof h.origin !== 'string') return false;
  const local = /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(host);
  return h.origin === 'https://' + host || (local && h.origin === 'http://' + host);
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { ok: false, error: 'method_not_allowed' });
  }
  try {
    if (req.method === 'POST' && !sameOrigin(req)) fail(403, 'same_origin_required');
    if (!process.env.ADMIN_PASSWORD || !isAdminRequest(req)) fail(401, 'login_required');
    const api = github();
    if (req.method === 'GET') {
      const query = req.query || {};
      const one = name => (Array.isArray(query[name]) ? '' : query[name]);
      if (one('mode') === 'list') return send(res, 200, await list(api));
      if (one('kind') === 'note') {
        const key = noteKey(one('key'));
        const loaded = await state(api);
        const note = await readNote(api, loaded, key);
        return send(res, 200, { ok: true, key, content: note.text.replace(/\r\n?/g, '\n'), source: note.source, blobSha: note.sha });
      }
      if (one('kind') === 'expl') {
        const id = questionId(one('id'));
        const loaded = await state(api);
        const stored = await readExplanations(api, loaded, id);
        const entry = readExplanation(stored.text, id);
        return send(res, 200, { ok: true, id, entry, question: await questionOf(api, loaded, id), source: stored.source, blobSha: stored.sha });
      }
      fail(400, 'invalid_request');
    }
    return send(res, 200, await save(api, bodyOf(req)));
  } catch (error) {
    if (error instanceof ExamContentError) {
      const status = { unknown_question: 404, format_mismatch: 409, too_large: 413 }[error.code] || 400;
      return send(res, status, { ok: false, error: error.code, reason: error.reason });
    }
    if (error instanceof DraftError) return send(res, error.status, { ok: false, error: error.code });
    return send(res, 503, { ok: false, error: 'draft_unavailable' });
  }
}
