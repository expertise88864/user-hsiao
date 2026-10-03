const {test,expect}=require('@playwright/test');
const {createServer}=require('node:http');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const workerSource=readFileSync(path.join(root,'sw.js'),'utf8');
const shared=readFileSync(path.join(root,'blog/blog-shared.js'),'utf8');
const from=shared.indexOf('  DN.queueOfflineSave = async function');
const to=shared.indexOf('\n  // ---------------------------------------------------------------------',from);
const clientSource=shared.slice(from,to);
test.use({serviceWorkers:'allow'});

// Native MessageChannel + IndexedDB + worker transport on loopback only. Keep
// the real queue functions and source validation, suppress unrelated precache
// and public fetch handlers. Editor UI is covered separately in editor-drafts.
async function fixture(context,mode) {
  let posts=0;
  const wrapper=`const originalAdd=self.addEventListener.bind(self);
    self.addEventListener=(type,fn)=>{if(type==='message'||type==='sync')originalAdd(type,fn);};
    originalAdd('install',()=>self.skipWaiting());
    originalAdd('activate',event=>event.waitUntil(self.clients.claim()));
    ${mode==='storage-abort'?"const originalStoreAdd=IDBObjectStore.prototype.add; IDBObjectStore.prototype.add=function(value){const request=originalStoreAdd.call(this,value);this.transaction.abort();return request;};":''}
    ${workerSource}
    originalAdd('message',event=>{if(event.data==='PROBE_DRAIN')event.waitUntil(drainSaves().then(()=>event.ports[0].postMessage('drained')));});`;
  const server=createServer((req,res)=>{
    if(req.url==='/fixture-worker.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(wrapper);return;}
    if(req.url==='/api/admin/save'&&req.method==='POST'){
      posts++;req.resume();res.writeHead(200,{'Content-Type':'application/json'});
      res.end(mode==='valid'?JSON.stringify({ok:true,sha:'b'.repeat(40),commit:'c'.repeat(40)}):'{invalid JSON');return;
    }
    if(req.method!=='GET'){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':'text/html'});
    res.end(`<html><body><script>var DN={_offlineSaveTokens:{example:{token:'isolated',expiresAt:Date.now()+3600000}}};${clientSource}</script></body></html>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  // Abort any unexpected off-fixture request, including metrics and fonts.
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const page=await context.newPage();
  const open=async()=>{
    await page.goto(origin+'/blog/example?admin=1');
    await page.evaluate(async()=>{
      await navigator.serviceWorker.register('/fixture-worker.js');await navigator.serviceWorker.ready;
      if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
    });
  };
  await open();
  const drain=()=>page.evaluate(()=>new Promise(resolve=>{
    const channel=new MessageChannel();channel.port1.onmessage=()=>{channel.port1.close();resolve();};
    navigator.serviceWorker.controller.postMessage('PROBE_DRAIN',[channel.port2]);
  }));
  const rows=()=>page.evaluate(()=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('hs-bg-sync',1);
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result,tx=db.transaction('queue','readonly'),read=tx.objectStore('queue').getAll();
      read.onsuccess=()=>resolve(read.result);read.onerror=()=>reject(read.error);tx.oncomplete=()=>db.close();
    };
  }));
  return {page,open,drain,rows,posts:()=>posts,close:async()=>{await page.close();await new Promise(resolve=>server.close(resolve));}};
}

for(const mode of ['valid','invalid-receipt','storage-abort']) test(`native offline queue retains ambiguous receipts and acknowledges transactions: ${mode}`,async({context})=>{
  const f=await fixture(context,mode);
  try {
    const html='<html>'+ 'Author bilingual snapshot '.repeat(20)+'</html>';
    const queued=await f.page.evaluate(html=>DN.queueOfflineSave('example',html,'a'.repeat(40)),html);
    expect(queued).toBe(mode!=='storage-abort');await f.drain();
    if(mode==='storage-abort'){expect(await f.rows()).toEqual([]);expect(f.posts()).toBe(0);return;}
    expect(f.posts()).toBe(1);
    if(mode==='valid'){expect(await f.rows()).toEqual([]);return;}
    const before=await f.rows();expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({html,baseSha:'a'.repeat(40),receiptUnconfirmed:true});
    await f.open();await f.drain();expect(await f.rows()).toEqual(before);expect(f.posts()).toBe(1);
  } finally {await f.close();}
});
