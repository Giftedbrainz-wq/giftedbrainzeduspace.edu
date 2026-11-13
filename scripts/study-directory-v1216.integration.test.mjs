import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'edu-directory-cutover-'));
Object.assign(process.env,{
 GB_DATA_DIR:root,GB_ALLOW_LOCAL_STORE:'true',AUTH_SECRET:'cutover-test-hmac-secret-abcdefghijklmnopqrstuvwxyz',
 GB_CHAT_BACKEND:'supabase',GB_CHAT_SUPABASE_URL:'https://cutover-mocked.supabase.co',
 GB_CHAT_SUPABASE_SECRET:'cutover-test-secret-service-abcdefghijklmnopqrstuvwxyz',
 GB_STUDY_DIRECTORY_BACKEND:'supabase',GB_STUDY_DIRECTORY_CUTOVER_APPROVED:'true',
 GB_CHAT_REALTIME_ENABLED:'false'
});
const students=Array.from({length:4},(_,i)=>({id:'s'+i,name:'Student '+i,username:'student'+i,email:`s${i}@test.invalid`,status:'active',approval:'approved',approved:true,tokenVersion:1,selectedSubjects:['Use of English']}));
const snapshot={users:students,learningPartners:[],learningBlocks:[],settings:{contentPackVersion:'2026.08.16-content-7-final',adminCredentialsVersion:2,tokenVersion:1}};
const file=path.join(root,crypto.createHash('sha256').update('data').digest('hex')+'.bin');
await fs.writeFile(file,JSON.stringify(snapshot));
const studentsDb=new Map(students.map(s=>[s.id,{id:s.id,display_name:s.name,username:s.username,status:s.status,avatar:'',last_seen_at:0}]));
const relationships=[];const blocks=[];const messages=[];
let failure=false;
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const now=()=>new Date().toISOString();
const pairKey=(a,b)=>[a,b].sort().join(':');
globalThis.fetch=async(input,opt={})=>{
 const u=new URL(input);const op=u.pathname.split('/').at(-1);const data=opt.body?JSON.parse(opt.body):{};
 if(!u.origin.startsWith('https://cutover-mocked.supabase.co'))throw Error('Unexpected external fetch');
 if(failure)return reply({code:'PGRST205',message:'SQL unavailable'},503);
 if(op==='gb_study_partner_mutate'){
  const {p_action:action,p_actor:actor,p_other:other,p_id:id,p_accept:accept}=data;
  if(action==='request'){
   if(blocks.some(b=>pairKey(b.from_id,b.to_id)===pairKey(actor,other)))return reply({code:'42501',message:'blocked'},400);
   if(relationships.some(r=>pairKey(r.from_id,r.to_id)===pairKey(actor,other)))return reply({code:'23505',message:'duplicate'},409);
   const r={id:crypto.randomUUID(),from_id:actor,to_id:other,status:'pending',created_at:now(),updated_at:now()};relationships.push(r);
   return reply({id:r.id,from:r.from_id,to:r.to_id,status:r.status,createdAt:r.created_at,updatedAt:r.updated_at});
  }
  if(action==='block'){
   blocks.push({from_id:actor,to_id:other});
   for(let i=relationships.length-1;i>=0;i--)if(pairKey(relationships[i].from_id,relationships[i].to_id)===pairKey(actor,other))relationships.splice(i,1);
   return reply({ok:true});
  }
  const r=relationships.find(v=>v.id===id);
  if(!r)return reply({code:'P0002',message:'not found'},404);
  if(action==='respond'){
   if(r.to_id!==actor||r.status!=='pending')return reply({code:'42501',message:'not recipient'},403);
   r.status=accept?'accepted':'declined';r.updated_at=now();
   return reply({id:r.id,from:r.from_id,to:r.to_id,status:r.status,createdAt:r.created_at,updatedAt:r.updated_at});
  }
  if(action==='remove'){
   if(![r.from_id,r.to_id].includes(actor))return reply({code:'42501',message:'not participant'},403);
   relationships.splice(relationships.indexOf(r),1);
   return reply({id:r.id,from:r.from_id,to:r.to_id,status:r.status,createdAt:r.created_at,updatedAt:r.updated_at});
  }
 }
 if(op==='gb_study_partnerships'){
  const match=(u.searchParams.get('or')||'').match(/from_id\.eq\.([^,]+),to_id\.eq\.([^\)]+)/);
  const actor=match?.[1];return reply(relationships.filter(r=>r.from_id===actor||r.to_id===actor));
 }
 if(op==='gb_study_blocks'){
  const match=(u.searchParams.get('or')||'').match(/from_id\.eq\.([^,]+),to_id\.eq\.([^\)]+)/);
  const actor=match?.[1];return reply(blocks.filter(r=>r.from_id===actor||r.to_id===actor));
 }
 if(op==='gb_study_student_search'){
  const q=String(data.p_query||'').toLowerCase();const actor=data.p_actor;
  const found=[...studentsDb.values()].filter(s=>s.id!==actor&&s.status==='active'&&
    (!q||[s.display_name,s.username].some(v=>v.toLowerCase().includes(q)))&&
    !blocks.some(b=>pairKey(b.from_id,b.to_id)===pairKey(actor,s.id)))
    .map(s=>({id:s.id,name:s.display_name,username:s.username,avatar:s.avatar,online:false}));
  const offset=data.p_offset||0,limit=data.p_limit||40;
  return reply({students:found.slice(offset,offset+limit),total:found.length,hasMore:offset+limit<found.length});
 }
 if(op==='gb_study_touch_student')return reply(null);
 if(op==='gb_study_students'){
  if(opt.method==='POST')for(const s of data)studentsDb.set(s.id,{...studentsDb.get(s.id),...s});
  return opt.method==='POST'?new Response(null,{status:201}):reply([...studentsDb.values()]);
 }
 if(op==='gb_study_deliver')return reply({ok:true});
 if(op==='gb_study_inbox')return reply([]);
 if(op==='gb_study_messages')return reply([]);
 if(op==='gb_study_send'){
  messages.push(data);return reply({id:crypto.randomUUID(),from:data.p_sender,to:data.p_recipient,text:data.p_text,createdAt:now(),reactions:[]});
 }
 throw Error('Unknown SQL operation: '+op);
};
const {default:handler,runWithContext}=await import('../node-functions/lib/api-core.js');
const token=id=>{const body=Buffer.from(JSON.stringify({sub:id,role:'student',v:1,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');return body+'.'+crypto.createHmac('sha256',process.env.AUTH_SECRET).update(body).digest('base64url');};
async function req(uri,{as='s0',method='GET',data}={}){
 const request=new Request('https://staging.test'+uri,{method,headers:{authorization:'Bearer '+token(as),...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
 const res=await runWithContext({request,env:process.env},()=>handler(request));
 return {status:res.status,data:await res.json()};
}
const post=(uri,data,as='s0')=>req(uri,{method:'POST',data,as});
let id;
test('directory SQL flag is guarded and fails closed when cutover is not approved',async()=>{
 process.env.GB_STUDY_DIRECTORY_CUTOVER_APPROVED='false';
 const resp=await req('/api/learning/partners');assert.equal(resp.status,503);
 process.env.GB_STUDY_DIRECTORY_CUTOVER_APPROVED='true';
});
test('Explore Students uses SQL paging and cannot list self',async()=>{
 const r=await req('/api/learning/partners/explore');
 assert.equal(r.status,200);assert.equal(r.data.total,3);assert.ok(r.data.students.every(s=>s.id!=='s0'));
 assert.ok(!JSON.stringify(r.data).includes('email'));
});
test('one-sided requests persist in SQL, never rewrite the shared partnership Blob',async()=>{
 const r=await post('/api/learning/partners/request',{userId:'s1'});
 assert.equal(r.status,201,JSON.stringify(r));id=r.data.id;
 const duplicate=await post('/api/learning/partners/request',{userId:'s0'},'s1');assert.equal(duplicate.status,409);
 const disk=JSON.parse(await fs.readFile(file,'utf8'));
 assert.equal(disk.learningPartners.length,0,'transactional relationships should not be persisted in Blob');
});
test('only the recipient can accept, then both participants have message access',async()=>{
 const bad=await post(`/api/learning/partners/${id}/respond`,{accept:true});assert.equal(bad.status,404);
 const ok=await post(`/api/learning/partners/${id}/respond`,{accept:true},'s1');assert.equal(ok.status,200);
 const peers=await req('/api/learning/partners',{as:'s1'});
 assert.equal(peers.data[0].status,'accepted');
 assert.equal((await post('/api/learning/partners/messages',{to:'s1',text:'Study chat works'})).status,201);
 assert.equal((await post('/api/learning/partners/messages',{to:'s1',text:'Intrusion'},'s2')).status,403);
});
test('transactional blocking revokes relationship and student discovery access',async()=>{
 const blocked=await post('/api/learning/partners/block',{userId:'s1'});
 assert.equal(blocked.status,200,JSON.stringify(blocked));
 assert.equal((await post('/api/learning/partners/messages',{to:'s1',text:'Not allowed'})).status,403);
 const search=await req('/api/learning/partners/search?q=student1');
 assert.equal(search.status,200);assert.equal(search.data.length,0);
 assert.equal(relationships.length,0);
});
test('SQL outages never silently revert authorisation to stale Blob data',async()=>{
 failure=true;
 const response=await req('/api/learning/partners');
 assert.ok(response.status>=500);
 failure=false;
});
