import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temp=await fs.mkdtemp(path.join(os.tmpdir(),'brainz-v123-'));
process.env.GB_DATA_DIR=temp;
process.env.GB_ALLOW_LOCAL_STORE='true';
process.env.AUTH_SECRET='v123-local-qa-only-long-secret';
const {default:handler,runWithContext}=await import('../node-functions/lib/api-core.js');
const users=[
 {id:'free-123',name:'Free learner',username:'free123',email:'free@example.test',whatsapp:'+2348015550000',status:'active',approval:'approved',approved:true,tokenVersion:1,accountType:'free',selectedSubjects:['Use of English','Chemistry']},
 {id:'paid-123',name:'Activated learner',username:'paid123',email:'paid@example.test',whatsapp:'+2348015550001',status:'active',approval:'approved',approved:true,tokenVersion:1,accountType:'activated',selectedSubjects:['Use of English','Chemistry']},
 {id:'old-pending',name:'Old waiting',username:'waiting123',email:'waiting@example.test',whatsapp:'+2348015550002',status:'active',approval:'pending',approved:false,tokenVersion:1,accountType:'free',selectedSubjects:['Use of English']}
];
await fs.writeFile(path.join(temp,crypto.createHash('sha256').update('data').digest('hex')+'.bin'),JSON.stringify({users,settings:{contentPackVersion:'2026.08.16-content-7-final',adminCredentialsVersion:2,tokenVersion:1}}));
function token(sub,role='student'){const b=Buffer.from(JSON.stringify({sub,role,v:1,exp:Math.floor(Date.now()/1000)+36000})).toString('base64url');return b+'.'+crypto.createHmac('sha256',process.env.AUTH_SECRET).update(b).digest('base64url');}
async function req(url,{as='admin',method='GET',data,auth=true}={}){
 const request=new Request('http://test.local'+url,{method,headers:{...(auth?{authorization:`Bearer ${token(as==='admin'?'admin':as,as==='admin'?'admin':'student')}`}:{}) ,...(data===undefined?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})});
 const response=await runWithContext({request,env:process.env},()=>handler(request));
 let parsed;try{parsed=await response.json()}catch{parsed={}}return {status:response.status,data:parsed};
}
const post=(url,data)=>req(url,{method:'POST',data});

test('global subjects support emoji updates and are shared across EduSpace',async()=>{
 const initial=await req('/api/admin/subjects');assert.equal(initial.status,200);
 const created=await post('/api/admin/subjects',{name:'Astronomy',emoji:'🌌'});assert.equal(created.status,201,JSON.stringify(created.data));
 const id=created.data.id;
 assert.ok((await req('/api/subjects')).data.includes('Astronomy'));
 assert.ok((await req('/api/battle/catalog',{as:'free-123'})).data.subjects.includes('Astronomy'));
 let icons=await req('/api/subjects/icons',{auth:false});assert.equal(icons.data.find(x=>x.name==='Astronomy').emoji,'🌌');
 const updated=await req('/api/admin/subjects/'+id,{method:'PATCH',data:{name:'Space Science',emoji:'🚀'}});assert.equal(updated.status,200,JSON.stringify(updated.data));
 icons=await req('/api/subjects/icons',{auth:false});assert.equal(icons.data.find(x=>x.name==='Space Science').emoji,'🚀');
 assert.ok(!(await req('/api/subjects')).data.includes('Astronomy'));
 assert.equal((await req('/api/admin/topics',{method:'POST',data:{subject:'Space Science',name:'Stars'}})).status,201);
 assert.equal((await req('/api/admin/subjects/'+id,{method:'DELETE'})).status,409);
 assert.equal((await post('/api/admin/battle/subjects',{name:'Incorrect Location'})).status,410);
});

test('registration immediately grants a free student account and secure avatar',async()=>{
 const result=await req('/api/register',{method:'POST',auth:false,data:{name:'New student',username:'newstudent123',email:'newstudent@example.test',whatsapp:'+2348015550029',password:'StrongPass#901',selectedSubjects:['Use of English','Chemistry'],avatar:'scholar-14'}});
 assert.equal(result.status,200,JSON.stringify(result.data));
 assert.equal(result.data.pending,false);
 assert.equal(result.data.user.accountType,'free');assert.equal(result.data.user.avatar,'scholar-14');assert.ok(result.data.token);
 const logged=await req('/api/login',{method:'POST',auth:false,data:{username:'newstudent123',password:'StrongPass#901'}});assert.equal(logged.status,200,JSON.stringify(logged.data));
 const prior=await req('/api/login',{method:'POST',auth:false,data:{username:'waiting123',password:'nonsense'}});assert.equal(prior.status,401);
 assert.equal((await req('/api/admin/pending')).status,410);
 assert.equal((await req('/api/registration-status?username=newstudent123',{auth:false})).status,410);
 const update=await req('/api/me',{as:'free-123',method:'PATCH',data:{avatar:'scholar-20',name:'Free learner'}});
 assert.equal(update.status,200,JSON.stringify(update.data));assert.equal(update.data.user.avatar,'scholar-20');
 const spoof=await req('/api/me',{as:'free-123',method:'PATCH',data:{avatar:'../../private.txt'}});assert.equal(spoof.data.user.avatar,'scholar-01');
 assert.equal((await req('/api/avatars',{auth:false})).data.length,24);
});

test('independent CBT, materials and videos protect premium resources without folders',async()=>{
 const cbt=await post('/api/admin/cbt-tests',{subject:'Chemistry',title:'Atomic Structure Premium',linkUrl:'https://example.edu/test-secret',accessLevel:'restricted',published:true});
 assert.equal(cbt.status,201,JSON.stringify(cbt.data));
 const video=await post('/api/admin/videos',{subject:'Chemistry',title:'Elements Video',youtubeUrl:'https://www.youtube.com/watch?v=abc123',published:true});
 assert.equal(video.status,201,JSON.stringify(video.data));
 const note=await post('/api/admin/notes',{subject:'Chemistry',title:'Private Note',body:'Sensitive secret lesson',accessLevel:'restricted',published:true});
 assert.equal(note.status,200,JSON.stringify(note.data));
 for(const row of [cbt.data,video.data,note.data])assert.ok(!Object.hasOwn(row,'collectionId'));
 assert.equal((await req('/api/material-collections',{as:'free-123'})).status,404);
 assert.equal((await req('/api/admin/material-collections',{method:'POST',data:{subject:'Chemistry',name:'Unwanted'}})).status,404);
 assert.ok(!(await req('/api/cbt-tests',{as:'free-123'})).data.some(r=>r.id===cbt.data.id));
 assert.ok(!(await req('/api/materials',{as:'free-123'})).data.some(r=>r.id===note.data.id));
 assert.ok((await req('/api/videos',{as:'free-123'})).data.some(r=>r.id===video.data.id));
 assert.ok((await req('/api/cbt-tests?space=premium',{as:'paid-123'})).data.some(r=>r.id===cbt.data.id));
 assert.ok((await req('/api/materials?space=premium',{as:'paid-123'})).data.some(r=>r.id===note.data.id));
});

test('release 12.3 visual assets, sidebar, registration and no verification shortcuts',async()=>{
 const publicDir=new URL('../public/',import.meta.url);
 const read=name=>fs.readFile(new URL(name,publicDir),'utf8');
 const admin=await read('admin.html'),battle=await read('battle.js'),register=await read('register.html'),index=await read('index.html'),account=await read('account.html');
 assert.ok(admin.includes('id="v-battle"')&&admin.includes('id="battleAdminFrame"')&&admin.includes('id:"subjects"'));
 assert.ok(!admin.includes('id="v-verify"'));assert.ok(!admin.includes('data-admin-view="verify"'));
 assert.ok(admin.includes('id="adminStudentSearch"')&&/(?:Search|search) by username/.test(admin));
 assert.ok(!admin.includes('id="collectionResourceForm"'));assert.ok(battle.includes('battle-score-logo')&&battle.includes('battle-scoreboard'));
 assert.ok(index.includes('id="gbIntro"')&&index.includes('/intro.js'));assert.ok(register.includes('id="registerAvatars"')&&account.includes('id="accountAvatars"'));
 const authForms=await read('auth-forms.js');assert.match(authForms,/function initRegistration\(\)[\s\S]*const avatars=\$\("registerAvatars"\)/);assert.doesNotMatch(authForms,/waiting for admin approval/i);
 // Source graphics live outside public; EdgeOne's build copies them into the static output.
 const rootDir=new URL('../assets/',import.meta.url);
 for(const name of ['lion','panther','rocket','phoenix','owl']) assert.match(await fs.readFile(new URL(`battle/${name}.svg`,rootDir),'utf8'),/<svg/);
 for(const number of [1,12,24]){const bytes=await fs.readFile(new URL(`avatars/scholar-${String(number).padStart(2,'0')}.png`,rootDir));assert.equal(bytes.subarray(1,4).toString(),'PNG');}
});
