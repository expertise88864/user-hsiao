import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const shared = readFileSync(new URL('../../blog/blog-shared.js', import.meta.url), 'utf8');
const start = shared.indexOf('DN.applyAbConfig = function');
const end = shared.indexOf('// Convenience: report a conversion', start);
assert.ok(start > 0 && end > start);
const implementation = shared.slice(start, end);
const config = { tests: { fixture: { selector: '.target', variants: [{ name: 'a', html: '<p>First</p>' }, { name: 'b', html: '<p>Second</p>' }] } } };
const response = () => ({ ok: true, json: async () => config });
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(fetch) {
  const state = { editor: false, exposures: 0, target: { dataset: {}, tagName: 'DIV', innerHTML: '' } };
  const DN = { isAdminMode: () => state.editor, abTest: (_id, _names, apply) => { state.exposures++; apply('a', 0); } };
  const document = { prerendering: false, querySelector: () => state.target };
  vm.runInNewContext(implementation, { DN, document, fetch });
  return { DN, state };
}

test('activation and reader initialization share a delayed configuration request and one exposure', async () => {
  let requests = 0, release;
  const pending = new Promise(resolve => { release = resolve; });
  const { DN, state } = fixture(() => { requests++; return pending; });
  const calls = [DN.applyAbConfig(), DN.applyAbConfig(), DN.applyAbConfig()];
  assert.equal(requests, 1);
  release(response());
  await Promise.all(calls);
  await settle();
  assert.equal(state.exposures, 1);
  assert.equal(state.target.innerHTML, '<p>First</p>');
  await DN.applyAbConfig();
  assert.equal(requests, 1);
  assert.equal(state.exposures, 1);
});

test('failed configuration can be retried without suppressing a later successful request', async () => {
  let requests = 0;
  const { DN, state } = fixture(async () => (++requests === 1 ? { ok: false } : response()));
  await DN.applyAbConfig();
  await settle();
  assert.equal(state.exposures, 0);
  await DN.applyAbConfig();
  await settle();
  assert.equal(requests, 2);
  assert.equal(state.exposures, 1);
});

test('configuration arriving after entry to editing mode cannot replace authored content', async () => {
  let release;
  const { DN, state } = fixture(() => new Promise(resolve => { release = resolve; }));
  const pending = DN.applyAbConfig();
  state.editor = true;
  release(response());
  await pending;
  await settle();
  assert.equal(state.exposures, 0);
  assert.equal(state.target.innerHTML, '');
});
