import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {realtimeConfiguration,signRealtimeToken,realtimeTopic} from '../node-functions/lib/study-realtime-auth.js';

const config={GB_CHAT_BACKEND:'supabase',GB_CHAT_REALTIME_ENABLED:'true',GB_CHAT_SUPABASE_URL:'https://chat-unit.supabase.co',GB_CHAT_REALTIME_JWT_SECRET:'jwt-secret-at-least-32-characters-long-only-on-server',GB_CHAT_REALTIME_PUBLISHABLE_KEY:'sb_publishable_realtime_client_key_12345'};
test('Realtime is opt-in, fail-closed on incorrect configuration and never returns a service-role token',()=>{
 assert.equal(realtimeConfiguration({...config,GB_CHAT_REALTIME_ENABLED:'false'}),null);
 assert.throws(()=>realtimeConfiguration({...config,GB_CHAT_REALTIME_JWT_SECRET:''}),/invalid/i);
 assert.throws(()=>realtimeConfiguration({...config,GB_CHAT_REALTIME_PUBLISHABLE_KEY:'sb_secret_abcdefghijklmnopqrstuvwxyz'}),/invalid/i);
 assert.throws(()=>realtimeConfiguration({...config,GB_CHAT_SUPABASE_URL:'http://unsafe.example.com'}),/invalid/i);
 const conf=realtimeConfiguration(config);assert.equal(conf.source,'https://chat-unit.supabase.co');
 const result=signRealtimeToken(conf,'student-12',{now:1000000});
 const [a,b,c]=result.token.split('.');const body=JSON.parse(Buffer.from(b,'base64url'));
 assert.equal(body.sub,'student-12');assert.equal(body.role,'authenticated');assert.equal(body.exp-body.iat,120);
 assert.equal(crypto.createHmac('sha256',conf.secret).update(a+'.'+b).digest('base64url'),c);
 assert.ok(!result.token.includes(config.GB_CHAT_REALTIME_PUBLISHABLE_KEY));
 assert.throws(()=>signRealtimeToken(conf,'x',{expiresIn:3600}),/Invalid/);
});
test('Realtime channel topics cannot be constructed with untrusted paths',()=>{
 assert.equal(realtimeTopic('c:some-community'),'realtime:gb-study:c:some-community');
 assert.equal(realtimeTopic('p:'+'0'.repeat(64)),'realtime:gb-study:p:'+'0'.repeat(64));
 for(const invalid of ['c:../../../etc/passwd','p:123','not-a-chat','c:/invalid'])assert.throws(()=>realtimeTopic(invalid));
});
test('Realtime SQL migration restricts listeners to current room membership and broadcasts no plaintext',async()=>{
 const sql=await fs.readFile(new URL('../database/20261111_study_realtime_and_directory.sql',import.meta.url),'utf8');
 for(const table of ['gb_study_students','gb_study_partnerships','gb_study_community_directory','gb_study_community_members','gb_study_room_members'])assert.ok(sql.includes('create table if not exists public.'+table));
 assert.match(sql,/revoke all on public\.gb_study_students/s);
 assert.match(sql,/realtime\.messages for select\s+to authenticated/);
 assert.match(sql,/gb_study_can_receive\(realtime\.topic\(\)\)/);
 assert.match(sql,/auth\.jwt\(\)->>'sub'/);
 assert.doesNotMatch(sql,/for insert\s+to authenticated\s+with check/);
 assert.match(sql,/jsonb_build_object\('kind','changed'\)/);
 assert.doesNotMatch(sql,/jsonb_build_object\('text'/);
});
test('Browser WebSocket joins a private topic, refreshes on push, never publishes messages, and falls back on close',async()=>{
 const src=await fs.readFile(new URL('../public/study-realtime.js',import.meta.url),'utf8');
 const events=[];const changes=[];
 class WS{
   static OPEN=1;
   constructor(url){this.url=url;this.readyState=0;this.sent=[];events.push(this)}
   send(value){this.sent.push(JSON.parse(value))}
   open(){this.readyState=1;this.onopen?.()}
   recv(value){this.onmessage?.({data:JSON.stringify(value)})}
   close(){this.readyState=3}
 }
 const ticket={transport:'websocket',url:'wss://chat-unit.supabase.co/realtime/v1/websocket',topic:'realtime:gb-study:c:community-1',key:'sb_publishable_testtesttesttesttest',token:'ey.header.sig',expiresAt:Date.now()+120000};
 const listeners={};
 const context={window:{},GBStudy:{api:async()=>ticket},document:{hidden:false,addEventListener:(name,fn)=>listeners[name]=fn,removeEventListener:()=>{}},WebSocket:WS,URLSearchParams,Math,setTimeout,clearTimeout,Date,JSON,console,globalThis:null};
 context.globalThis=context;vm.runInNewContext(src,context);
 const states=[];const connection=context.window.GBStudyLive.connection({path:'?community=community-1',onChange:()=>changes.push('changed'),onStatus:s=>states.push(s),WebSocketImpl:WS});
 connection.start();await new Promise(r=>setTimeout(r,0));assert.equal(events.length,1);
 const ws=events[0];assert.ok(ws.url.includes('apikey=sb_publishable_'));ws.open();
 assert.equal(ws.sent[0].event,'phx_join');assert.equal(ws.sent[0].payload.config.private,true);
 assert.equal(ws.sent[0].payload.access_token,ticket.token);
 ws.recv({topic:ticket.topic,event:'phx_reply',ref:ws.sent[0].ref,payload:{status:'ok'}});
 assert.equal(connection.isLive(),true);
 ws.recv({topic:ticket.topic,event:'broadcast',payload:{event:'gb_changed',payload:{kind:'changed'}}});
 await new Promise(r=>setTimeout(r,180));assert.ok(changes.length>0);
 assert.ok(ws.sent.every(x=>x.event!=='broadcast'),'Only trusted SQL triggers may broadcast');
 connection.close();assert.equal(connection.isLive(),false);
});
