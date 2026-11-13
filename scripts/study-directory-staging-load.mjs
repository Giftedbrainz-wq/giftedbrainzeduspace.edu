/* STAGING-ONLY concurrency probe; never run against production or real users.
 * Measures only HTTP request latency, NOT WebSocket notification delivery.
 */
const base=String(process.env.GB_STUDY_STAGING_URL||'').replace(/\/+$/,'');
const host=(()=>{try{return new URL(base).hostname}catch{return ''}})();
if(!/^https:\/\//.test(base)||!/staging|preview|localhost|test/i.test(host))
 throw Error('Refusing to run against a non-staging HTTPS host.');
const tokens=JSON.parse(process.env.GB_STUDY_TEST_TOKENS||'[]');
if(!Array.isArray(tokens)||tokens.length<2||tokens.some(t=>!t||typeof t!=='string'))throw Error('Provide 2+ test-user tokens in GB_STUDY_TEST_TOKENS.');
const rounds=Math.min(15,Math.max(1,Number(process.env.GB_STUDY_TEST_ROUNDS||5)));
const latencies=[],failed=[];let running=0,maximum=0;
async function run(token,path){
 const start=performance.now();running++;maximum=Math.max(maximum,running);
 try{
  const res=await fetch(base+path,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
  const ms=performance.now()-start;latencies.push(ms);
  if(!res.ok)failed.push({path,status:res.status,delayMs:Math.round(ms)});
 }catch(e){failed.push({path,error:String(e.message||e)});}finally{running--;}
}
for(let round=0;round<rounds;round++)await Promise.all(tokens.map((token,i)=>run(token,i%2?'/api/learning/partners':'/api/learning/partners/explore?offset=0')));
latencies.sort((a,b)=>a-b);const q=p=>Math.round(latencies[Math.min(latencies.length-1,Math.max(0,Math.ceil(p*latencies.length)-1))]||0);
console.log(JSON.stringify({environment:'STAGING ONLY',requests:latencies.length,failed:failed.length,
 concurrentUsers:tokens.length,peakRequests:maximum,p50Ms:q(.5),p95Ms:q(.95),p99Ms:q(.99),examples:failed.slice(0,5)},null,2));
if(failed.length)process.exitCode=1;
