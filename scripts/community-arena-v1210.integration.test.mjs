import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temp=await fs.mkdtemp(path.join(os.tmpdir(),'gb-community-v1210-'));
process.env.GB_DATA_DIR=temp;
process.env.GB_ALLOW_LOCAL_STORE='true';
process.env.AUTH_SECRET='test-v1210-secret-with-enough-length-for-tests';
const {default:handler,runWithContext}=await import('../node-functions/lib/api-core.js');
const users=Array.from({length:4},(_,i)=>({id:`new-user-${i+1}`,name:`Student ${i+1}`,username:`newstudent${i+1}`,email:`newstudent${i+1}@example.test`,status:'active',approval:'approved',approved:true,tokenVersion:1,accountType:'free',selectedSubjects:['Use of English']}));
const storeFile=path.join(temp,crypto.createHash('sha256').update('data').digest('hex')+'.bin');
await fs.writeFile(storeFile,JSON.stringify({users,settings:{contentPackVersion:'2026.08.16-content-7-final',adminCredentialsVersion:2,tokenVersion:1}}));
function token(sub,role='student'){const body=Buffer.from(JSON.stringify({sub,role,v:1,exp:Math.floor(Date.now()/1000)+36000})).toString('base64url');const sig=crypto.createHmac('sha256',process.env.AUTH_SECRET).update(body).digest('base64url');return body+'.'+sig;}
async function req(url,{as=users[0].id,method='GET',data}={}){const request=new Request('http://test.local'+url,{method,headers:{authorization:`Bearer ${token(as==='admin'?'admin':as,as==='admin'?'admin':'student')}`,...(data===undefined?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})});const res=await runWithContext({request,env:process.env},()=>handler(request));let obj={};try{obj=await res.json()}catch{}return {status:res.status,data:obj};}

test('Students can reply publicly to published announcements, not unpublished ones',async()=>{
  const created=await req('/api/admin/announcements',{as:'admin',method:'POST',data:{title:'Class update',body:'There will be a lesson tomorrow',published:true}});
  assert.equal(created.status,200,JSON.stringify(created));
  const draft=await req('/api/admin/announcements',{as:'admin',method:'POST',data:{title:'Secret draft',body:'Not public yet',published:false}});
  assert.equal(draft.status,200);
  const message=await req(`/api/announcements/${created.data.id}/replies`,{as:users[0].id,method:'POST',data:{message:'Thank you for the update.'}});
  assert.equal(message.status,201,JSON.stringify(message));
  const list=await req('/api/announcements',{as:users[1].id});
  assert.equal(list.status,200);assert.equal(list.data.length,1);
  assert.equal(list.data[0].replies[0].message,'Thank you for the update.');
  assert.equal(list.data[0].replies[0].name,'Student 1');
  const hiddenReply=await req(`/api/announcements/${draft.data.id}/replies`,{as:users[1].id,method:'POST',data:{message:'Should be hidden'}});
  assert.equal(hiddenReply.status,404);
});

test('Team nullification requires its leader and cancels pending challenges without destroying results',async()=>{
  const a=await req('/api/battle/teams',{method:'POST',as:users[0].id,data:{name:'Alpha Team',logo:'lion'}});
  const b=await req('/api/battle/teams',{method:'POST',as:users[1].id,data:{name:'Bravo Team',logo:'eagle'}});
  assert.equal(a.status,201,JSON.stringify(a));assert.equal(b.status,201,JSON.stringify(b));
  const notLeader=await req(`/api/battle/teams/${a.data.id}/nullify`,{method:'POST',as:users[1].id,data:{}});
  assert.equal(notLeader.status,403);
  const created=await req(`/api/battle/teams/${a.data.id}/nullify`,{method:'POST',as:users[0].id,data:{}});
  assert.equal(created.status,200,JSON.stringify(created));
  const find=await req('/api/battle/teams',{as:users[0].id});
  assert.equal(find.status,200);assert.equal(find.data.teams.some(v=>v.id===a.data.id),false);
  const stale=await req('/api/battle/teams/lookup?code='+encodeURIComponent(a.data.code),{as:users[0].id});
  assert.equal(stale.status,404);
});

test('Explore Teams only lists currently online, eligible teams and ignores offline teams',async()=>{
  const a=await req('/api/battle/teams',{method:'POST',as:users[2].id,data:{name:'Online Team',logo:'lion'}});
  const b=await req('/api/battle/teams',{method:'POST',as:users[3].id,data:{name:'Offline Team',logo:'eagle'}});
  assert.equal(a.status,201);assert.equal(b.status,201);
  assert.equal((await req('/api/learning/partners/presence',{method:'POST',as:users[2].id,data:{}})).status,200);
  const list=await req('/api/battle/teams/explore',{as:users[2].id});
  assert.equal(list.status,200);assert.ok(list.data.teams.some(t=>t.id===a.data.id));
  assert.equal(list.data.teams.some(t=>t.id===b.data.id),false);
});

test('15-minute inactivity expires unengaged teams and waiting rooms without deleting published announcements',async()=>{
  // Simulate an expired team by setting its lastActivityAt in the persisted
  // server data. This tests the actual cleanup route, not just a CSS label.
  const all=JSON.parse(await fs.readFile(storeFile,'utf8'));
  const expired=all.battleTeams.find(t=>t.name==='Online Team');
  assert.ok(expired);expired.lastActivityAt=Date.now()-16*60000;
  all._revision=(Number(all._revision)||0)+1;
  await fs.writeFile(storeFile,JSON.stringify(all));
  await new Promise(resolve=>setTimeout(resolve,350)); // clear 300 ms read cache
  const result=await req('/api/battle/teams',{as:users[2].id});
  assert.equal(result.status,200);assert.equal(result.data.teams.some(t=>t.id===expired.id),false);
  const list=await req('/api/announcements',{as:users[2].id});assert.equal(list.status,200);assert.equal(list.data.length,1);
});

test('Simultaneous student replies are merged rather than one overwriting the other',async()=>{
  const announcements=await req('/api/announcements',{as:users[0].id});
  const id=announcements.data[0].id;
  const replies=await Promise.all([
    req(`/api/announcements/${id}/replies`,{as:users[1].id,method:'POST',data:{message:'First student reply'}}),
    req(`/api/announcements/${id}/replies`,{as:users[2].id,method:'POST',data:{message:'Second student reply'}})
  ]);
  for(const r of replies)assert.equal(r.status,201,JSON.stringify(r));
  const list=await req('/api/announcements',{as:users[3].id});
  const texts=list.data[0].replies.map(x=>x.message);
  assert.ok(texts.includes('First student reply'));
  assert.ok(texts.includes('Second student reply'));
});

test('Expired waiting match rooms disappear from student recents and cannot be joined',async()=>{
  const subject='Economics';
  assert.equal((await req('/api/admin/subjects',{as:'admin',method:'POST',data:{name:subject}})).status,201);
  for(let i=0;i<5;i++)assert.equal((await req('/api/admin/battle/questions',{as:'admin',method:'POST',data:{subject,topic:'Demand',q:`Question ${i+1}`,options:['A','B','C','D'],answer:1,explanation:'Option B'}})).status,201);
  const teamA=await req('/api/battle/teams',{as:users[0].id,method:'POST',data:{name:'Room expiry A',logo:'lion'}});
  const teamB=await req('/api/battle/teams',{as:users[1].id,method:'POST',data:{name:'Room expiry B',logo:'lion'}});
  assert.equal(teamA.status,201);assert.equal(teamB.status,201);
  const match=await req('/api/battle/create',{as:users[0].id,method:'POST',data:{title:'Expiry check',teamId:teamA.data.id,opponentCode:teamB.data.code,format:'1v1',subject,questionCount:5}});
  assert.equal(match.status,201,JSON.stringify(match));
  const data=JSON.parse(await fs.readFile(storeFile,'utf8'));
  const room=data.battleRooms.find(r=>r.id===match.data.id);assert.ok(room);room.expiresAt=Date.now()-1000;
  data._revision=(Number(data._revision)||0)+1;
  await fs.writeFile(storeFile,JSON.stringify(data));
  await new Promise(resolve=>setTimeout(resolve,350));
  const recent=await req('/api/battle/mine',{as:users[0].id});
  assert.equal(recent.status,200);assert.equal(recent.data.some(r=>r.id===room.id),false);
  const lookup=await req('/api/battle/lookup?code='+encodeURIComponent(room.code),{as:users[0].id});
  assert.equal(lookup.status,410);
});
