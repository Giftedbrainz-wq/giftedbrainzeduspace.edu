/* Staging read-only smoke. Never send real student credentials to this tool. */
const base=String(process.env.GB_STUDY_STAGING_URL||'').replace(/\/+$/,'');
const hostname=(()=>{try{return new URL(base).hostname}catch{return ''}})();
if(!/^https:\/\//.test(base)||!/staging|preview|localhost|test/i.test(hostname))
 throw Error('Refusing a non-staging host.');
const tokens=JSON.parse(process.env.GB_STUDY_TEST_TOKENS||'[]');
if(!Array.isArray(tokens)||tokens.length<2||tokens.length>100||tokens.some(t=>!t||typeof t!=='string'))
 throw Error('Provide 2-100 staging-account access tokens in GB_STUDY_TEST_TOKENS.');
const rounds=Math.min(20,Math.max(1,Number(process.env.GB_STUDY_TEST_ROUNDS||5)));
const timings=[],failures=[];
for(let round=0;round<rounds;round++)await Promise.all(tokens.map(async(token,i)=>{
 const start=performance.now();const uri=i%2?'/api/learning/communities?mine=1':'/api/learning/communities?q=study';
 try{
  const res=await fetch(base+uri,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
  const ms=performance.now()-start;timings.push(ms);
  if(!res.ok)failures.push({status:res.status,ms:Math.round(ms),uri});
 }catch(e){failures.push({error:String(e.message||e),uri});}
}));
timings.sort((a,b)=>a-b);const pct=p=>Math.round(timings[Math.max(0,Math.min(timings.length-1,Math.ceil(timings.length*p)-1))]||0);
console.log(JSON.stringify({environment:'STAGING ONLY',requests:timings.length,concurrentTestAccounts:tokens.length,
 errors:failures.length,p50Ms:pct(.5),p95Ms:pct(.95),p99Ms:pct(.99),examples:failures.slice(0,3)},null,2));
if(failures.length)process.exitCode=1;
