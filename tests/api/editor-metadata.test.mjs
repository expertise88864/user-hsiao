import assert from 'node:assert/strict';
import test from 'node:test';
import { readEditorMetadata } from '../../api/admin/_editor-metadata.js';
import { commitArticleWithModifiedDate } from '../../api/admin/_article-commit.js';
import { articleBlobSha } from '../../api/admin/_save.js';
import { catalogRecords } from '../../api/_articles.js';
import save from '../../api/admin/_save.js';
import { makeSessionToken } from '../../api/admin/_login.js';
import { normalizeMetadataText } from '../../blog/editor-punctuation.js';

const marker = data => '<meta name="hs-editor-metadata" content="' + encodeURIComponent(JSON.stringify({version:1,...data})) + '">';
test('offline/draft marker retains Unicode and literal markup as plain data; invalid metadata is rejected', () => {
  const data = { titleZh:'作者的標題 <tag> & "引號"', titleEn:"Author's title", descriptionEn:'English summary', catalogBaseSha:'a'.repeat(40) };
  assert.deepEqual(readEditorMetadata('<html><head>'+marker(data)+'</head></html>'), {version:1,...data});
  for (const bad of [{titleZh:''}, {titleEn:[]}, {descriptionZh:'x'.repeat(2001)}, {unknown:'field'}, {catalogBaseSha:'bad'}, {titleZh:'作者標題?'}, {descriptionZh:'作者摘要!'}]) {
    assert.throws(() => readEditorMetadata('<head>'+marker(bad)+'</head>'));
  }
  assert.throws(() => readEditorMetadata('<head>'+marker(data)+marker(data)+'</head>'), /Duplicate/);
  assert.throws(() => readEditorMetadata('<head><meta content="bad" name="hs-editor-metadata"></head>'), /serialization/);
  assert.deepEqual(readEditorMetadata('<head></head>'), {});
  assert.equal(readEditorMetadata('<head>'+marker({titleZh:'作者標題?'})+'</head>',{allowUnnormalized:true}).titleZh,'作者標題？');
});

test('plain metadata normalization handles field boundaries and literal markup without changing English punctuation',()=>{
  assert.equal(normalizeMetadataText('作者標題?'),'作者標題？');
  assert.equal(normalizeMetadataText('中文摘要! <code>中文?</code>'),'中文摘要！ <code>中文？</code>');
  assert.equal(normalizeMetadataText('Research & practice? Yes!'),'Research & practice? Yes!');
  assert.equal(normalizeMetadataText('問題 1:'),'問題 1：');
  assert.equal(normalizeMetadataText('Research study 1:'),'Research study 1:');
  assert.equal(normalizeMetadataText(normalizeMetadataText('中文?')),'中文？');
});

test('actual save handler reads catalog revision, rejects stale title changes, and atomically accepts current title changes', async () => {
  const oldFetch=globalThis.fetch, oldToken=process.env.GITHUB_TOKEN, oldPassword=process.env.ADMIN_PASSWORD;
  process.env.GITHUB_TOKEN='fixture';process.env.ADMIN_PASSWORD='fixture-password';
  let shared="DN.ARTICLES=[{slug:'first',title:'Original',title_en:'English',date:'2026-05-01'}];";
  const catalogSha=articleBlobSha(shared);
  const oldHtml='<html><head><title>Original</title></head><body><article class="max-w-3xl"><p>'+'Fixture '.repeat(30)+'</p></article></body></html>';
  let currentHtml=oldHtml;
  const headers={cookie:'hs_admin_session='+makeSessionToken(process.env.ADMIN_PASSWORD)};
  let refs=0, created=[];
  const respond=()=>({code:200,status(code){this.code=code;return this;},setHeader(){},json(body){this.body=body;return this;}});
  globalThis.fetch=async(url,options={})=>{
    url=String(url);const json=data=>({ok:true,json:async()=>data});
    if(url.includes('/contents/')) {const content=url.includes('blog-shared')?shared:currentHtml;return json({sha:articleBlobSha(content),content:Buffer.from(content).toString('base64')});}
    if(url.includes('/git/ref/'))return json({object:{sha:'base'}});
    if(url.endsWith('/git/commits/base'))return json({tree:{sha:'tree'}});
    if(url.endsWith('/git/blobs')){created.push(JSON.parse(options.body).content);return json({sha:'blob'});}
    if(url.endsWith('/git/trees'))return json({sha:'new-tree'});
    if(url.endsWith('/git/commits'))return json({sha:'c'.repeat(40)});
    if(url.includes('/git/refs/')){refs++;return json({});}
    throw new Error('Unexpected fixture request');
  };
  try {
    let res=respond();await save({method:'GET',headers,query:{slug:'first'}},res);
    assert.equal(res.code,200);assert.equal(res.body.catalogSha,catalogSha);
    const unnormalized=oldHtml.replace('</head>',marker({titleZh:'作者標題?',catalogBaseSha:catalogSha})+'</head>');
    res=respond();await save({method:'POST',headers,body:{slug:'first',html:unnormalized,baseSha:articleBlobSha(oldHtml)}},res);
    assert.equal(res.code,400);assert.equal(refs,0);assert.equal(created.length,0);
    for(const stale of [true,false]) {
      const html=oldHtml.replace('</head>',marker({titleZh:'作者標題？',descriptionZh:'中文摘要！',catalogBaseSha:stale?'d'.repeat(40):catalogSha})+'</head>');
      res=respond();await save({method:'POST',headers,body:{slug:'first',html,baseSha:articleBlobSha(oldHtml)}},res);
      assert.equal(res.code,stale?409:200);
      if(stale){assert.equal(refs,0);assert.equal(created.length,0);}
      else {assert.equal(refs,1);assert.equal(readEditorMetadata(created[0]).titleZh,'作者標題？');assert.equal(readEditorMetadata(created[0]).descriptionZh,'中文摘要！');assert.equal(catalogRecords(created[1])[0].values.title,'作者標題？');assert.equal(res.body.catalogSha,articleBlobSha(created[1]));}
    }
    shared=shared.replace("title:'Original'","title:'作者標題？'");
    currentHtml=oldHtml.replace('</head>',marker({titleZh:'作者標題?',catalogBaseSha:catalogSha})+'</head>');
    const recovered=oldHtml.replace('</head>',marker({titleZh:'作者標題？',catalogBaseSha:catalogSha})+'</head>');
    created=[];res=respond();await save({method:'POST',headers,body:{slug:'first',html:recovered,baseSha:articleBlobSha(currentHtml)}},res);
    assert.equal(res.code,200);assert.equal(refs,2);assert.equal(readEditorMetadata(created[0]).titleZh,'作者標題？');
    assert.equal(catalogRecords(created[1])[0].values.title,'作者標題？');
  } finally {
    globalThis.fetch=oldFetch;
    for(const [key,value] of [['GITHUB_TOKEN',oldToken],['ADMIN_PASSWORD',oldPassword]])if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
});

test('title and article are committed atomically; changed catalog or article revisions prevent ref update', async () => {
  const oldFetch = globalThis.fetch, oldToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'fixture';
  const source = "DN.ARTICLES=[{slug:'first',title:'Original',title_en:'Original English',date:'2026-05-01',tag:'Topic'}];";
  const sharedSha = articleBlobSha(source), articleSha='a'.repeat(40);
  let staleArticle=false, created=[], refs=0;
  const json = data => ({ok:true, json:async()=>data});
  globalThis.fetch=async(url, options={})=>{
    url=String(url);
    if(url.includes('/contents/')) return json({content:Buffer.from(source).toString('base64'),sha:url.includes('blog-shared')?sharedSha:staleArticle?'b'.repeat(40):articleSha});
    if(url.includes('/git/ref/'))return json({object:{sha:'base'}});
    if(url.endsWith('/git/commits/base'))return json({tree:{sha:'tree'}});
    if(url.endsWith('/git/blobs')){created.push(JSON.parse(options.body).content);return json({sha:'blob'+created.length});}
    if(url.endsWith('/git/trees'))return json({sha:'new-tree'});
    if(url.endsWith('/git/commits'))return json({sha:'new-commit'});
    if(url.includes('/git/refs/')){refs++;assert.equal(JSON.parse(options.body).force,false);return json({});}
    throw new Error('Unexpected fixture request');
  };
  try {
    const args={slug:'first',content:'author HTML',articleSha,message:'fixture',titleUpdates:{title:"New ' title ];",title_en:'New English'},catalogBaseSha:sharedSha};
    const result=await commitArticleWithModifiedDate(args);
    assert.equal(refs,1);assert.equal(created[0],'author HTML');
    const row=catalogRecords(created[1])[0].values;
    assert.equal(row.title,"New ' title ];");assert.equal(row.title_en,'New English');
    assert.equal(row.date,'2026-05-01');assert.equal(row.tag,'Topic');
    assert.equal(result.catalogSha,articleBlobSha(created[1]));
    await assert.rejects(commitArticleWithModifiedDate({...args,catalogBaseSha:'c'.repeat(40)}),/conflict|changed/i);
    assert.equal(refs,1);
    staleArticle=true;
    await assert.rejects(commitArticleWithModifiedDate(args),/conflict|changed/i);
    assert.equal(refs,1);
  } finally {globalThis.fetch=oldFetch;if(oldToken===undefined)delete process.env.GITHUB_TOKEN;else process.env.GITHUB_TOKEN=oldToken;}
});
