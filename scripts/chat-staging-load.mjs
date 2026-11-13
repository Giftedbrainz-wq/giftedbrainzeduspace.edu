/* Explicit staging-only smoke harness. Do not run against production.
 * Usage: GB_CHAT_STAGING_URL=https://staging.example.com \
 *   GB_CHAT_TEST_TOKENS='["token-for-a","token-for-b"]' \
 *   node scripts/chat-staging-load.mjs
 * Ensure the test students are already accepted study partners.
 */
const base=String(process.env.GB_CHAT_STAGING_URL||'').replace(/\/+$/,'');
const tokens=JSON.parse(process.env.GB_CHAT_TEST_TOKENS||'[]');
if(!/^https:\/\//.test(base)||!/staging|preview|localhost|127\.0\.0\.1|test/i.test(new URL(base).hostname)){
 console.error('Refusing load test: provide an explicit HTTPS staging/preview URL, never production.');process.exit(1);
}
if(!Array.isArray(tokens)||tokens.length<2){console.error('Provide two or more staging student tokens (already accepted partners).');process.exit(1)}
const pairs=Math.floor(tokens.length/2);
const rounds=Math.min(30,Math.max(1,Number(process.env.GB_CHAT_STAGING_ROUNDS||5)));
const times=[],errors=[],statuses=new Set();
async function call(from,peer,text){
 const started=performance.now();const result=await fetch(base+'/api/learning/partners/messages',{
  method:'POST',headers:{authorization:'Bearer '+tokens[from],'content-type':'application/json'},
  body:JSON.stringify({to:peer,text,clientId:crypto.randomUUID()})
 });const delay=performance.now()-started;times.push(delay);statuses.add(result.status);
 if(!result.ok)errors.push({status:result.status,body:(await result.text()).slice(0,160)});
}
// Student IDs are supplied separately from login tokens; never embed real IDs.
const ids=JSON.parse(process.env.GB_CHAT_TEST_USER_IDS||'[]');
if(ids.length<tokens.length)throw Error('Provide GB_CHAT_TEST_USER_IDS in the same order as tokens.');
for(let i=0;i<rounds;i++){
 const work=Array.from({length:pairs},(_,j)=>call(j*2,ids[j*2+1],`Infrastructure load test ${i+1}/${rounds}`));
 await Promise.all(work);
}
times.sort((a,b)=>a-b);const percentile=q=>Math.round(times[Math.min(times.length-1,Math.ceil(q*times.length)-1)]||0);
console.log(JSON.stringify({environment:'staging only',requests:times.length,failures:errors.length,httpStatuses:[...statuses],p50Ms:percentile(.5),p95Ms:percentile(.95),p99Ms:percentile(.99),samples:errors.slice(0,4)},null,2));
if(errors.length)process.exitCode=1;
