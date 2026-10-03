const assert = require('node:assert/strict');
const test = require('node:test');
const {requestPolicy,checkConfig,checkPageUrl,checkPhase} = require('../../scripts/index-font-experiment.cjs');
const origin = 'https://candidate.vercel.app';

test('font experiment cannot send telemetry or reach admin/foreign origins',() => {
  for (const [url,method] of [
    [origin + '/api/views','POST'],[origin + '/api/admin/stats','GET'],
    [origin + '/api/search-log','POST'],[origin + '/admin','GET'],
    ['https://hsiao.chendermatologist.com/assets/app.css','GET'],
    ['https://fonts.gstatic.com.evil.example/font.woff2','GET'],
    ['https://fonts.gstatic.com:8443/font.woff2','GET'],
    ['http://fonts.googleapis.com/css2','GET'],
    ['https://name:secret@fonts.googleapis.com/css2','GET'],
    ['https://fonts.googleapis.com/css2','POST'],
    [origin + '/assets/%2e%2e/api/admin/stats','GET'],
  ]) assert.equal(requestPolicy(url,method,origin),'block');
  assert.equal(requestPolicy(origin + '/blog/','GET',origin),'site');
  assert.equal(requestPolicy(origin + '/blog','GET',origin),'site');
  assert.equal(requestPolicy(origin + '/assets/app.css?v=1','GET',origin),'site');
  assert.equal(requestPolicy('https://fonts.googleapis.com/css2?family=Inter','GET',origin),'font-css');
  assert.equal(requestPolicy('https://fonts.gstatic.com/example.woff2','GET',origin),'font-data');
});

test('normal trailing-slash redirects are accepted without accepting another route or deployment',() => {
  checkPageUrl(origin + '/blog',origin);
  checkPageUrl(origin + '/blog/',origin);
  for (const value of [origin + '/login',origin + '/blog?secret=x',origin + '/blog#x','https://other.vercel.app/blog']) {
    assert.throws(() => checkPageUrl(value,origin));
  }
});

test('candidate identity must be exact and production cannot be experimented on',() => {
  const config = {SITE_URL:origin,CANDIDATE_SHA:'a'.repeat(40),GITHUB_REPOSITORY:'expertise88864/user-hsiao',CHROME_PATH:process.execPath};
  assert.equal(checkConfig(config).sha,'a'.repeat(40));
  for (const override of [
    {SITE_URL:'https://hsiao.chendermatologist.com'},
    {SITE_URL:origin + '/?secret=x'},
    {CANDIDATE_SHA:'main'},
    {GITHUB_REPOSITORY:'other/site'},
    {CHROME_PATH:'relative-chrome'},
  ]) assert.throws(() => checkConfig({...config,...override}));
});

test('font completion and automation exclusion cannot be inferred from ready alone',() => {
  const sample = {telemetryAllowed:false,language:'zh-Hant-TW',fontStatus:'loaded'};
  const system = [{fonts:[{familyName:'DejaVu Sans',isCustomFont:false}]}];
  const web = [{fonts:[{familyName:'Noto Serif TC',isCustomFont:true}]}];
  checkPhase(sample,system,'before');
  checkPhase(sample,web,'after');
  assert.throws(() => checkPhase(sample,web,'before'));
  assert.throws(() => checkPhase(sample,system,'after'));
  assert.throws(() => checkPhase({...sample,fontStatus:'loading'},web,'after'));
  assert.throws(() => checkPhase({...sample,telemetryAllowed:true},web,'after'));
  assert.throws(() => checkPhase({...sample,language:'en'},web,'after'));
});
