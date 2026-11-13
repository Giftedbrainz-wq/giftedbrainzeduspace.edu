import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'edu-community-cutover-'));
Object.assign(process.env,{GB_DATA_DIR:root,GB_ALLOW_LOCAL_STORE:'true',
 AUTH_SECRET:'community-test-hmac-secret-abcdefghijklmnopqrstuvwxyz',
 GB_CHAT_BACKEND:'supabase',GB_CHAT_SUPABASE_URL:'https://mock-community.supabase.co',
 GB_CHAT_SUPABASE_SECRET:'community-test-service-abcdefghijklmnopqrstuvwxyz',
 GB_STUDY_COMMUNITY_BACKEND:'supabase',GB_STUDY_COMMUNITY_CUTOVER_APPROVED:'true',
 GB_STUDY_DIRECTORY_BACKEND:'supabase',GB_STUDY_DIRECTORY_CUTOVER_APPROVED:'true',GB_CHAT_REALTIME_ENABLED:'false'});
const users=Array.from({length:3},(_,i)=>({id:'u'+i,name:'Student '+i,username:'student'+i,
 email:`u${i}@test.invalid`,status:'active',approval:'approved',approved:true,
 tokenVersion:1,selectedSubjects:['Use of English']}));
const original={users,learningCommunities:[],learningCommunityMessages:[],settings:{tokenVersion:1}};
const filename=path.join(root,crypto.createHash('sha256').update('data').digest('hex')+'.bin');
await fs.writeFile(filename,JSON.stringify(original));
const communities=new Map();
let outage=false;
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
globalThis.fetch=async(input,opt={})=>{
 const url=new URL(input),name=url.pathname.split('/').at(-1),data=opt.body?JSON.parse(opt.body):{};
 if(url.origin!=='https://mock-community.supabase.co')throw Error('Unexpected external fetch');
 if(outage)return reply({code:'PGRST205',message:'Database unavailable'},503);
 if(name==='gb_study_community_mutate'){
  const {p_action:action,p_actor:actor,p_community:id,p_target:target,p_accept:accept,p_payload:payload}=data;
  if(action==='create'){
   const id='a'+crypto.randomUUID();communities.set(id,{id,name:payload.name,
    description:payload.description,subject:payload.subject,visibility:'public',joinMode:'approval',
    lead:actor,members:[actor],pending:[],inviteCode:'secret',createdAt:new Date().toISOString()});
   return reply({ok:true,id,status:'created'});
  }
  const c=communities.get(id);if(!c)return reply({code:'P0002',message:'Unavailable'},404);
  if(action==='join'){
   if(!c.members.includes(actor)&&!c.pending.includes(actor))c.pending.push(actor);
   return reply({ok:true,status:c.members.includes(actor)?'joined':'pending'});
  }
  if(action==='respond'){
   if(c.lead!==actor)return reply({code:'42501',message:'Lead required'},403);
   if(!c.pending.includes(target))return reply({code:'P0002',message:'Missing request'},404);
   c.pending=c.pending.filter(v=>v!==target);
   if(accept)c.members.push(target);
   return reply({ok:true});
  }
  if(action==='lead'){
   if(c.lead!==actor)return reply({code:'42501',message:'Lead required'},403);
   c.lead=target;return reply({ok:true});
  }
  if(action==='remove'){
   if(c.lead!==actor)return reply({code:'42501',message:'Lead required'},403);
   c.members=c.members.filter(v=>v!==target);return reply({ok:true});
  }
  if(action==='leave'){
   if(c.lead===actor){communities.delete(id);return reply({ok:true,deleted:true});}
   c.members=c.members.filter(v=>v!==actor);return reply({ok:true});
  }
 }
 if(name==='gb_study_community_snapshot'){
  const list=[...communities.values()].filter(c=>(!data.p_id||c.id===data.p_id)
    &&(data.p_mine?c.members.includes(data.p_actor)||c.pending.includes(data.p_actor):c.visibility==='public'||c.members.includes(data.p_actor)));
  return reply(list);
 }
 if(name==='gb_study_partnerships'||name==='gb_study_blocks')return reply([]);
 if(name==='gb_study_messages')return reply([]);
 if(name==='gb_study_deliver')return reply({ok:true});
 if(name==='gb_study_inbox')return reply([]);
 if(name==='gb_study_sync_room'||name==='gb_study_sync_community')return reply(1);
 if(name==='gb_study_students')return reply([]);
 throw Error('Unexpected query '+name);
};
const {default:handler,runWithContext}=await import('../node-functions/lib/api-core.js');
const token=id=>{
 const body=Buffer.from(JSON.stringify({sub:id,role:'student',v:1,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
 return body+'.'+crypto.createHmac('sha256',process.env.AUTH_SECRET).update(body).digest('base64url');
};
const req=async(path,{user='u0',method='GET',body}={})=>{
 const request=new Request('https://staging.invalid'+path,{method,headers:{authorization:'Bearer '+token(user),
 ...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const res=await runWithContext({request,env:process.env},()=>handler(request));
 return {status:res.status,data:await res.json()};
};
let id;
test('community SQL mode is expressly gated',async()=>{
 process.env.GB_STUDY_COMMUNITY_CUTOVER_APPROVED='false';
 assert.equal((await req('/api/learning/communities')).status,503);
 process.env.GB_STUDY_COMMUNITY_CUTOVER_APPROVED='true';
});
test('community creation and discovery use SQL without writing community membership to Blob',async()=>{
 const created=await req('/api/learning/communities',{method:'POST',body:{name:'PHY 101 Circle',joinMode:'approval',subject:'Physics'}});
 assert.equal(created.status,201,JSON.stringify(created));id=created.data.id;
 assert.equal(created.data.isLead,true);
 const list=await req('/api/learning/communities');
 assert.equal(list.status,200);assert.ok(list.data.communities.some(c=>c.id===id));
 const disk=JSON.parse(await fs.readFile(filename,'utf8'));
 assert.deepEqual(disk.learningCommunities,[]);
});
test('requests use SQL with leader-only approval',async()=>{
 const joined=await req('/api/learning/communities/join',{user:'u1',method:'POST',body:{id}});
 assert.equal(joined.status,200);assert.equal(joined.data.status,'pending');
 assert.equal((await req(`/api/learning/communities/${id}/requests`,{user:'u1',method:'POST',body:{userId:'u1',accept:true}})).status,403);
 assert.equal((await req(`/api/learning/communities/${id}/requests`,{method:'POST',body:{userId:'u1',accept:true}})).status,200);
 const details=await req(`/api/learning/communities/${id}`,{user:'u1'});
 assert.equal(details.status,200);assert.equal(details.data.joined,true);
});
test('SQL connectivity failures fail closed and do not leak legacy membership',async()=>{
 outage=true;
 const result=await req(`/api/learning/communities/${id}`,{user:'u1'});
 assert.notEqual(result.status,200);
 outage=false;
});
