import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gb-study-v1213-'));
process.env.GB_DATA_DIR=dir;process.env.GB_ALLOW_LOCAL_STORE='true';process.env.AUTH_SECRET='test-study-messaging-secret-at-least-32-characters';
const {default:handler,runWithContext}=await import('../node-functions/lib/api-core.js');
const students=Array.from({length:24},(_,i)=>({id:'student'+i,name:'Student '+i,username:'user'+i,email:'student'+i+'@example.test',status:'active',approval:'approved',approved:true,tokenVersion:1,accountType:'free',selectedSubjects:['Use of English']}));
await fs.writeFile(path.join(dir,crypto.createHash('sha256').update('data').digest('hex')+'.bin'),JSON.stringify({users:students,settings:{contentPackVersion:'2026.08.16-content-7-final',adminCredentialsVersion:2,tokenVersion:1}}));
function token(sub){const body=Buffer.from(JSON.stringify({sub,role:'student',v:1,exp:Math.floor(Date.now()/1000)+36000})).toString('base64url');return body+'.'+crypto.createHmac('sha256',process.env.AUTH_SECRET).update(body).digest('base64url')}
async function req(url,{as=students[0].id,method='GET',data}={}){
 const request=new Request('http://test.local'+url,{method,headers:{authorization:'Bearer '+token(as),...(data===undefined?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})});
 const res=await runWithContext({request,env:process.env},()=>handler(request));let body;try{body=await res.json()}catch{body={}}return {status:res.status,data:body};
}
const post=(url,data,as)=>req(url,{method:'POST',data,as});
const patch=(url,data,as)=>req(url,{method:'PATCH',data,as});
test('Private chat requires accepted partnership and supports idempotent send, read receipts and replies',async()=>{
 assert.equal((await post('/api/learning/partners/messages',{to:'student1',text:'No request'})).status,403);
 const r=await post('/api/learning/partners/request',{userId:'student1'});assert.equal(r.status,201,JSON.stringify(r));
 assert.equal((await post(`/api/learning/partners/${r.data.id}/respond`,{accept:true},'student1')).status,200);
 const sent=await post('/api/learning/partners/messages',{to:'student1',text:'Hello there',clientId:'stable-123'});assert.equal(sent.status,201,JSON.stringify(sent));
 assert.equal((await post('/api/learning/partners/messages',{to:'student1',text:'Hello there',clientId:'stable-123'})).data.id,sent.data.id);
 assert.equal((await req('/api/learning/partners/messages?with=student0',{as:'student1'})).data.length,1);
 const pair=await req('/api/learning/partners',{as:'student1'});assert.equal(pair.data[0].unreadCount,1);
 const read=await post('/api/learning/partners/messages/read',{with:'student0'},'student1');assert.equal(read.status,200);assert.equal(read.data.count,1);
 const after=await req('/api/learning/partners/messages?with=student1',{as:'student0'});assert.ok(after.data[0].readAt);
 const reply=await post('/api/learning/partners/messages',{to:'student0',text:'Thanks!',replyTo:sent.data.id},'student1');assert.equal(reply.status,201);assert.equal(reply.data.replyTo,sent.data.id);
 assert.equal((await req('/api/learning/partners/messages?with=student2',{as:'student0'})).status,403);
});
test('Editing and reaction permissions, delete-for-me and delete-for-all are respected',async()=>{
 const list=await req('/api/learning/partners/messages?with=student1');const first=list.data[0];
 assert.equal((await patch('/api/learning/partners/messages/'+first.id,{text:'Edited message'},'student1')).status,403);
 const edit=await patch('/api/learning/partners/messages/'+first.id,{text:'Edited message'},'student0');assert.equal(edit.status,200);assert.equal(edit.data.message.text,'Edited message');
 const react=await post('/api/learning/partners/messages/'+first.id+'/react',{emoji:'❤️'},'student1');assert.equal(react.status,200);assert.equal(react.data.reactions.length,1);
 assert.equal((await post('/api/learning/partners/messages/'+first.id+'/react',{emoji:'💣'},'student1')).status,400);
 const delMe=await req('/api/learning/partners/messages/'+first.id+'?scope=me',{method:'DELETE',as:'student1'});assert.equal(delMe.status,200);
 assert.equal((await req('/api/learning/partners/messages?with=student0',{as:'student1'})).data.some(x=>x.id===first.id),false);
 assert.equal((await req('/api/learning/partners/messages?with=student1',{as:'student0'})).data.some(x=>x.id===first.id),true);
 const gone=await req('/api/learning/partners/messages/'+first.id+'?scope=everyone',{method:'DELETE',as:'student0'});assert.equal(gone.status,200);
 assert.equal((await req('/api/learning/partners/messages?with=student1')).data[0].text,'');
});
let communityId,invite;
test('Community creation, visibility, invitation, approval, lead transfer and member access',async()=>{
 const created=await post('/api/learning/communities',{name:'Physics Study Circle',description:'Prepare for PHY 101',subject:'Physics',visibility:'private',joinMode:'approval'});
 assert.equal(created.status,201,JSON.stringify(created));communityId=created.data.id;invite=created.data.inviteCode;
 assert.equal((await req('/api/learning/communities',{as:'student1'})).data.communities.some(x=>x.id===communityId),false);
 assert.equal((await req('/api/learning/communities/'+communityId,{as:'student1'})).status,403);
 assert.equal((await post('/api/learning/communities/join',{id:communityId},'student1')).status,403);
 const invited=await post('/api/learning/communities/join',{id:communityId,code:invite},'student1');assert.equal(invited.data.status,'joined');
 assert.equal((await post('/api/learning/communities/'+communityId+'/lead',{userId:'student2'},'student1')).status,403);
 const result=await post('/api/learning/communities/'+communityId+'/lead',{userId:'student1'});assert.equal(result.status,200);
 const information=await req('/api/learning/communities/'+communityId,{as:'student1'});assert.equal(information.data.isLead,true);
 assert.equal(information.data.members,2);
 assert.equal((await post('/api/learning/communities/'+communityId+'/leave',{},'student0')).status,200);
});
test('Study Community messages are protected and editable by author and moderated by Lead',async()=>{
 assert.equal((await post('/api/learning/communities/'+communityId+'/messages',{text:'Not a member'},'student2')).status,403);
 const sent=await post('/api/learning/communities/'+communityId+'/messages',{text:'Our next physics revision is Wednesday.',clientId:'x2'},'student1');assert.equal(sent.status,201,JSON.stringify(sent));
 assert.equal((await post('/api/learning/communities/'+communityId+'/messages',{text:'Our next physics revision is Wednesday.',clientId:'x2'},'student1')).data.id,sent.data.id);
 assert.equal((await req('/api/learning/communities/'+communityId+'/messages',{as:'student2'})).status,403);
 const mine=await req('/api/learning/communities/'+communityId+'/messages',{as:'student1'});assert.equal(mine.data.length,1);
 const edit=await patch('/api/learning/communities/'+communityId+'/messages/'+sent.data.id,{text:'Revision starts at noon'},'student1');assert.equal(edit.status,200);
 const reaction=await post('/api/learning/communities/'+communityId+'/messages/'+sent.data.id+'/react',{emoji:'👍'},'student1');assert.equal(reaction.status,200);
 const removed=await req('/api/learning/communities/'+communityId+'/messages/'+sent.data.id,{method:'DELETE',as:'student1'});assert.equal(removed.status,200);
 const list=await req('/api/learning/communities/'+communityId+'/messages',{as:'student1'});assert.equal(list.data[0].text,'');
});
test('20-member community cap is enforced',async()=>{
 const open=await post('/api/learning/communities',{name:'Twenty Members Only',subject:'Mathematics',joinMode:'open'});assert.equal(open.status,201);const cid=open.data.id;
 for(let i=1;i<=19;i++){const r=await post('/api/learning/communities/join',{id:cid},'student'+i);assert.equal(r.status,200,JSON.stringify(r))}
 const full=await post('/api/learning/communities/join',{id:cid},'student20');assert.equal(full.status,409,JSON.stringify(full));
 const info=await req('/api/learning/communities/'+cid);assert.equal(info.data.members,20);
});
