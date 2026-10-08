const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('Preview captures do not carry language or storage state from another route', async () => {
  const routes = ['/en/', '/blog/cataract-comprehensive-guide', '/en/blog/cataract-comprehensive-guide'];
  const contexts = [];
  const shots = [];
  const errors = [];
  const process = {env:{PW_BASE_URL:'https://candidate.vercel.app',GITHUB_SHA:'a'.repeat(40)}};
  const cookies = [{name:'preview-auth',value:'fixture-only'}];
  let editorCalled = false;
  let browserClosed = false;
  const browser = {
    async newContext(options) {
      const state = {id:contexts.length, options, language:null, closed:false};
      contexts.push(state);
      return {
        request:{},
        async addCookies(value) { assert.equal(value,cookies);state.authenticated=true; },
        async newPage() {
          let route;
          return {
            on() {},
            async goto(url) {
              assert.ok(state.authenticated);
              route = new URL(url).pathname;
              // Model a persisted preference after visiting an English route.
              if (route.startsWith('/en/')) state.language='en';
              state.language ||= 'zh-TW';
              return {};
            },
            locator(selector) { assert.equal(selector,'html');return {async getAttribute(name) {assert.equal(name,'lang');return state.language;}}; },
            async screenshot(options) { shots.push({route,language:state.language,context:state.id,path:options.path}); },
            async close() {},
          };
        },
        async close() {state.closed=true;},
      };
    },
    async close() {browserClosed=true;},
  };
  const dependencies = {
    'node:assert/strict':assert,
    'node:fs':{readFileSync:()=>JSON.stringify({repository:'expertise88864/user-hsiao',preview_paths:routes}),mkdirSync(){},writeFileSync(){}},
    playwright:{chromium:{launch:async()=>browser},request:{}},
    './scripts/preview-access.cjs':{
      previewCookies:async()=>cookies,
      verifyContent:async()=>{},
      verifyRuntimeIdentity:async()=>({sha:process.env.GITHUB_SHA,environment:'preview',repository:'expertise88864/user-hsiao'}),
    },
    './scripts/preview-editor-tasks.cjs':{captureEditorTasks:async()=>{editorCalled=true;}},
  };
  const source = fs.readFileSync(path.join(__dirname,'../../_delivery_preview.cjs'),'utf8');
  await vm.runInNewContext(source,{URL,process,console:{error:message=>errors.push(message)},require:name=>{
    assert.ok(Object.hasOwn(dependencies,name),'unexpected dependency '+name);
    return dependencies[name];
  }});
  assert.deepEqual(errors,[]);
  assert.equal(process.exitCode,undefined);
  assert.equal(shots.length,routes.length*2);
  for (const shot of shots) assert.equal(shot.language,shot.route.startsWith('/en/')?'en':'zh-TW');
  assert.equal(new Set(shots.map(shot=>shot.context)).size,shots.length);
  assert.ok(contexts.every(context=>context.closed));
  assert.ok(editorCalled && browserClosed);
});
