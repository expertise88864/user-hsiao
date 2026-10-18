const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createMeter } = require('../../scripts/vercel-request-meter.cjs');

test('each meter counts only its own deployment requests, so summed lines never double count', () => {
  const lines = [];
  const log = console.log;
  console.log = line => lines.push(line);
  try {
    const request = url => ({ url: () => url });
    const first = createMeter('first', 'https://candidate.vercel.app/');
    const page = first.attach(new EventEmitter());
    page.emit('request', request('https://candidate.vercel.app/blog'));
    page.emit('request', request('https://fonts.gstatic.com/font.woff2'));
    page.emit('request', request('data:image/png;base64,AA=='));
    first.add(2);
    first.report();
    const second = createMeter('second', 'https://candidate.vercel.app/');
    second.attach(new EventEmitter()).emit('request', request('https://candidate.vercel.app/'));
    second.report();
    assert.equal(first.total(), 3);
    assert.equal(second.total(), 1);
  } finally { console.log = log; }
  assert.match(lines[0], /^\[vercel-requests\] first: 3 \(browser 1, other 2\) host=<preview>\.vercel\.app$/);
  assert.match(lines[1], /^\[vercel-requests\] second: 1 \(browser 1, other 0\)/);
});
