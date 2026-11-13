import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createStudyChatStore,chatRoom} from '../node-functions/lib/study-chat-store.js';

const rows=[];
const fakeFetch=async (url, options={})=>{
 const endpoint=new URL(url),name=endpoint.pathname.split('/').pop(),params=endpoint.searchParams;
 const posted=options.body?JSON.parse(options.body):{};
 const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
 if(!url.startsWith('https://chat-unit.supabase.co/rest/v1/'))return response({message:'external request blocked'},404);
 if(name==='gb_study_messages'){
  if(options.method==='DELETE'){
   for(let i=rows.length-1;i>=0;i--)if([...params].every(([k,v])=>!v.startsWith('eq.')||String(rows[i][k])===v.slice(3)))rows.splice(i,1);
   return new Response(null,{status:204});
  }
  let found=rows.filter(r=>[...params].every(([k,v])=>{
   if(k==='select'||k==='order'||k==='limit')return true;
   if(v.startsWith('eq.'))return String(r[k])===v.slice(3);
   if(v.startsWith('gt.'))return new Date(r[k])>new Date(v.slice(3));
   if(v.startsWith('lt.'))return new Date(r[k])<new Date(v.slice(3));
   return true;
  }));
  const order=params.get('order')||'';
  found.sort((a,b)=>(order.includes('.asc')?1:-1)*(Date.parse(a[order.split('.')[0]])-Date.parse(b[order.split('.')[0]])));
  return response(found.slice(0,Number(params.get('limit')||1000)).map(r=>({payload:r.payload})));
 }
 if(name==='gb_study_send'){
  const k=posted.p_client;
  let v=rows.find(r=>r.room_key===posted.p_room&&r.sender_id===posted.p_sender&&r.client_id===k);
  if(v)return response(v.payload);
  const now=new Date().toISOString();
  const payload={id:crypto.randomUUID(),from:posted.p_sender,to:posted.p_recipient,text:posted.p_text,clientId:k,replyTo:posted.p_reply,createdAt:now,reactions:[],deletedFor:[],readAt:null,deliveredAt:null};
  v={id:payload.id,room_key:posted.p_room,sender_id:posted.p_sender,recipient_id:posted.p_recipient,client_id:k,payload,created_at:now,updated_at:now};rows.push(v);return response(payload);
 }
 if(name==='gb_study_action'){
  const r=rows.find(x=>x.id===posted.p_id&&x.room_key===posted.p_room);
  if(!r)return response({message:'message missing'},404);
  if(posted.p_action==='react')r.payload.reactions=[{userId:posted.p_actor,emoji:posted.p_value}];
  if(posted.p_action==='edit')r.payload.text=posted.p_value;
  if(posted.p_action==='delete_everyone'){r.payload.text='';r.payload.deletedAt=new Date().toISOString();}
  if(posted.p_action==='delete_me')r.payload.deletedFor=[posted.p_actor];
  r.updated_at=new Date().toISOString();return response(r.payload);
 }
 if(name==='gb_study_read'){
  let count=0;for(const r of rows)if(r.room_key===posted.p_room&&r.recipient_id===posted.p_recipient&&!r.payload.readAt){r.payload.readAt=new Date().toISOString();r.payload.deliveredAt ||= r.payload.readAt;count++;r.updated_at=new Date().toISOString()}
  return response({ok:true,count,readAt:new Date().toISOString()});
 }
 if(name==='gb_study_deliver'){
  for(const r of rows)if(r.recipient_id===posted.p_recipient&&!r.payload.deliveredAt)r.payload.deliveredAt=new Date().toISOString();
  return response({ok:true});
 }
 if(name==='gb_study_inbox'){
  const peers=new Map();for(const r of rows.filter(r=>r.recipient_id===posted.p_user||r.sender_id===posted.p_user)){
   const peer=r.sender_id===posted.p_user?r.recipient_id:r.sender_id;
   const old=peers.get(peer)||{peer,lastMessage:null,unreadCount:0};
   if(!old.lastMessage||old.lastMessage.createdAt<r.payload.createdAt)old.lastMessage=r.payload;
   if(r.recipient_id===posted.p_user&&!r.payload.readAt)old.unreadCount++;
   peers.set(peer,old);
  }return response([...peers.values()]);
 }
 return response({message:'unknown function'},404);
};
const env={GB_CHAT_BACKEND:'supabase',GB_CHAT_SUPABASE_URL:'https://chat-unit.supabase.co',GB_CHAT_SUPABASE_SECRET:'test-server-side-secret-over-32-chars'};
const store=createStudyChatStore(env,fakeFetch);

test('Chat database disabled by default; fail closed with missing secret',()=>{
 assert.equal(createStudyChatStore({}),null);
 assert.throws(()=>createStudyChatStore({GB_CHAT_BACKEND:'supabase',GB_CHAT_SUPABASE_URL:env.GB_CHAT_SUPABASE_URL}),/secret/i);
});
test('Room identifiers are stable, not order-dependent, and distinct by community',()=>{
 assert.equal(chatRoom('private','student-a','student-b'),chatRoom('private','student-b','student-a'));
 assert.notEqual(chatRoom('private','student-a','student-b'),chatRoom('community','student-a'));
});
test('Private messages are idempotent, have read receipts, delta reads, reactions, and inbox',async()=>{
 const room=chatRoom('private','a','b');const sent=await store.send(room,'a','b','Hello','key-one');
 assert.equal((await store.send(room,'a','b','Hello','key-one')).id,sent.id);
 assert.equal((await store.list(room)).length,1);
 assert.equal((await store.inbox('b'))[0].unreadCount,1);
 assert.equal((await store.read(room,'b')).count,1);
 assert.ok((await store.get(room,sent.id)).readAt);
 const reacts=await store.act(room,sent.id,'b','react','👍');assert.deepEqual(reacts.reactions,[{userId:'b',emoji:'👍'}]);
 const edited=await store.act(room,sent.id,'a','edit','Hello again');assert.equal(edited.text,'Hello again');
 const deleted=await store.act(room,sent.id,'a','delete_me');assert.deepEqual(deleted.deletedFor,['a']);
 assert.equal((await store.list(room))[0].id,sent.id);
});
test('Private and community messages have isolated storage and user purge removes chat history',async()=>{
 const community=chatRoom('community',crypto.randomUUID());
 const item=await store.send(community,'a',null,'Group message','key-group');
 assert.equal((await store.get(community,item.id)).text,'Group message');
 assert.equal((await store.list(chatRoom('private','a','b'))).length,1);
 await store.purgeCommunity(community);
 assert.equal((await store.list(community)).length,0);
 await store.purgeUser('a');
 assert.equal((await store.list(chatRoom('private','a','b'))).length,0);
});
