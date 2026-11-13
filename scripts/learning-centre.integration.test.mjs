import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gb-learning-'));
process.env.GB_DATA_DIR=dir;process.env.GB_ALLOW_LOCAL_STORE='true';process.env.AUTH_SECRET='local-learning-test-secret-long-enough';
process.env.ASSESSMENT_HUB_SYNC_SECRET='testing-only-hub-sync-secret-at-least-32-characters';
const {default:handler,runWithContext}=await import('../node-functions/lib/api-core.js');
const students=[
 {id:'s1',name:'Student One',username:'alphauser',email:'alpha@school.test',status:'active',accountType:'free',approval:'approved',tokenVersion:1,selectedSubjects:['Use of English','Chemistry']},
 {id:'s2',name:'Student Two',username:'betastudent',email:'beta@school.test',status:'active',accountType:'free',approval:'approved',tokenVersion:1,selectedSubjects:['Use of English','Chemistry']},
 {id:'s3',name:'Student Three',username:'thirdstudent',email:'third@school.test',status:'active',approval:'approved',tokenVersion:1,selectedSubjects:['Use of English']}
];
const finishedRoom={id:'finished-room',code:'GB-999999',createdBy:'s1',createdAt:new Date().toISOString(),status:'finished',subject:'Chemistry',topic:'Acids',title:'Test',format:'1v1',questions:[{id:'b-question-1',q:'What is the formula of water?',options:['CO2','H2O'],answer:1,explanation:'Water is H₂O.'}],teams:{A:{name:'Alpha',logo:'lion',leader:'s1',members:['s1'],score:10,ready:[],pending:[]},B:{name:'Beta',logo:'owl',leader:'s2',members:['s2'],score:0,ready:[],pending:[]}},sizes:{A:1,B:1},winner:'A',round:1,answers:{}};
await fs.writeFile(path.join(dir,crypto.createHash('sha256').update('data').digest('hex')+'.bin'),JSON.stringify({users:students,settings:{contentPackVersion:'2026.08.16-content-7-final',adminCredentialsVersion:2,tokenVersion:1},battleRooms:[finishedRoom]}));
function token(sub,role='student'){let b=Buffer.from(JSON.stringify({sub,role,v:1,exp:Math.floor(Date.now()/1000)+36000})).toString('base64url');return b+'.'+crypto.createHmac('sha256',process.env.AUTH_SECRET).update(b).digest('base64url');}
async function req(url,{as='s1',role='student',method='GET',data,headers={}}={}){
 const request=new Request('http://test.local'+url,{method,headers:{...(as?{authorization:'Bearer '+token(as,role)}:{}),...(data===undefined?{}:{'content-type':'application/json'}),...headers},...(data===undefined?{}:{body:typeof data==='string'?data:JSON.stringify(data)})});
 const response=await runWithContext({request,env:process.env},()=>handler(request));
 let val;try{val=await response.json()}catch{val={}};
 return {status:response.status,data:val};
}
const post=(url,data,as='s1')=>req(url,{as,method:'POST',data});
const patch=(url,data,as='s1')=>req(url,{as,method:'PATCH',data});
test('student learning storage is private, mutable and not reliant on CBT links',async()=>{
 assert.equal((await req('/api/learning/overview',{as:null})).status,401);
 const m=await post('/api/learning/mistakes',{subject:'Chemistry',topic:'Acids',question:'Why does a metal react with an acid?',explanation:'Hydrogen gas is released.'});
 assert.equal(m.status,201,JSON.stringify(m.data));assert.equal(m.data.source,'manual');
 assert.equal((await req('/api/learning/mistakes')).data.length,1);
 assert.equal((await req('/api/learning/mistakes',{as:'s2'})).data.length,0);
 assert.equal((await patch('/api/learning/mistakes/'+m.data.id,{mastered:true},'s2')).status,404);
 assert.equal((await patch('/api/learning/mistakes/'+m.data.id,{mastered:true})).status,200);
 assert.equal((await req('/api/learning/overview')).data.counts.mistakes,0);
 assert.equal((await req('/api/learning/mistakes/'+m.data.id,{as:'s1',method:'DELETE'})).status,200);
 const saved=await post('/api/learning/saved',{subject:'Chemistry',question:'Which formula represents benzene?',options:['C6H6','H2O','NaCl','CO2'],correctIndex:0,explanation:'Benzene is C6H6.'});assert.equal(saved.status,201);assert.deepEqual(saved.data.options,['C6H6','H2O','NaCl','CO2']);assert.equal(saved.data.correctIndex,0);
 assert.equal((await req('/api/learning/saved',{as:'s2'})).data.length,0);
 assert.equal((await req('/api/learning/saved/'+saved.data.id,{as:'s2',method:'DELETE'})).status,404);
 const incorrect=await post('/api/learning/saved',{source:'assessment_hub',subject:'Chemistry',question:'Pretend to be Hub'});assert.equal(incorrect.status,400);
});
test('Study Planner links published CBT resources without exposing restricted URLs',async()=>{
 const cbt=await req('/api/admin/cbt-tests',{as:'admin',role:'admin',method:'POST',data:{subject:'Chemistry',title:'Premium test',linkUrl:'https://assessment.example.test/restricted',accessLevel:'restricted',published:true}});
 assert.equal(cbt.status,201,JSON.stringify(cbt.data));
 const resources=await req('/api/learning/resources');const resource=resources.data.find(x=>x.id===cbt.data.id);
 assert.equal(resource,undefined,'Restricted CBT must not appear in the Public planner resource list');
 const denied=await post('/api/learning/plans',{title:'Complete Chemistry CBT',date:'2027-01-15',type:'cbt',resourceType:'cbt',resourceId:cbt.data.id});assert.equal(denied.status,404);
 const plan=await post('/api/learning/plans',{title:'Revise Chemistry',date:'2027-01-15',type:'study'});assert.equal(plan.status,201,JSON.stringify(plan.data));
 const listed=(await req('/api/learning/plans')).data[0];assert.equal(listed.resource,null);
 assert.ok(!JSON.stringify(listed).includes('assessment.example.test/restricted'));
 assert.equal((await patch('/api/learning/plans/'+plan.data.id,{completed:true})).status,200);
 assert.equal((await req('/api/learning/plans',{as:'s2'})).data.length,0);
 assert.equal((await post('/api/learning/plans',{title:'Wrong date',date:'2027-02-31'})).status,400);
 const badges=await req('/api/learning/badges');assert.equal(badges.status,200);assert.ok(badges.data.every(x=>typeof x.progress==='number'));
});
test('only completed Battle Arena questions belonging to student can be bookmarked',async()=>{
 const saved=await post('/api/learning/saved',{source:'battle',roomId:'finished-room',questionId:'b-question-1'});
 assert.equal(saved.status,201,JSON.stringify(saved.data));assert.equal(saved.data.correctIndex,1);
 assert.equal((await post('/api/learning/saved',{source:'battle',roomId:'finished-room',questionId:'b-question-1'})).status,409);
 assert.equal((await post('/api/learning/saved',{source:'battle',roomId:'finished-room',questionId:'b-question-1'},'s3')).status,403);
});
test('Study Partners require consent and prevent unauthorised messaging',async()=>{
 const results=await req('/api/learning/partners/search?q=beta');assert.equal(results.status,200);assert.deepEqual(results.data.map(u=>u.username),['betastudent']);assert.equal(results.data[0].email,undefined);
 const before=await post('/api/learning/partners/messages',{to:'s2',text:'Hello'});assert.equal(before.status,403);
 const invite=await post('/api/learning/partners/request',{userId:'s2'});assert.equal(invite.status,201,JSON.stringify(invite.data));
 assert.equal((await req('/api/learning/partners',{as:'s2'})).data[0].direction,'received');
 assert.equal((await patch('/api/learning/partners/'+invite.data.id+'/respond',{accept:true})).status,404);
 const agreed=await post('/api/learning/partners/'+invite.data.id+'/respond',{accept:true},'s2');assert.equal(agreed.status,200);
 const goal=await post('/api/learning/partners/goals',{to:'s2',title:'Revise electrochemistry',date:'2027-01-15'});assert.equal(goal.status,201,JSON.stringify(goal.data));
 assert.equal((await req('/api/learning/partners/goals?with=s1',{as:'s3'})).status,403);
 assert.equal((await patch('/api/learning/partners/goals/'+goal.data.id,{completed:true},'s2')).status,200);
 assert.deepEqual((await req('/api/learning/partners/goals?with=s2')).data[0].completedBy,['s2']);
 const sent=await post('/api/learning/partners/messages',{to:'s2',text:'Please explain quadratic equations.'});assert.equal(sent.status,201,JSON.stringify(sent.data));
 assert.equal((await req('/api/learning/partners/messages?with=s1',{as:'s3'})).status,403);
 assert.equal((await req('/api/learning/partners/messages?with=s1',{as:'s2'})).data.length,1);
 assert.equal((await post('/api/learning/partners/report',{messageId:sent.data.id,reason:'Unkind message'},'s2')).status,201);
 const reports=await req('/api/admin/learning/reports',{as:'admin',role:'admin'});assert.equal(reports.status,200);assert.equal(reports.data.length,1);
 assert.equal((await req('/api/admin/learning/reports')).status,401);
 assert.equal((await post('/api/learning/partners/block',{userId:'s1'},'s2')).status,200);
 assert.equal((await post('/api/learning/partners/messages',{to:'s2',text:'Hi again'})).status,403);
});
function signed(data){const raw=JSON.stringify(data),t=String(Math.floor(Date.now()/1000));return {raw,headers:{'x-gb-hub-timestamp':t,'x-gb-hub-signature':'sha256='+crypto.createHmac('sha256',process.env.ASSESSMENT_HUB_SYNC_SECRET).update(t+'.'+raw).digest('hex')}};}
test('Assessment Hub webhook is dormant unless valid signature and explicit linked account',async()=>{
 const unsigned=await req('/api/integrations/assessment-hub/events',{as:null,method:'POST',data:{type:'cbt.completed'}});assert.equal(unsigned.status,401);
 const unlinked=signed({eventId:'prelink',type:'cbt.completed',externalUserId:'hub-s1',attemptId:'attempt-2',questions:[]});
 assert.equal((await req('/api/integrations/assessment-hub/events',{as:null,method:'POST',data:unlinked.raw,headers:unlinked.headers})).status,403);
 const created=await post('/api/learning/integration/link-code',{});assert.equal(created.status,200,JSON.stringify(created.data));assert.ok(created.data.code);
 const link=signed({eventId:'link-1',type:'account.linked',externalUserId:'hub-s1',linkCode:created.data.code});
 assert.equal((await req('/api/integrations/assessment-hub/link',{as:null,method:'POST',data:link.raw,headers:link.headers})).status,200);
 assert.equal((await req('/api/learning/integration/status')).data.linked,true);
 const item={questionId:'ch-1',subject:'Chemistry',topic:'Acids',question:'Which reaction produces hydrogen gas?',options:['Salt + water','Metal + acid','Metal + base'],correctIndex:1,selectedIndex:0,explanation:'Metals and acids commonly produce hydrogen.'};
 const finish=signed({eventId:'attempt-1',type:'cbt.completed',externalUserId:'hub-s1',attemptId:'attempt-1',subject:'Chemistry',questions:[item]});
 const res=await req('/api/integrations/assessment-hub/events',{as:null,method:'POST',data:finish.raw,headers:finish.headers});assert.equal(res.status,200,JSON.stringify(res.data));
 assert.equal((await req('/api/learning/mistakes')).data[0].source,'assessment_hub');
 assert.equal((await req('/api/learning/mistakes',{as:'s2'})).data.length,0);
 assert.equal((await req('/api/integrations/assessment-hub/events',{as:null,method:'POST',data:finish.raw,headers:finish.headers})).data.duplicate,true);
 assert.equal((await req('/api/learning/mistakes')).data.length,1);
 // Existing Hub records without a quiz identifier can be cleared by attempt ID.
 const grouped=await req('/api/learning/mistakes',{method:'DELETE',data:{quizId:'attempt-1'}});
 assert.equal(grouped.status,200,JSON.stringify(grouped.data));assert.equal(grouped.data.removed,1);
 assert.equal((await req('/api/learning/mistakes')).data.length,0);
 const bookmark=signed({eventId:'bookmark-1',type:'question.bookmarked',externalUserId:'hub-s1',...item});
 assert.equal((await req('/api/integrations/assessment-hub/events',{as:null,method:'POST',data:bookmark.raw,headers:bookmark.headers})).status,200);
 assert.ok((await req('/api/learning/saved')).data.some(x=>x.source==='assessment_hub'));
});
test('new student-facing tools are wired into EduSpace navigation',async()=>{
 const read=f=>fs.readFile(new URL('../public/'+f,import.meta.url),'utf8');
 const nav=await read('gb-ui.js'),dashboard=await read('dashboard.html'),battle=await read('battle.js');
 assert.match(nav,/href: "\/learning-centre\.html"/);assert.match(nav,/href: "\/study-partners\.html"/);
 assert.match(dashboard,/Open My Learning Centre/);assert.match(battle,/data-save-battle/);
 for(const f of ['learning-centre.js','study-partners.js','learning-centre.html','study-partners.html','learning.css'])assert.ok((await read(f)).length>100);
});
test('combined learning bootstrap matches separate resources and never reveals other students records',async()=>{
 const result=await req('/api/learning/bootstrap');assert.equal(result.status,200,JSON.stringify(result.data));
 const combined=result.data;
 for(const key of ['overview','mistakes','plans','saved','badges','resources'])assert.ok(Object.hasOwn(combined,key),key);
 for(const key of ['mistakes','plans','saved','badges','resources'])assert.deepEqual(combined[key],(await req('/api/learning/'+key)).data,key);
 assert.deepEqual(combined.overview,(await req('/api/learning/overview')).data);
 const other=(await req('/api/learning/bootstrap',{as:'s2'})).data;
 assert.ok(!other.mistakes.some(x=>x.userId==='s1'),'cannot read another student’s notes');
 assert.ok(!other.saved.some(x=>x.userId==='s1'),'cannot read another student’s bookmarks');
 assert.equal((await req('/api/learning/bootstrap',{as:null})).status,401);
 const dashboard=await req('/api/dashboard');assert.equal(dashboard.status,200);
 assert.ok(Array.isArray(dashboard.data.learningPlans));
 assert.deepEqual(dashboard.data.learningPlans.map(x=>x.title),combined.plans.map(x=>x.title));
});
test('deleting a student purges linked Assessment Hub data and private learning records',async()=>{
 const deleted=await req('/api/admin/students/s1',{as:'admin',role:'admin',method:'DELETE'});
 assert.equal(deleted.status,200,JSON.stringify(deleted.data));
 assert.equal((await req('/api/learning/overview',{as:'s1'})).status,401);
 assert.equal((await req('/api/learning/partners',{as:'s2'})).data.some(x=>x.from==='s1'||x.to==='s1'),false);
 const oldHub=signed({eventId:'post-delete',type:'question.unbookmarked',externalUserId:'hub-s1',questionId:'ch-1'});
 assert.equal((await req('/api/integrations/assessment-hub/events',{as:null,method:'POST',data:oldHub.raw,headers:oldHub.headers})).status,403);
});
