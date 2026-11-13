/**
 * Explicitly authorised STAGING-ONLY latency probe for Brainz Battle Arena.
 * Usage: node scripts/battle-activity-benchmark.mjs https://staging.example.com players.json 12 --confirm-staging
 * players.json: [{"token":"...","roomId":"<existing staging match UUID>"},...]
 * The probe sends chats; use disposable test accounts/rooms. Never run on production.
 * No tokens/messages are written to the report; run with 2–20 test accounts.
 */
import fs from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
const [base,file,countRaw='12',confirmation]=process.argv.slice(2);
if(!base||!file||confirmation!=='--confirm-staging'){
 console.error('Usage: node scripts/battle-activity-benchmark.mjs https://staging.example.com players.json [ITERATIONS] --confirm-staging');
 process.exit(2);
}
const target=new URL(base);
const safe=target.hostname==='localhost'||target.hostname==='127.0.0.1'||/^staging[.-]/i.test(target.hostname)||/[-.]staging[.-]/i.test(target.hostname);
if(!safe||!(target.protocol==='https:'||safe&&target.protocol==='http:'))throw Error('Refusing to benchmark a non-staging host.');
const players=JSON.parse(await fs.readFile(file,'utf8'));
if(!Array.isArray(players)||players.length<2||players.length>20||players.some(p=>typeof p.token!=='string'||!/^[a-f0-9-]{30,40}$/i.test(p.roomId||'')))throw Error('Use 2–20 valid staging account token/roomId pairs.');
const count=Math.min(30,Math.max(1,Number(countRaw)||12));
const samples={room:[],chat:[]};let failures=0;
async function request(player,method,route,body){
 const started=performance.now(),controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
 try{
  const response=await fetch(new URL(route,target),{method,headers:{authorization:'Bearer '+player.token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal});
  await response.arrayBuffer();const ms=performance.now()-started;
  samples[method==='POST'?'chat':'room'].push(ms);
  if(!response.ok)failures++;
 }catch{failures++;}finally{clearTimeout(timeout);}
}
for(let i=0;i<count;i++){
 const player=players[i%players.length];
 const route='/api/battle/rooms/'+encodeURIComponent(player.roomId);
 await Promise.all([request(player,'GET',route),request(player,'POST',route+'/chat',{text:`Staging-only performance check ${i+1}`})]);
}
const percentiles=a=>{if(!a.length)return {};a.sort((a,b)=>a-b);return {count:a.length,medianMs:Math.round(a[Math.floor((a.length-1)*.5)]),p95Ms:Math.round(a[Math.ceil(a.length*.95)-1]),maxMs:Math.round(a.at(-1))};};
console.log(JSON.stringify({stagingHost:target.hostname,participants:players.length,failures,room:percentiles(samples.room),chat:percentiles(samples.chat)},null,2));
if(failures)process.exitCode=1;
