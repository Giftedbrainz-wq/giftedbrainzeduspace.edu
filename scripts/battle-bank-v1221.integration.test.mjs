import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temp=await fs.mkdtemp(path.join(os.tmpdir(),'gb-battle-bulk-'));
process.env.GB_DATA_DIR=temp;
process.env.GB_ALLOW_LOCAL_STORE='true';
process.env.AUTH_SECRET='local-battle-bank-v1221-unique-secret';
const {default:handler,runWithContext}=await import('../node-functions/lib/api-core.js');
await fs.writeFile(path.join(temp,crypto.createHash('sha256').update('data').digest('hex')+'.bin'),JSON.stringify({users:[{id:'student-a',name:'Student',username:'student-a',email:'student@example.test',status:'active',approval:'approved',approved:true,tokenVersion:1,accountType:'free',selectedSubjects:['Use of English']}],settings:{contentPackVersion:'2026.08.16-content-7-final',adminCredentialsVersion:2,tokenVersion:1}}));
function token(sub='admin',role='admin'){const body=Buffer.from(JSON.stringify({sub,role,v:1,exp:Math.floor(Date.now()/1000)+36000})).toString('base64url');return `${body}.${crypto.createHmac('sha256',process.env.AUTH_SECRET).update(body).digest('base64url')}`;}
async function req(route,{method='GET',data,role='admin'}={}){const request=new Request('http://test.local'+route,{method,headers:{authorization:'Bearer '+token(role==='admin'?'admin':'student-a',role),...(data===undefined?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})});const response=await runWithContext({request,env:process.env},()=>handler(request));return {status:response.status,body:await response.json()};}
const question=(subject,i)=>({subject,topic:'General',q:`Question ${i}: what is ${i}?`,options:['A','B','C','D'],answer:0,difficulty:'medium',passage:i===1?'A source reading passage.':''});
test('Battle Arena question browser paginates and bulk deletes by subject without affecting others',async()=>{
 const a='Bulk Bank Alpha',b='Bulk Bank Beta';
 for(const name of [a,b])assert.equal((await req('/api/admin/subjects',{method:'POST',data:{name}})).status,201);
 for(let i=1;i<=33;i++)assert.equal((await req('/api/admin/battle/questions',{method:'POST',data:question(a,i)})).status,201);
 for(let i=1;i<=3;i++)assert.equal((await req('/api/admin/battle/questions',{method:'POST',data:question(b,i)})).status,201);
 const list=await req('/api/admin/battle/questions?page=1&limit=25&subject='+encodeURIComponent(a));
 assert.equal(list.status,200);assert.equal(list.body.total,33);assert.equal(list.body.questions.length,25);assert.equal(list.body.counts[a],33);assert.equal(list.body.counts[b],3);
 assert.ok(list.body.questions[0].passage==='A source reading passage.'?false:true); // newest first; passage is on last page
 const next=await req('/api/admin/battle/questions?page=2&limit=25&subject='+encodeURIComponent(a));
 assert.equal(next.body.questions.length,8);assert.ok(next.body.questions.some(q=>q.passage==='A source reading passage.'));
 assert.equal((await req('/api/admin/battle/questions/bulk-delete',{method:'POST',role:'student',data:{scope:'all',confirmText:'DELETE ALL BATTLE QUESTIONS'}})).status,401);
 assert.equal((await req('/api/admin/battle/questions/bulk-delete',{method:'POST',data:{scope:'all',confirmText:'DELETE'}})).status,400);
 const deleted=await req('/api/admin/battle/questions/bulk-delete',{method:'POST',data:{scope:'subject',subject:a,confirmText:'DELETE SUBJECT'}});
 assert.equal(deleted.status,200,JSON.stringify(deleted.body));assert.equal(deleted.body.deleted,33);assert.equal(deleted.body.remaining,3);
 const still=await req('/api/admin/battle/questions?page=1&limit=25');assert.equal(still.body.total,3);assert.ok(still.body.questions.every(q=>q.subject===b));
 const all=await req('/api/admin/battle/questions/bulk-delete',{method:'POST',data:{scope:'all',subject:'',confirmText:'DELETE ALL BATTLE QUESTIONS'}});
 assert.equal(all.status,200);assert.equal(all.body.deleted,3);assert.equal(all.body.remaining,0);
});

test('Battle Arena question browser controls are present, above the collapsed editor',async()=>{
 const html=await fs.readFile(new URL('../public/battle-admin.html',import.meta.url),'utf8');
 for(const id of ['battleSubjectCounts','questionSearch','questionSubjectFilter','battlePageStatus','battlePageStatusBottom','prevBattleQuestions','nextBattleQuestions','prevBattleQuestionsBottom','nextBattleQuestionsBottom','deleteBattleSubject','deleteBattleAll','battleQuestionEditor']){
  assert.match(html,new RegExp('id="'+id+'"'),id+' missing from Battle admin HTML');
 }
 assert.ok(html.indexOf('id="questionsList"')<html.indexOf('id="addQuestion"'),'Question browser should be above editing forms');
 assert.match(html,/<details id="battleQuestionEditor"/);
});
