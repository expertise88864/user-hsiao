import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { MessageChannel } from 'node:worker_threads';

const sw = await readFile(new URL('../../sw.js', import.meta.url), 'utf8');
const shared = await readFile(new URL('../../blog/blog-shared.js', import.meta.url), 'utf8');
const sha = 'a'.repeat(40);
const valid = {ok:true,sha:'b'.repeat(40),commit:'c'.repeat(40)};
function worker(overrides={}) {
  const listeners = {};
  const context = {URL, self:{location:{origin:'https://hsiao.chendermatologist.com'},
    addEventListener:(type,fn)=>{listeners[type]=fn;}, clients:{matchAll:async()=>[]}}, ...overrides};
  runInNewContext(sw,context);
  return {context,listeners};
}

for(const receipt of [null,{ok:true},{...valid,commit:'invalid'},{...valid,commit:''}]) {
  test('ambiguous replay receipt retains snapshot and does not repeat POST: '+JSON.stringify(receipt),async()=>{
    const {context}=worker();
    const item={id:1,slug:'example',html:'author snapshot',baseSha:sha};
    const deleted=[],messages=[];let posts=0;
    context.readQueuedSaves=async()=>[item];
    context.deleteQueuedSave=async id=>deleted.push(id);
    context.markReplayUnconfirmed=async id=>{assert.equal(id,1);item.receiptUnconfirmed=true;};
    context.self.clients.matchAll=async()=>[{postMessage:msg=>messages.push(msg)}];
    context.fetch=async()=>{posts++;return {ok:true,json:async()=>{if(receipt===null)throw Error('isolated invalid JSON');return receipt;}};};
    await context.drainSavesOnce();await context.drainSavesOnce();
    assert.equal(posts,1);assert.deepEqual(deleted,[]);
    assert.equal(messages[0].type,'BG_SYNC_UNCONFIRMED');assert.equal(messages[0].slug,'example');
  });
}
for(const receipt of [valid,{...valid,commit:'',noop:true}]) test('valid replay receipt deletes only acknowledged snapshot: '+JSON.stringify(receipt),async()=>{
  const {context}=worker();const deleted=[],messages=[];
  context.readQueuedSaves=async()=>[{id:7,slug:'example',baseSha:sha}];
  context.deleteQueuedSave=async id=>deleted.push(id);
  context.fetch=async()=>({ok:true,json:async()=>receipt});
  context.self.clients.matchAll=async()=>[{postMessage:msg=>messages.push(msg)}];
  await context.drainSavesOnce();assert.deepEqual(deleted,[7]);assert.equal(messages[0].type,'BG_SYNC_REPLAYED');
});

test('worker queue receipt waits for committed storage and rejects failed/invalid queue requests',async()=>{
  const {context,listeners}=worker();const replies=[];let release,task;
  context.enqueueSave=()=>new Promise(resolve=>{release=resolve;});
  context.drainSaves=async()=>{};
  const event={data:{type:'QUEUE_SAVE',payload:{slug:'example',html:'x'.repeat(250),baseSha:sha,token:'isolated'}},
    source:{url:'https://hsiao.chendermatologist.com/blog/example?admin=1'},
    ports:[{postMessage:msg=>replies.push(msg),close:()=>{}}],waitUntil:promise=>{task=promise;}};
  listeners.message(event);assert.deepEqual(replies,[]);release();await task;assert.equal(replies[0].queued,true);
  context.enqueueSave=async()=>{throw Error('isolated storage full');};
  replies.length=0;listeners.message(event);await task;assert.equal(replies[0].queued,false);
  let writes=0;context.enqueueSave=async()=>{writes++;};
  event.source.url='https://hsiao.chendermatologist.com/blog/other?admin=1';
  replies.length=0;listeners.message(event);await task;assert.equal(replies[0].queued,false);assert.equal(writes,0);
});

test('marking ambiguous replay never resurrects a snapshot replaced during POST',async()=>{
  const {context}=worker();const puts=[];let request,tx;
  context.openSyncDb=async()=>({transaction:()=>{tx={objectStore:()=>({get:()=>{request={};return request;},put:v=>puts.push(v)})};return tx;}});
  const marked=context.markReplayUnconfirmed(7);await new Promise(resolve=>setImmediate(resolve));
  request.result=undefined;request.onsuccess();tx.oncomplete();await marked;assert.deepEqual(puts,[]);
});

test('failed ambiguity-marker storage retains data, notifies the editor and stops retries in this worker',async()=>{
  const {context}=worker();const messages=[],deleted=[];let posts=0;
  context.readQueuedSaves=async()=>[{id:7,slug:'example',html:'retained author snapshot',baseSha:sha}];
  context.markReplayUnconfirmed=async()=>{throw Error('isolated storage abort');};
  context.deleteQueuedSave=async id=>deleted.push(id);
  context.self.clients.matchAll=async()=>[{postMessage:msg=>messages.push(msg)}];
  context.fetch=async()=>{posts++;return {ok:true,json:async()=>({ok:true})};};
  await context.drainSavesOnce();await context.drainSavesOnce();
  assert.equal(posts,1);assert.deepEqual(deleted,[]);assert.equal(messages[0].type,'BG_SYNC_UNCONFIRMED');
});

for(const reply of ['accepted','rejected','timeout','post-failed']) test('client reports queue persistence only after worker receipt: '+reply,async()=>{
  const from=shared.indexOf('  DN.queueOfflineSave = async function'),to=shared.indexOf('\n  // ---------------------------------------------------------------------',from);
  assert.ok(from>=0&&to>from);
  let port,registrations=0;
  const context={MessageChannel,Date,setTimeout:(fn,ms)=>setTimeout(fn,reply==='timeout'?10:ms),clearTimeout,
    DN:{_offlineSaveTokens:{example:{token:'isolated',expiresAt:Date.now()+3600000}}},
    navigator:{serviceWorker:{controller:{postMessage:(message,ports)=>{if(reply==='post-failed')throw Error('isolated disconnected worker');port=ports[0];}},ready:Promise.resolve({sync:{register:async()=>{registrations++;}}})}}};
  runInNewContext(shared.slice(from,to),context);
  let settled=false;const result=context.DN.queueOfflineSave('example','author snapshot',sha).then(value=>{settled=true;return value;});
  await new Promise(resolve=>setImmediate(resolve));if(reply!=='post-failed')assert.equal(settled,false);
  if(reply==='accepted'||reply==='rejected')port.postMessage({queued:reply==='accepted'});
  assert.equal(await result,reply==='accepted');await Promise.resolve();assert.equal(registrations,reply==='accepted'?1:0);
});
