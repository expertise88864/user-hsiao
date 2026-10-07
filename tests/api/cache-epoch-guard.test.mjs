import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const files = ['index.html', 'admin.html', ...fs.readdirSync(path.join(root, 'blog'))
  .filter(name => name.endsWith('.html')).map(name => 'blog/' + name)];
const guards = files.flatMap(file => {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .filter(match => match[1].includes('hs:siteVer')).map(match => ({file, source: match[1]}));
});
assert.ok(guards.length >= 2, 'Exercise the deployed home/index cache guard');

async function run(source, options = {}) {
  const target = source.match(/var (?:T|TARGET)\s*=\s*['"](\d+)['"]/)[1];
  const log = [];
  const registrations = options.registrations ?? [];
  const caches = options.caches ?? [];
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const context = {
    navigator: {serviceWorker: {controller: options.controller ?? null,
      getRegistrations: async () => {
        if (options.failure) throw new Error('Storage unavailable');
        return registrations.map(name => ({unregister: async () => {
          if (options.delayUnregister) await pending;
          log.push('unregister:' + name); return true;
        }}));
      }}},
    window: {},
    localStorage: {
      getItem: () => options.current ? target : options.stamp ?? null,
      setItem: (key, value) => {assert.equal(key, 'hs:siteVer'); assert.equal(value, target); log.push('stamp');},
    },
    location: {reload: () => log.push('reload')},
  };
  context.window.caches = context.caches = {
    keys: async () => {if (options.cacheFailure) throw new Error('Cache unavailable'); return caches;},
    delete: async name => {
      if (name === options.failedDelete) throw new Error('Deletion unavailable');
      if (options.delayDelete) await pending;
      log.push('delete:' + name); return true;
    },
  };
  if (options.unsupported) {delete context.navigator.serviceWorker; delete context.window.caches; delete context.caches;}
  vm.runInNewContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  if (options.beforeRelease) options.beforeRelease([...log]);
  release();
  await new Promise(resolve => setImmediate(resolve));
  return log;
}

test('fresh visitors with no workers or caches are stamped without reloading', async () => {
  for (const guard of guards) assert.deepEqual(await run(guard.source), ['stamp'], guard.file);
});
test('old worker and cache cleanup completes before a single reload', async () => {
  for (const guard of guards) {
    const log = await run(guard.source, {stamp: 'old', registrations: ['old-worker'], caches: ['old-shell', 'old-runtime']});
    assert.equal(log.filter(item => item === 'reload').length, 1, guard.file);
    assert.deepEqual(log.slice(-2), ['stamp', 'reload'], guard.file);
    assert.deepEqual(new Set(log.slice(0, -2)), new Set(['unregister:old-worker', 'delete:old-shell', 'delete:old-runtime']), guard.file);
  }
});
test('a controlling worker still requires reload when its registration is absent', async () => {
  for (const guard of guards) assert.deepEqual(await run(guard.source, {controller: {}}), ['stamp', 'reload'], guard.file);
});
test('an uninspectable worker retains the conservative reload path', async () => {
  for (const guard of guards) assert.deepEqual(await run(guard.source, {failure: true}), ['stamp', 'reload'], guard.file);
});

test('worker inspection failure waits for delayed cache cleanup before stamping', async () => {
  for (const guard of guards) {
    const log = await run(guard.source, {failure: true, caches: ['old-shell'], delayDelete: true,
      beforeRelease: pendingLog => assert.deepEqual(pendingLog, [], guard.file)});
    assert.deepEqual(log, ['delete:old-shell', 'stamp', 'reload'], guard.file);
  }
});

test('cache inspection failure waits for delayed worker cleanup before stamping', async () => {
  for (const guard of guards) {
    const log = await run(guard.source, {cacheFailure: true, registrations: ['old-worker'], delayUnregister: true,
      beforeRelease: pendingLog => assert.deepEqual(pendingLog, [], guard.file)});
    assert.deepEqual(log, ['unregister:old-worker', 'stamp', 'reload'], guard.file);
  }
});

test('one failed cache deletion waits for the other deletions to settle', async () => {
  for (const guard of guards) {
    const log = await run(guard.source, {caches: ['failed-shell', 'old-runtime'], failedDelete: 'failed-shell', delayDelete: true,
      beforeRelease: pendingLog => assert.deepEqual(pendingLog, [], guard.file)});
    assert.deepEqual(log, ['delete:old-runtime', 'stamp', 'reload'], guard.file);
  }
});
test('a matching epoch does not remove current offline caches or reload', async () => {
  for (const guard of guards) assert.deepEqual(await run(guard.source, {current: true, caches: ['current-shell']}), [], guard.file);
});
test('browsers without cache APIs can complete the epoch without reloading', async () => {
  for (const guard of guards) assert.deepEqual(await run(guard.source, {unsupported: true}), ['stamp'], guard.file);
});
