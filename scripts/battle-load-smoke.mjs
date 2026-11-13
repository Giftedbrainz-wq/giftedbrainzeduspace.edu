/**
 * Staging-only, read-only multiplayer load probe.
 * Create a local JSON array of [{"token":"<student bearer token>","roomId":"<room id>"}]
 * with up to 600 different approved players, each in the indicated room.
 * The script never writes tokens to reports or sends match answers.
 *
 * Example: node scripts/battle-load-smoke.mjs https://staging.example.com players.json 30
 */
import fs from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
const [base,file,secondsArg='30']=process.argv.slice(2);
if(!base||!file){console.error('Usage: node scripts/battle-load-smoke.mjs STAGING_BASE_URL STAGING_PLAYER_TOKENS_JSON [SECONDS]');process.exit(2);}
const url=new URL(base);if(url.protocol!=='https:'&&url.hostname!=='localhost'&&url.hostname!=='127.0.0.1')throw Error('Use HTTPS or local staging only.');
const players=JSON.parse(await fs.readFile(file,'utf8'));
if(!Array.isArray(players)||players.length<1||players.length>600||players.some(p=>typeof p.token!=='string'||typeof p.roomId!=='string'||!/^[a-f\d-]{20,50}$/i.test(p.roomId)))throw Error('Provide 1–600 valid staging-player token/roomId pairs.');
const duration=Math.max(5,Math.min(120,Number(secondsArg)||30))*1000;
let attempts=0,good=0,non2xx=0,errors=0,maxInFlight=0,inFlight=0;const latency=[];
const until=performance.now()+duration;
async function simulatedPlayer({token,roomId}){
  while(performance.now()<until){
    const t=performance.now();attempts++;inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);
    try{
      const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),12000);
      try{const r=await fetch(new URL('/api/battle/rooms/'+encodeURIComponent(roomId),url),{headers:{authorization:'Bearer '+token},signal:controller.signal});if(r.ok)good++;else non2xx++;await r.arrayBuffer();}finally{clearTimeout(timeout);}
    }catch{errors++;}finally{latency.push(performance.now()-t);inFlight--;}
    // Simulate students watching match rooms and fetching a fresh state every five seconds.
    const delay=Math.max(0,5000-(performance.now()-t));if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
  }
}
const begin=performance.now();await Promise.all(players.map(simulatedPlayer));
const elapsed=(performance.now()-begin)/1000;latency.sort((a,b)=>a-b);
const nth=p=>latency.length?Math.round(latency[Math.min(latency.length-1,Math.ceil(latency.length*p)-1)]):0;
const summary={simulatedPlayers:players.length,elapsedSeconds:Math.round(elapsed*10)/10,requests:attempts,ok:good,non2xx,networkErrors:errors,requestsPerSecond:Math.round(attempts/elapsed*10)/10,maxInFlight,medianMs:nth(.5),p95Ms:nth(.95),p99Ms:nth(.99)};
console.log(JSON.stringify(summary,null,2));
if(non2xx||errors)process.exitCode=1;
