import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../blog/blog-admin.js', import.meta.url), 'utf8');
const raster = source.slice(source.indexOf('    async function uploadImageInline('), source.indexOf('    function loadImageBitmap('));
const svg = source.slice(source.indexOf('    async function uploadSvgFallback('), source.indexOf('    // ─', source.indexOf('    async function uploadSvgFallback(')));

for (const format of ['raster', 'svg']) {
  for (const inserted of [false, true]) {
    test(`${format} upload reports insertion success only when insertion succeeds (${inserted})`, async () => {
      const messages = [];
      let attempts = 0;
      const context = vm.createContext({
        status: (text, kind) => messages.push({ text, kind }),
        insertArticleBlock: () => { attempts++; return inserted; },
        loadImageBitmap: async () => ({ width: 220 }),
        canEncodeAvif: async () => false,
        encodeAt: async () => 'fixture',
        fetch: async () => ({ ok: true, json: async () => ({ imgSnippet: '<img src="/fixture.webp">', url: '/fixture.svg' }) }),
        FileReader: class {
          readAsDataURL() { this.result = 'data:image/svg+xml;base64,PHN2Zy8+'; this.onload(); }
        },
      });
      vm.runInContext(raster + '\n' + svg, context);
      await context[format === 'raster' ? 'uploadImageInline' : 'uploadSvgFallback']({ name: 'fixture', type: 'image/png' });
      assert.equal(attempts, 1);
      assert.equal(messages.filter(message => message.kind === 'success').length, inserted ? 1 : 0);
      assert.equal(messages.filter(message => message.text.startsWith('✗')).length, 0);
    });
  }
}
