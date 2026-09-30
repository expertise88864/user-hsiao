import assert from 'node:assert/strict';
import test from 'node:test';
import publicationStatus from '../../api/admin/_publication-status.js';
import siteVersion from '../../api/admin/_site-version.js';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import dispatcher from '../../api/admin/[op].js';
import { makeSessionToken } from '../../api/admin/_login.js';
import { articleBlobSha } from '../../api/admin/_save.js';

const live = '<!doctype html><html><body>Published article 中文</body></html>';
const commit = 'c'.repeat(40), production = 'd'.repeat(40);
const repository = 'expertise88864/user-hsiao';
const origin = 'https://hsiao.chendermatologist.com';
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
const respond = () => ({ code:200, headers:{}, setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.body=v;return this;} });

async function fixture(run, overrides = {}) {
  const keys = ['ADMIN_PASSWORD','GITHUB_TOKEN','GITHUB_OWNER','GITHUB_REPO','VERCEL_GIT_PROVIDER','VERCEL_GIT_COMMIT_SHA','VERCEL_GIT_REPO_OWNER','VERCEL_GIT_REPO_SLUG','VERCEL_ENV'];
  const env = Object.fromEntries(keys.map(k => [k,process.env[k]]));
  const fetchOriginal = globalThis.fetch, requests = [];
  Object.assign(process.env, {ADMIN_PASSWORD:'fixture',GITHUB_TOKEN:'server-only-token',GITHUB_OWNER:'expertise88864',GITHUB_REPO:'user-hsiao',
    VERCEL_GIT_PROVIDER:'github',VERCEL_GIT_COMMIT_SHA:production,VERCEL_GIT_REPO_OWNER:'expertise88864',VERCEL_GIT_REPO_SLUG:'user-hsiao',VERCEL_ENV:'production'});
  const req = {method:'GET',headers:{cookie:'hs_admin_session='+makeSessionToken('fixture')},query:{slug:'dry-eye-myths',blob:articleBlobSha(live),commit}};
  globalThis.fetch = async (url,options) => {
    url=String(url); requests.push({url,options});
    assert.equal(options.method,'GET'); assert.equal(options.redirect,'error'); assert.equal(options.cache,'no-store');
    if(url.startsWith(origin)) assert.equal(options.headers,undefined,'never forward credentials to the public site');
    else assert.ok(url.startsWith('https://api.github.com/repos/'+repository+'/'));
    for(const [part,value] of Object.entries(overrides)) if(url.includes(part)) return typeof value==='function' ? value(url,options) : value;
    if(url.endsWith('/site-version')) return json({sha:production,repository,environment:'production'});
    if(url===origin+'/blog/dry-eye-myths') return new Response(live,{headers:{'Content-Type':'text/html; charset=utf-8'}});
    if(url.includes('/compare/')) return json({base_commit:{sha:commit},merge_base_commit:{sha:commit},status:'ahead'});
    if(url.includes('/pulls?')) return json([{head:{sha:commit,repo:{full_name:repository}},base:{repo:{full_name:repository}}}]);
    if(url.includes('/statuses?')) return json([{state:'success',environment_url:'https://candidate.vercel.app'}]);
    if(url.includes('/deployments?')) return json([{id:1,sha:commit,environment:'Preview',production_environment:false,creator:{login:'vercel[bot]'}}]);
    throw new Error('Unexpected request');
  };
  try { await run(req,requests); }
  finally { globalThis.fetch=fetchOriginal;for(const k of keys) if(env[k]===undefined) delete process.env[k];else process.env[k]=env[k]; }
}

test('read-only status proves actual canonical bytes separately from ancestry, Preview and release verification',async()=>{
  await fixture(async(req,requests)=>{
    const res=respond(); await publicationStatus(req,res);
    assert.equal(res.code,200); assert.equal(res.body.production.state,'matching_content');
    assert.equal(res.body.production.sha,production); assert.equal(res.body.production.includesSavedCommit,'yes');
    assert.equal(res.body.preview.url,'https://candidate.vercel.app/blog/dry-eye-myths');
    assert.equal(res.body.releaseVerified,false); assert.ok(requests.length>=5);
    assert.ok(!JSON.stringify(res.body).includes('server-only-token'));
    assert.equal(res.headers['Cache-Control'],'no-store, max-age=0');
  });
});

test('source ancestry never implies live content equality, including later generated or overwritten content',async()=>{
  await fixture(async req=>{
    req.query.blob='b'.repeat(40); const res=respond();await publicationStatus(req,res);
    assert.equal(res.body.production.includesSavedCommit,'yes'); assert.equal(res.body.production.state,'different_content');
    assert.equal(res.body.releaseVerified,false);
  });
});

for (const version of [{environment:'preview',sha:production,repository},{environment:'production',sha:production,repository:'fork/user-hsiao'},{environment:'production',sha:'main',repository},{environment:'unknown'}]) {
  test('wrong or missing canonical runtime identity is unknown: '+JSON.stringify(version),async()=>{
    await fixture(async(req,requests)=>{
      const res=respond();await publicationStatus(req,res);assert.equal(res.body.production.state,'unknown');
      assert.equal(res.body.production.sha,'');assert.ok(!requests.some(r=>r.url===origin+'/blog/dry-eye-myths'));
    },{'/site-version':json(version)});
  });
}

test('failure in one source does not turn the independent content observation into zero or a pass',async()=>{
  await fixture(async req=>{
    const res=respond();await publicationStatus(req,res);
    assert.equal(res.body.production.state,'matching_content');assert.equal(res.body.production.includesSavedCommit,'unknown');
    assert.equal(res.body.preview.state,'unknown');assert.equal(res.body.releaseVerified,false);
  },{'api.github.com':()=>{throw new Error('private provider failure');}});
});

test('no-op receipt with no commit can compare content but cannot invent a candidate or ancestry',async()=>{
  await fixture(async(req,requests)=>{
    req.query.commit='';const res=respond();await publicationStatus(req,res);
    assert.equal(res.body.production.state,'matching_content');assert.equal(res.body.preview.state,'no_receipt');
    assert.equal(res.body.production.includesSavedCommit,'unknown');assert.equal(res.body.commitUrl,null);
    assert.ok(!requests.some(r=>r.url.includes('api.github.com')));
  });
});

for (const state of ['failure','inactive','pending','in_progress']) {
  test('latest '+state+' cannot fall back to an older Ready Preview',async()=>{
    await fixture(async req=>{
      const res=respond();await publicationStatus(req,res);assert.equal(res.body.preview.state,state);assert.equal(res.body.preview.url,null);
    },{'/statuses?':json([{state,environment_url:'https://bad.vercel.app'},{state:'success',environment_url:'https://old.vercel.app'}])});
  });
}

test('Preview requires the exact SHA and same repository PR, not a fork or an unrelated successful deployment',async()=>{
  await fixture(async(req,requests)=>{
    const res=respond();await publicationStatus(req,res);assert.equal(res.body.preview.state,'no_candidate_pr');
    assert.ok(!requests.some(r=>r.url.includes('/deployments?')));
  },{'/pulls?':json([{head:{sha:commit,repo:{full_name:'attacker/user-hsiao'}},base:{repo:{full_name:repository}}}])});
  await fixture(async req=>{
    const res=respond();await publicationStatus(req,res);assert.equal(res.body.preview.state,'not_found');
  },{'/deployments?':json([{id:1,sha:production,environment:'Preview',production_environment:false,creator:{login:'vercel[bot]'}}])});
});

for (const url of ['http://candidate.vercel.app','https://candidate.vercel.app.attacker.test','https://x:secret@candidate.vercel.app','https://candidate.vercel.app/?bypass=secret']) {
  test('Preview URLs reject unsafe origin and credentials: '+url,async()=>{
    await fixture(async req=>{
      const res=respond();await publicationStatus(req,res);assert.equal(res.body.preview.state,'unknown');assert.equal(res.body.preview.url,null);
    },{'/statuses?':json([{state:'success',environment_url:url}])});
  });
}

test('HTML mismatch, missing body, oversized response, and provider timeout remain explicit unknown observations',async()=>{
  for (const response of [new Response('login',{headers:{'Content-Type':'application/json'}}),new Response(null,{status:204}),new Response('x'.repeat(2*1024*1024+1),{headers:{'Content-Type':'text/html'}})]) {
    await fixture(async req=>{
      const res=respond();await publicationStatus(req,res);assert.equal(res.body.production.state,'unknown');
      assert.equal(res.body.production.includesSavedCommit,'yes','available ancestry is independent of unreadable HTML');
    }, {'/blog/dry-eye-myths':response});
  }
  await fixture(async req=>{const res=respond();await publicationStatus(req,res);assert.equal(res.body.production.state,'unknown');},
    {'/site-version':()=>{throw new DOMException('Timed out','AbortError');}});
});

test('bundled CommonJS dispatcher serves the public identity through its standard default-handler path',async()=>{
  const compiled=await build({entryPoints:['api/admin/[op].js'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false});
  await fixture(async(req,requests)=>{
    const module={exports:{}};
    new Function('module','exports','require',compiled.outputFiles[0].text)(module,module.exports,createRequire(import.meta.url));
    const res=respond();await module.exports.default({...req,headers:{},query:{op:'site-version'}},res);
    assert.equal(res.body.sha,production);assert.equal(res.body.environment,'production');
    assert.equal(requests.length,0);
  });
});

test('auth, method and repeated/path-traversal/version query validation prevent network work',async()=>{
  await fixture(async(req,requests)=>{
    for(const query of [{slug:'../admin',blob:req.query.blob,commit},{...req.query,slug:['dry-eye-myths']},{...req.query,blob:'main'},{...req.query,commit:['a']}]) {
      const res=respond();await publicationStatus({...req,query},res);assert.equal(res.code,400);
    }
    let res=respond();await publicationStatus({...req,headers:{}},res);assert.equal(res.code,401);
    res=respond();await publicationStatus({...req,method:'POST'},res);assert.equal(res.code,405);
    assert.equal(requests.length,0);
  });
});

test('the shared eight-second deadline aborts a stalled canonical request and returns unknown',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  await fixture(async req=>{
    delete process.env.GITHUB_TOKEN;
    const res=respond();const pending=publicationStatus(req,res);
    t.mock.timers.tick(8000);await pending;
    assert.equal(res.body.production.state,'unknown');assert.equal(res.body.preview.state,'unknown');
    assert.equal(res.body.releaseVerified,false);
  },{'/site-version':(_url,options)=>new Promise((_resolve,reject)=>{
    options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
  })});
});

test('dispatcher exposes only allowlisted runtime identity publicly and keeps status authenticated',async()=>{
  await fixture(async(req,requests)=>{
    let res=respond();await dispatcher({...req,headers:{},query:{op:'site-version'}},res);
    assert.deepEqual(res.body,{sha:production,repository,environment:'production'});
    res=respond();await dispatcher({...req,headers:{},query:{...req.query,op:'publication-status'}},res);assert.equal(res.code,401);
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    res=respond();siteVersion(req,res);assert.deepEqual(res.body,{environment:'unknown'});
    res=respond();siteVersion({...req,method:'POST'},res);assert.equal(res.code,405);
    assert.equal(requests.length,0);
  });
});
