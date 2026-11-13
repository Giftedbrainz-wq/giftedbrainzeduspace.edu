import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('client coalesces identical reads, memoises catalogues briefly, invalidates on mutation',async()=>{
  const calls=[];const handlers={};const entries=new Map([['gbToken','student-session-A']]);
  const storage={getItem:k=>entries.get(k)||null,setItem:(k,v)=>entries.set(k,String(v)),removeItem:k=>entries.delete(k)};
  const fetch=async(url,options={})=>{
    calls.push({url,method:options.method||'GET'});
    return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({url,call:calls.length})};
  };
  const window={addEventListener:(name,fn)=>{handlers[name]=fn}};
  vm.runInNewContext(source('public/api.js'),{window,localStorage:storage,sessionStorage:storage,fetch,
    AbortController,structuredClone,setTimeout,clearTimeout,location:{pathname:'/videos.html'}});
  const api=window.GB.api;
  const [first,second]=await Promise.all([api('/api/videos'),api('/api/videos')]);
  assert.equal(calls.length,1,'identical in-flight GETs must share one network request');
  assert.deepEqual({...first},{...second});
  await api('/api/videos');assert.equal(calls.length,1,'short memo prevents repeat catalogue read');
  await api('/api/learning/partners');await api('/api/learning/partners');
  assert.equal(calls.length,3,'live partner data must not be memoised');
  await api('/api/progress',{method:'POST',body:'{}'});
  await api('/api/videos');assert.equal(calls.length,5,'mutation must clear previous catalogue memo');
  entries.set('gbToken','student-session-B');
  await api('/api/videos');assert.equal(calls.length,6,'cache key must include user session');
  handlers.storage?.({key:'gbToken'});
  await api('/api/videos');assert.equal(calls.length,7,'cross-tab session change clears cached responses');
});

test('learning centre boots from one server endpoint, without six initial data requests',()=>{
  const client=source('public/learning-centre.js'),core=source('node-functions/lib/api-core.js');
  assert.match(client,/const \{overview,mistakes,plans,saved,badges,resources\}=await api\('bootstrap'\)/);
  assert.doesNotMatch(client,/Promise\.all\(\['overview','mistakes','plans','saved','badges','resources'\]/);
  assert.match(core,/p==="\/api\/learning\/bootstrap"/);
  assert.match(core,/d\.learningMistakes\.filter\(x=>x\.userId===uid\)/);
  assert.match(core,/d\.learningSaved\.filter\(x=>x\.userId===uid\)/);
});

test('SW only intercepts same-origin static files and excludes private API, images remain proper YouTube thumbnails',()=>{
  const sw=source('public/sw.js'),videos=source('public/videos.html');
  assert.match(sw,/u\.origin!==self\.location\.origin/);
  assert.match(sw,/u\.pathname\.startsWith\("\/api\/"/);
  assert.match(sw,/const cacheKey=isStatic\?new Request\(u\.origin\+u\.pathname\)/);
  assert.match(sw,/if\(isStatic&&usable\(cached\)\)/);
  assert.match(sw,/length:Math\.min\(6,files\.length\)/);
  assert.match(videos,/i\.ytimg\.com\/vi\//);
  assert.match(videos,/loading="\$\{index<4\?"eager":"lazy"\}"/);
  assert.doesNotMatch(videos,/subject-cover|assets\/battle\/crown\.png/);
});

test('dashboard and account screen avoid serialized initial requests; progress feedback optimistically updates',()=>{
  const dashboard=source('public/dashboard.html'),account=source('public/account.html'),progress=source('public/progress.html'),core=source('node-functions/lib/api-core.js');
  assert.match(dashboard,/Promise\.resolve\(d\.learningPlans\|\|\[\]\)/);
  assert.match(core,/learningPlans: d\.learningPlans\.filter\(x=>x\.userId===u\.id\)/);
  assert.match(account,/Promise\.all\(\[GB\.api\("\/api\/dashboard"\),GB\.api\("\/api\/subjects\/catalog"\)\]\)/);
  assert.match(progress,/topic\.completed=desired;recalculateLocalProgress\(\);render\(\)/);
  assert.match(progress,/topic\.completed=previous;recalculateLocalProgress\(\)/);
});
