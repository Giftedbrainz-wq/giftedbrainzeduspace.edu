import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temp=await fs.mkdtemp(path.join(os.tmpdir(),'gb-premium-discovery-'));
process.env.GB_DATA_DIR=temp;
process.env.GB_ALLOW_LOCAL_STORE='true';
process.env.AUTH_SECRET='local-premium-integration-nonproduction-secret';
const {default:handler,runWithContext}=await import('../node-functions/lib/api-core.js');
const collection='collection-premium-1';
const fileKey='uploads/premium-chapter.pdf';
const sample={
  settings:{contentPackVersion:'2026.08.16-content-7-final',adminCredentialsVersion:2,tokenVersion:1},
  users:[
    {id:'free-student',name:'Free Learner',username:'freestudent',email:'free@example.test',status:'active',approval:'approved',accountType:'free',tokenVersion:1,selectedSubjects:['Use of English','Chemistry']},
    {id:'premium-student',name:'Premium Learner',username:'premiumstudent',email:'premium@example.test',status:'active',approval:'approved',accountType:'activated',tokenVersion:1,selectedSubjects:['Use of English','Chemistry']}
  ],
  materialCollections:[{id:collection,name:'Atomic structure',subject:'Chemistry'}],
  notes:[
    {id:'premium-note',subject:'Chemistry',title:'Premium Chemistry Notes',topic:'Atomic structure',collectionId:collection,summary:'Overview of key ideas',body:'SECRET PREMIUM CHAPTER',accessLevel:'restricted',published:true,format:'text',attachments:[{key:fileKey,url:'/api/files/'+encodeURIComponent(fileKey),fileName:'premium-chapter.pdf',contentType:'application/pdf'}]},
    {id:'free-note',subject:'Chemistry',title:'Public Notes',topic:'Atomic structure',collectionId:collection,body:'PUBLIC CONTENT',accessLevel:'public',published:true,format:'text',attachments:[]}
  ],
  cbtTests:[
    {id:'premium-cbt',subject:'Chemistry',title:'Advanced Chemistry Test',writeup:'PREMIUM TEST DESCRIPTION',linkUrl:'https://example.test/private-cbt',linkLabel:'Begin premium test',performanceUrl:'https://example.test/private-performance',performanceLabel:'Performance Summary',accessLevel:'restricted',published:true},
    {id:'free-cbt',subject:'Chemistry',title:'Open Chemistry Test',writeup:'Public test description',linkUrl:'https://example.test/free',performanceUrl:'https://example.test/free-performance',performanceLabel:'Check Scores',accessLevel:'public',published:true}
  ],
  results:[{id:'old-score',userId:'free-student',subject:'Chemistry',testTitle:'Old historical test',score:98,date:'2026-01-01'}],
  practiceHistory:[{id:'old-practice',userId:'free-student',subject:'Chemistry',questionIds:['x']}],
  topics:[{id:'topic1',subject:'Chemistry',name:'Atomic structure'}],
  progress:[{id:'complete-1',userId:'free-student',subject:'Chemistry',topicId:'topic1',completed:true}]
};
await fs.writeFile(path.join(temp,crypto.createHash('sha256').update('data').digest('hex')+'.bin'),JSON.stringify(sample));
function token(sub,role='student'){const body=Buffer.from(JSON.stringify({sub,role,v:1,exp:Math.floor(Date.now()/1000)+36000})).toString('base64url');const sig=crypto.createHmac('sha256',process.env.AUTH_SECRET).update(body).digest('base64url');return body+'.'+sig;}
async function request(url,who='free-student'){
  const role=who==='admin'?'admin':'student';
  const req=new Request('http://test.local'+url,{headers:{authorization:`Bearer ${token(who,role)}`}});
  const res=await runWithContext({request:req,env:process.env},()=>handler(req));
  let data=null;try{data=await res.json()}catch{}
  return {status:res.status,data};
}

test('Public space lists only public CBTs; Premium Space is exclusive to activated students',async()=>{
  const free=await request('/api/cbt-tests');
  assert.equal(free.status,200);
  assert.equal(free.data.some(x=>x.id==='premium-cbt'),false,'Free students must never see premium CBT listings');
  assert.ok(free.data.some(x=>x.id==='free-cbt'&&x.linkUrl));
  const freeDenied=await request('/api/cbt-tests?space=premium');
  assert.equal(freeDenied.status,403);
  const activatedPublic=await request('/api/cbt-tests','premium-student');
  assert.equal(activatedPublic.data.some(x=>x.id==='premium-cbt'),false,'Public tab must not include premium resources');
  const activated=await request('/api/cbt-tests?space=premium','premium-student');
  assert.equal(activated.status,200);
  const premium=activated.data.find(x=>x.id==='premium-cbt');
  assert.ok(premium);
  assert.equal(premium.linkUrl,'https://example.test/private-cbt');
  assert.equal(premium.performanceUrl,'https://example.test/private-performance');
  assert.equal(premium.performanceLabel,'Performance Summary');
  assert.match(premium.writeup,/PREMIUM TEST DESCRIPTION/);
});

test('Premium materials remain invisible in Public Space',async()=>{
  for(const route of ['/api/materials','/api/notes/full','/api/notes']){
    const free=await request(route);
    assert.equal(free.status,200);
    assert.ok(!free.data.some(x=>x.id==='premium-note'),route+' leaked a premium title');
    assert.ok(free.data.find(x=>x.id==='free-note'),route+' lost the public note');
    assert.equal((await request(route+'?space=premium')).status,403);
    const premium=await request(route+'?space=premium','premium-student');
    assert.equal(premium.status,200);
    assert.ok(premium.data.find(x=>x.id==='premium-note'));
    assert.ok(!premium.data.find(x=>x.id==='free-note'));
  }
  assert.equal((await request('/api/material-collections')).status,404);
  const premium=(await request('/api/materials?space=premium','premium-student')).data.find(x=>x.id==='premium-note');
  assert.equal(premium.body,'SECRET PREMIUM CHAPTER');
  assert.equal(premium.attachments[0].key,fileKey);
  assert.equal((await request('/api/learning/resources')).data.some(x=>x.id==='premium-note'),false);
  assert.equal((await request('/api/learning/resources?space=premium')).status,403);
  assert.ok((await request('/api/learning/resources?space=premium','premium-student')).data.find(x=>x.id==='premium-note'));
  assert.equal((await request('/api/learning-space')).data.canOpenPremium,false);
  assert.equal((await request('/api/learning-space','premium-student')).data.canOpenPremium,true);
});

test('Premium material direct-detail and attachment routes still enforce access on the server',async()=>{
  assert.equal((await request('/api/notes/premium-note')).status,403);
  assert.equal((await request('/api/files/'+encodeURIComponent(fileKey))).status,403);
  const premium=await request('/api/notes/premium-note','premium-student');
  assert.equal(premium.status,200);
  assert.equal(premium.data.body,'SECRET PREMIUM CHAPTER');
});

test('Old activity history remains private and no practice counts appear in active API responses',async()=>{
  const dash=await request('/api/dashboard');
  assert.equal(dash.status,200);
  assert.ok(!Object.hasOwn(dash.data,'results'));
  assert.ok(!Object.hasOwn(dash.data,'tests'));
  assert.ok(!Object.hasOwn(dash.data,'avg'));
  const overview=await request('/api/admin/overview','admin');
  assert.equal(overview.status,200);
  assert.ok(!Object.hasOwn(overview.data,'results'));
  assert.ok(!Object.hasOwn(overview.data,'averageScore'));
  const adminStudents=await request('/api/admin/students','admin');
  assert.equal(adminStudents.status,200);
  assert.ok(!Object.hasOwn(adminStudents.data[0],'tests'));
  assert.ok(!Object.hasOwn(adminStudents.data[0],'average'));
  const progress=await request('/api/admin/students/free-student/progress','admin');
  assert.equal(progress.status,200);
  assert.equal(progress.data.completedTopics,1);
  assert.ok(!Object.hasOwn(progress.data,'results'));
  assert.ok(!Object.hasOwn(progress.data,'average'));
  assert.equal((await request('/api/admin/results','admin')).status,410);
  assert.equal((await request('/api/results/old-score/review','free-student')).status,410);
});
