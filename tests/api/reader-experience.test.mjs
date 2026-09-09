import test from 'node:test';
import assert from 'node:assert/strict';
import metrics from '../../blog/reader-metrics.js';
import search from '../../blog/reader-search.js';
import { selectCwvSamples } from '../../api/_cwv_samples.js';

test('standard CWV reports do not mix legacy algorithms or double-count a metric ID', () => {
  const rows = [
    {v:200,t:110,version:'web-vitals-6',id:'new-page'},
    {v:900,t:109},
    {v:100,t:108,version:'web-vitals-6',id:'new-page'},
    {v:300,t:107,version:'web-vitals-6',id:'other-page'},
    {v:500,t:1,version:'web-vitals-6',id:'expired-page'}
  ];
  assert.deepEqual(selectCwvSamples(rows,100).map(s => s.v),[200,300]);
  assert.deepEqual(selectCwvSamples([{v:90,t:101}],100).map(s => s.v),[90]);
});

test('foreground time accumulates across hidden intervals and starts at zero for prerender', () => {
  let now = 0;
  const clock = metrics.createVisibleClock(() => now, false);
  now = 90000;
  assert.equal(clock.elapsed(), 0);
  clock.setVisible(true);
  now += 12000;
  clock.setVisible(false);
  now += 600000;
  assert.equal(clock.elapsed(), 12000);
  clock.setVisible(true);
  now += 18000;
  assert.equal(clock.elapsed(), 30000);
});

test('reading milestones never count a hidden interval or fire twice', t => {
  let now = 0, id = 0;
  const timers = new Map();
  t.mock.method(globalThis, 'setTimeout', cb => { timers.set(++id, cb); return id; });
  t.mock.method(globalThis, 'clearTimeout', key => timers.delete(key));
  const doc = new EventTarget();
  doc.visibilityState = 'visible';
  const events = [];
  const clock = metrics.observeReadingTime(doc, name => events.push(name), () => now);
  function visibility(state) { doc.visibilityState = state; doc.dispatchEvent(new Event('visibilitychange')); }
  function advance(ms) { now += ms; [...timers.values()].forEach(cb => cb()); }
  advance(10000);
  visibility('hidden');
  advance(600000);
  visibility('visible');
  advance(19000);
  assert.deepEqual(events, []);
  advance(1000);
  assert.deepEqual(events, ['time_30s']);
  advance(90000);
  visibility('hidden');
  advance(600000);
  assert.equal(clock.elapsed(), 120000);
  visibility('visible');
  advance(600000);
  assert.equal(clock.elapsed(), 720000);
  assert.deepEqual(events, ['time_30s', 'time_2min']);
  assert.equal(timers.size, 0);
});

test('search accepts equivalent vocabulary and requires every multiword term', () => {
  const index = [
    {title:'乾眼症迷思', search:'乾眼症 人工淚液',url:'/dry'},
    {title:'近視追蹤', search:'近視 度數 眼軸',url:'/myopia'},
    {title:'視力量表', search:'logMAR 視力 換算',url:'/tools'}
  ];
  assert.equal(search.rankSearch(index, '眼睛乾')[0].url, '/dry');
  assert.equal(search.rankSearch(index, 'dry eye')[0].url, '/dry');
  assert.equal(search.rankSearch(index, '近视 眼轴')[0].url, '/myopia');
  assert.equal(search.rankSearch(index, 'log mar')[0].url, '/tools');
  assert.deepEqual(search.rankSearch(index, '近視 不存在'), []);
});
