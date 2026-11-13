import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const pub=new URL('../public/',import.meta.url);
const get=p=>fs.readFileSync(new URL('../'+p,import.meta.url));
const pngSignature=Buffer.from([137,80,78,71,13,10,26,10]);

test('all published older-style team badges and student avatars are real PNG files',()=>{
  for(let i=1;i<=24;i++){
    const p=`assets/avatars/scholar-${String(i).padStart(2,'0')}.png`;
    assert.equal(get(p).subarray(0,8).compare(pngSignature),0,p);
    assert.deepEqual(get('public/'+p),get(p),'published avatar differs from source: '+p);
  }
  const logos=fs.readdirSync(new URL('../assets/battle/',import.meta.url)).filter(x=>x.endsWith('.png'));
  assert.equal(logos.length,24,'expected exactly 24 selectable badges');
  for(const file of logos){
    const path='assets/battle/'+file;
    assert.equal(get(path).subarray(0,8).compare(pngSignature),0,path);
    assert.deepEqual(get('public/'+path),get(path),'published badge differs: '+path);
  }
});

test('CBT subject icons do not use team logos; Battle Arena graphics retain their PNGs',()=>{
  const cbt=get('public/cbt.html').toString();
  const battle=get('public/battle.js').toString();
  assert.match(cbt,/cbt-cover-icon.*\$\{icon\}/);
  assert.doesNotMatch(cbt,/assets\/battle\/|subject-cover\/\$\{subjectArt/);
  assert.match(battle,/assets\/battle\/\$\{encodeURIComponent\(name/);
  assert.match(battle,/\}\.png/);
  for(const name of ['mathematics','english','physics','chemistry','biology','general']){
    assert.equal(get('public/assets/subject-cover/'+name+'.png').subarray(0,8).compare(pngSignature),0);
  }
});

test('service worker refuses HTML fallback when loading missing image or script',async()=>{
  const events={};
  const context={
    URL,Response,Request,
    self:{location:{href:'https://eduspace.test/sw.js?v=12.9.0',origin:'https://eduspace.test'},addEventListener:(type,handler)=>events[type]=handler},
    caches:{open:async()=>({match:async()=>null,put:async()=>{}}),match:async()=>null},
    fetch:async()=>new Response('<!doctype html><html>Wrong fallback</html>',{status:200,headers:{'Content-Type':'text/html; charset=utf-8'}}),
    Promise,Date,Math,console
  };
  vm.runInNewContext(get('public/sw.js').toString(),context);
  assert.equal(typeof events.fetch,'function');
  for(const link of ['/assets/battle/lion.png','/assets/avatars/scholar-01.png','/assets/subject-cover/chemistry.png','/battle.js']){
    let response;
    events.fetch({request:new Request('https://eduspace.test'+link),respondWith:p=>response=p});
    const result=await response;
    assert.equal(result.status,404,'missing static asset should fail rather than display HTML: '+link);
    assert.doesNotMatch(result.headers.get('content-type')||'',/text\/html/i);
    assert.doesNotMatch(await result.text(),/<html|<!doctype/i);
  }
});
