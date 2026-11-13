import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'gb-sql-chat-'));
Object.assign(process.env,{
 GB_DATA_DIR:dataDir,GB_ALLOW_LOCAL_STORE:'true',AUTH_SECRET:'test-study-chat-service-secret-abcdefghijklmnopqrstuvwxyz',
 GB_CHAT_BACKEND:'supabase',GB_CHAT_SUPABASE_URL:'https://chat-unit.supabase.co',GB_CHAT_SUPABASE_SECRET:'test-chat-service-role-abcdefghijklmnopqrstuvwxyz'
});
const users=Array.from({length:3},(_,i)=>({id:'s'+i,name:'Scholar '+i,username:'scholar'+i,email:`s${i}@test.local`,status:'active',approval:'approved',approved:true,tokenVersion:1,selectedSubjects:['Use of English']}));
await fs.writeFile(path.join(dataDir,crypto.createHash('sha256').update('data').digest('hex')+'.bin'),JSON.stringify({users,settings:{contentPackVersion:'2026.08.16-content-7-final',adminCredentialsVersion:2,tokenVersion:1}}));
const rows=[];
const resp=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
globalThis.fetch=async (input,opt={})=>{
 const url=String(input),u=new URL(url),route=u.pathname.split('/').at(-1),x=opt.body?JSON.parse(opt.body):{};
 if(!url.startsWith('https://chat-unit.supabase.co/rest/v1/'))throw Error('Unexpected network request');
 if(route==='gb_study_messages'){
  if(opt.method==='DELETE'){
   const match=[...u.searchParams].filter(([,v])=>v.startsWith('eq.'));
   for(let i=rows.length-1;i>=0;i--)if(match.every(([k,v])=>String(rows[i][k])===v.slice(3)))rows.splice(i,1);
   return new Response(null,{status:204});
  }
  let list=rows.filter(r=>[...u.searchParams].every(([key,val])=>{
   if(['select','order','limit'].includes(key))return true;
   if(val.startsWith('eq.'))return String(r[key])===val.slice(3);
   if(val.startsWith('gt.'))return new Date(r[key])>new Date(val.slice(3));
   if(val.startsWith('lt.'))return new Date(r[key])<new Date(val.slice(3));
   return true;
  }));
  const ord=u.searchParams.get('order')||'created_at.desc';const field=ord.split('.')[0];
  list=list.sort((a,b)=>(ord.includes('.asc')?1:-1)*(Date.parse(a[field])-Date.parse(b[field])));
  return resp(list.slice(0,Number(u.searchParams.get('limit')||100)).map(r=>({payload:r.payload})));
 }
 if(route==='gb_study_send'){
  const existing=rows.find(r=>r.room_key===x.p_room&&r.sender_id===x.p_sender&&r.client_id===x.p_client);
  if(existing)return resp(existing.payload);
  const now=new Date().toISOString();
  const payload={id:crypto.randomUUID(),from:x.p_sender,to:x.p_recipient,clientId:x.p_client,text:x.p_text,replyTo:x.p_reply,createdAt:now,reactions:[],deletedFor:[],deliveredAt:null,readAt:null};
  rows.push({room_key:x.p_room,id:payload.id,sender_id:x.p_sender,recipient_id:x.p_recipient,client_id:x.p_client,payload,created_at:now,updated_at:now});
  return resp(payload);
 }
 if(route==='gb_study_deliver'){
  rows.filter(r=>r.recipient_id===x.p_recipient).forEach(r=>r.payload.deliveredAt ||=new Date().toISOString());return resp({ok:true});
 }
 if(route==='gb_study_inbox'){
  const result=[];for(const r of rows.filter(r=>r.sender_id===x.p_user||r.recipient_id===x.p_user)){
   const peer=r.sender_id===x.p_user?r.recipient_id:r.sender_id;
   let entry=result.find(y=>y.peer===peer);if(!entry){entry={peer,lastMessage:null,unreadCount:0};result.push(entry)}
   entry.lastMessage=r.payload;if(r.recipient_id===x.p_user&&!r.payload.readAt)entry.unreadCount++;
  }return resp(result);
 }
 if(route==='gb_study_read'){
  let count=0;for(const r of rows)if(r.room_key===x.p_room&&r.recipient_id===x.p_recipient&&!r.payload.readAt){r.payload.readAt=new Date().toISOString();r.payload.deliveredAt||=r.payload.readAt;r.updated_at=new Date().toISOString();count++;}
  return resp({ok:true,count,readAt:new Date().toISOString()});
 }
 if(route==='gb_study_action'){
  const row=rows.find(r=>r.room_key===x.p_room&&r.id===x.p_id);if(!row)return resp({message:'not found'},404);
  if(x.p_action==='edit')row.payload.text=x.p_value;
  if(x.p_action==='react')row.payload.reactions=[{userId:x.p_actor,emoji:x.p_value}];
  if(x.p_action==='delete_everyone'){row.payload.text='';row.payload.deletedAt=new Date().toISOString();}
  if(x.p_action==='delete_me')row.payload.deletedFor=[x.p_actor];
  row.updated_at=new Date().toISOString();return resp(row.payload);
 }
 return resp({message:'unknown SQL endpoint'},404);
};
const {default:handler,runWithContext}=await import('../node-functions/lib/api-core.js');
const token=id=>{const body=Buffer.from(JSON.stringify({sub:id,role:'student',v:1,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');return body+'.'+crypto.createHmac('sha256',process.env.AUTH_SECRET).update(body).digest('base64url');};
async function req(path,{as='s0',method='GET',data}={}){
 const request=new Request('https://edu.test'+path,{method,headers:{authorization:'Bearer '+token(as),...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
 const response=await runWithContext({request,env:process.env},()=>handler(request));let value;try{value=await response.json()}catch{value=null}return {status:response.status,data:value};
}
const post=(url,data,as)=>req(url,{method:'POST',data,as});
let message,group;
test('dedicated backend enables only after schema/config verification',async()=>{
 const r=await req('/api/learning/messaging/status');assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.backend,'supabase');
});
test('the dedicated path requires partnership and stores messages outside shared Blob',async()=>{
 assert.equal((await post('/api/learning/partners/messages',{to:'s1',text:'Blocked'})).status,403);
 const request=await post('/api/learning/partners/request',{userId:'s1'});assert.equal(request.status,201);
 assert.equal((await post('/api/learning/partners/'+request.data.id+'/respond',{accept:true},'s1')).status,200);
 const sent=await post('/api/learning/partners/messages',{to:'s1',text:'Hello from SQL',clientId:'once-1'});
 assert.equal(sent.status,201,JSON.stringify(sent));message=sent.data;
 assert.equal((await post('/api/learning/partners/messages',{to:'s1',text:'Hello from SQL',clientId:'once-1'})).data.id,message.id);
 assert.equal((await req('/api/learning/partners/messages?with=s0',{as:'s1'})).data.length,1);
 assert.equal((await req('/api/learning/partners/messages?with=s0',{as:'s2'})).status,403);
 const disk=JSON.parse(await fs.readFile(path.join(dataDir,crypto.createHash('sha256').update('data').digest('hex')+'.bin'),'utf8'));
 assert.equal(disk.learningMessages?.length||0,0,'Chat messages must not be embedded in the central blob');
});
test('inbox, receipts, editing and private chat moderation work through the SQL backend',async()=>{
 let inbox=await req('/api/learning/partners',{as:'s1'});
 assert.equal(inbox.status,200,JSON.stringify(inbox));assert.equal(inbox.data[0].unreadCount,1);
 assert.equal((await post('/api/learning/partners/messages/read',{with:'s0'},'s1')).status,200);
 const delta=await req('/api/learning/partners/messages?with=s0&changedAfter='+encodeURIComponent(new Date(Date.now()-10000).toISOString()),{as:'s1'});
 assert.equal(delta.status,200,JSON.stringify(delta));assert.equal(delta.data[0].id,message.id);
 const edited=await req('/api/learning/partners/messages/'+message.id,{method:'PATCH',data:{text:'Updated message'}});
 assert.equal(edited.status,200,JSON.stringify(edited));assert.equal(edited.data.message.text,'Updated message');
 const reacted=await post('/api/learning/partners/messages/'+message.id+'/react',{emoji:'❤️'},'s1');assert.equal(reacted.status,200,JSON.stringify(reacted));
 const forbidden=await req('/api/learning/partners/messages/'+message.id,{method:'PATCH',data:{text:'tamper'},as:'s1'});assert.equal(forbidden.status,403);
});
test('community SQL messages enforce membership and survive client chat pagination',async()=>{
 const created=await post('/api/learning/communities',{name:'SCIENCE STUDY ROOM',subject:'Physics'});
 assert.equal(created.status,201,JSON.stringify(created));group=created.data;
 assert.equal((await post(`/api/learning/communities/${group.id}/messages`,{text:'No access'},'s1')).status,403);
 assert.equal((await post('/api/learning/communities/join',{id:group.id},'s1')).status,200);
 const sent=await post(`/api/learning/communities/${group.id}/messages`,{text:'Weekly revision',clientId:'group-msg'});
 assert.equal(sent.status,201,JSON.stringify(sent));
 assert.equal((await req(`/api/learning/communities/${group.id}/messages`,{as:'s1'})).data[0].text,'Weekly revision');
 assert.equal((await req(`/api/learning/communities/${group.id}/messages`,{as:'s2'})).status,403);
});
