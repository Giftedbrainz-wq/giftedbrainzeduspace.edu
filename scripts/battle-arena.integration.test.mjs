import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'brainz-battle-integration-'));
process.env.GB_DATA_DIR = temp;
process.env.GB_ALLOW_LOCAL_STORE = 'true';
process.env.AUTH_SECRET = 'local-battle-integration-only-unique-key';
const {default:handler,runWithContext}=await import('../node-functions/lib/api-core.js');
const users=Array.from({length:6},(_,i)=>({id:`battle-user-${i+1}`,name:`Student ${i+1}`,username:`battle${i+1}`,email:`battle${i+1}@example.test`,status:'active',approval:'approved',approved:true,tokenVersion:1,accountType:'free',selectedSubjects:['Use of English']}));
await fs.writeFile(path.join(temp,crypto.createHash('sha256').update('data').digest('hex')+'.bin'),JSON.stringify({users,settings:{contentPackVersion:'2026.08.16-content-7-final',adminCredentialsVersion:2,tokenVersion:1}}));
function token(sub,role='student'){const body=Buffer.from(JSON.stringify({sub,role,v:1,exp:Math.floor(Date.now()/1000)+36000})).toString('base64url');const sig=crypto.createHmac('sha256',process.env.AUTH_SECRET).update(body).digest('base64url');return body+'.'+sig;}
async function req(url,{as='admin',method='GET',data}={}){
  const request=new Request('http://test.local'+url,{method,headers:{authorization:`Bearer ${token(as==='admin'?'admin':as,as==='admin'?'admin':'student')}`,...(data===undefined?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})});
  const result=await runWithContext({request,env:process.env},()=>handler(request));
  let obj={};try{obj=await result.json()}catch{}
  return {status:result.status,data:obj};
}
const question = i=>({subject:'Economics',topic:'Demand',q:`Question ${i+1}: Solve x + ${i}= ?`,options:['A','B','C','D'],answer:1,explanation:'Option B is correct.'});

test('team battle end-to-end: creation, invitation, leader approval, private chats, timers, scoring and review',async()=>{
  const subject=await req('/api/admin/subjects',{method:'POST',data:{name:'Economics'}});assert.equal(subject.status,201);
  for(let i=0;i<5;i++)assert.equal((await req('/api/admin/battle/questions',{method:'POST',data:question(i)})).status,201);
  const catalog=await req('/api/battle/catalog',{as:users[0].id});assert.ok(catalog.data.subjects.includes('Economics'));
  const teamA=await req('/api/battle/teams',{as:users[0].id,method:'POST',data:{name:'Blue Minds',logo:'lion'}});
  const teamB=await req('/api/battle/teams',{as:users[1].id,method:'POST',data:{name:'Red Minds',logo:'eagle'}});
  assert.equal(teamA.status,201,JSON.stringify(teamA.data));assert.equal(teamB.status,201);
  assert.match(teamA.data.code,/^BT-[A-F0-9]{10}$/);
  const lookupTeam=await req(`/api/battle/teams/lookup?code=${teamA.data.code}`,{as:users[2].id});
  assert.equal(lookupTeam.status,200);assert.equal(lookupTeam.data.name,'Blue Minds');
  const membership=(id,action)=>`/api/battle/teams/${id}/${action}`;
  assert.equal((await req(membership(teamA.data.id,'request'),{as:users[2].id,method:'POST',data:{}})).status,200);
  assert.equal((await req(membership(teamA.data.id,'approve'),{as:users[1].id,method:'POST',data:{userId:users[2].id}})).status,403);
  assert.equal((await req(membership(teamA.data.id,'approve'),{as:users[0].id,method:'POST',data:{userId:users[2].id}})).status,200);
  assert.equal((await req(membership(teamB.data.id,'request'),{as:users[3].id,method:'POST',data:{}})).status,200);
  assert.equal((await req(membership(teamB.data.id,'approve'),{as:users[1].id,method:'POST',data:{userId:users[3].id}})).status,200);
  assert.equal((await req(membership(teamB.data.id,'request'),{as:users[4].id,method:'POST',data:{}})).status,200);
  assert.equal((await req(membership(teamB.data.id,'decline'),{as:users[1].id,method:'POST',data:{userId:users[4].id}})).status,200);
  const create=await req('/api/battle/create',{as:users[0].id,method:'POST',data:{subject:'Economics',topic:'Demand',format:'2v2',questionCount:5,title:'Students Challenge',teamId:teamA.data.id,opponentCode:teamB.data.code}});
  assert.equal(create.status,201,JSON.stringify(create.data));const id=create.data.id,code=create.data.code;assert.match(code,/^GB-\d{6}$/);
  assert.equal(create.data.challengeStatus,'pending');
  const lookup=await req(`/api/battle/lookup?code=${code}`,{as:users[4].id});
  assert.equal(lookup.status,200);assert.equal(lookup.data.kind,'team');assert.equal(lookup.data.team.id,teamA.data.id);assert.equal(lookup.data.current,undefined);
  const room=url=>`/api/battle/rooms/${id}/${url}`;
  assert.equal((await req(room('request'),{as:users[4].id,method:'POST',data:{team:'B'}})).status,403);
  assert.equal((await req(room('respond'),{as:users[0].id,method:'POST',data:{accept:true}})).status,403);
  const invites=await req('/api/battle/teams',{as:users[1].id});assert.ok(invites.data.invitations.some(i=>i.roomId===id));
  assert.equal((await req(room('respond'),{as:users[1].id,method:'POST',data:{accept:true}})).status,200);
  assert.equal((await req(room(''),{as:users[1].id})).data.myTeam,'B');
  assert.equal((await req(membership(teamA.data.id,'leave'),{as:users[2].id,method:'POST',data:{}})).status,409);
  const postedChat=await req(room('chat'),{as:users[0].id,method:'POST',data:{text:'Answer B is likely.'}});
  assert.equal(postedChat.status,201);
  assert.equal(postedChat.data.message.text,'Answer B is likely.');
  assert.equal(postedChat.data.message.mine,true);
  const chatA=await req(room('chat'),{as:users[2].id});assert.equal(chatA.data.length,1);
  const chatB=await req(room('chat'),{as:users[1].id});assert.equal(chatB.data.length,0);
  assert.equal((await req(room('chat'),{as:users[4].id})).status,403);
  for(const u of users.slice(0,4)){
    const readyResult=await req(room('ready'),{as:u.id,method:'POST',data:{ready:true}});
    assert.equal(readyResult.status,200);
    assert.equal(readyResult.data.room.teams[readyResult.data.room.myTeam].ready.includes(u.id),true);
  }
  assert.equal((await req(room('start'),{as:users[1].id,method:'POST',data:{}})).status,403);
  assert.equal((await req(room('start'),{as:users[0].id,method:'POST',data:{}})).status,200);
  const inProgress=await req(room(''),{as:users[0].id});assert.equal(inProgress.data.status,'active');assert.equal(inProgress.data.current.number,1);assert.equal(JSON.stringify(inProgress.data).includes('Option B is correct.'),false);assert.equal(inProgress.data.current.answer,undefined);
  assert.equal((await req(room('answer'),{as:users[2].id,method:'POST',data:{answer:1}})).status,403);
  const suggested=await req(room('suggest'),{as:users[2].id,method:'POST',data:{answer:1}});
  assert.equal(suggested.status,200);
  assert.ok(suggested.data.room.suggestions.some(x=>x.answer===1));
  const submitted=await req(room('answer'),{as:users[0].id,method:'POST',data:{answer:1}});
  assert.equal(submitted.status,200);
  assert.equal(submitted.data.room.myAnswer,1);
  assert.equal(submitted.data.room.current.answer,undefined);
  assert.equal((await req(room('answer'),{as:users[0].id,method:'POST',data:{answer:1}})).status,409);
  assert.equal((await req(room('answer'),{as:users[1].id,method:'POST',data:{answer:2}})).status,200);
  const scored=await req(room(''),{as:users[0].id});assert.equal(scored.data.teams.A.score,10);assert.equal(scored.data.teams.B.score,0);
  // Admin moderation must not be accessible to students.
  assert.equal((await req('/api/admin/battle/rooms',{as:users[0].id})).status,401);
  const admin=await req(`/api/admin/battle/rooms/${id}`);assert.equal(admin.data.messages.length,1);
  const removed=await req(`/api/admin/battle/rooms/${id}/messages/${admin.data.messages[0].id}`,{method:'DELETE'});assert.equal(removed.status,200);
  assert.equal((await req(room('chat'),{as:users[0].id})).data.length,0);
  // No sleeping 150 seconds: test the server clock change and missed deadlines.
  const originalNow=Date.now, future=Number(inProgress.data.deadline)+5*30000+1000;
  try{Date.now=()=>future;const finished=await req(room(''),{as:users[0].id});assert.equal(finished.data.status,'finished');assert.equal(finished.data.winner,'A');assert.equal(finished.data.history.length,5);assert.equal(finished.data.history[0].answer,1);assert.equal((await req(room('answer'),{as:users[0].id,method:'POST',data:{answer:1}})).status,409);}finally{Date.now=originalNow;}
  const ranking=await req('/api/battle/leaderboard',{as:users[0].id});assert.ok(ranking.data.some(row=>row.wins===1));
});

test('restricted content rules remain distinct from freely accessible Battle Arena',async()=>{
  assert.equal((await req('/api/battle/catalog',{as:users[4].id})).status,200);
  assert.equal((await req('/api/battle/catalog',{as:'unknown-student'})).status,401);
  const add=await req('/api/admin/battle/questions',{method:'POST',data:{...question(6),answer:9}});assert.equal(add.status,400);
});

test('document extraction: reviewed CSV answers and safe question editing preserve uploaded diagram links',async()=>{
  const csv='question,optiona,optionb,optionc,optiond,answer,topic,explanation\n"What is 2, plus 2?",1,3,4,5,C,Arithmetic,"Two plus two is four."\nWhat is x?,A,B,C,D,,Algebra,Unknown\n';
  const source=Buffer.from(csv);
  const init=await req('/api/admin/upload/init',{method:'POST',data:{fileName:'battle-sample.csv',size:source.length,chunkSize:source.length,contentType:'text/csv'}});
  assert.equal(init.status,200,JSON.stringify(init.data));
  const chunk=await req('/api/admin/upload/chunk',{method:'POST',data:{uploadId:init.data.uploadId,index:0,data:source.toString('base64')}});
  assert.equal(chunk.status,200,JSON.stringify(chunk.data));
  const done=await req('/api/admin/upload/complete',{method:'POST',data:{uploadId:init.data.uploadId,parts:1}});
  assert.equal(done.status,200,JSON.stringify(done.data));
  const extracted=await req('/api/admin/battle/extract',{method:'POST',data:{fileKey:done.data.fileKey,fileName:'battle-sample.csv',subject:'Economics',topic:'General'}});
  assert.equal(extracted.status,200,JSON.stringify(extracted.data));
  assert.equal(extracted.data.questions.length,2);
  assert.equal(extracted.data.questions[0].q,'What is 2, plus 2?');
  assert.equal(extracted.data.questions[0].answer,2);
  assert.equal(extracted.data.questions[1].needsReview,true);
  const reviewed=extracted.data.questions.map(q=>({...q,answer:q.needsReview?0:q.answer,needsReview:false}));
  const imported=await req('/api/admin/battle/import',{method:'POST',data:{questions:reviewed}});
  assert.equal(imported.status,201,JSON.stringify(imported.data));assert.equal(imported.data.imported,2);
  const saved=await req('/api/admin/battle/questions?search=What%20is%202');
  assert.equal(saved.status,200);assert.equal(saved.data[0].answer,2);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/jDkAAAAASUVORK5CYII=','base64');
  const pngInit=await req('/api/admin/upload/init',{method:'POST',data:{fileName:'battle-diagram.png',size:png.length,chunkSize:png.length,contentType:'image/png'}});
  assert.equal(pngInit.status,200);
  assert.equal((await req('/api/admin/upload/chunk',{method:'POST',data:{uploadId:pngInit.data.uploadId,index:0,data:png.toString('base64')}})).status,200);
  const pngDone=await req('/api/admin/upload/complete',{method:'POST',data:{uploadId:pngInit.data.uploadId,parts:1}});
  assert.equal(pngDone.status,200);
  const imageRef='/api/files/'+encodeURIComponent(pngDone.data.fileKey);
  const edit=await req('/api/admin/battle/questions/'+saved.data[0].id,{method:'PATCH',data:{imageRefs:[imageRef],explanation:'Updated'}});
  assert.equal(edit.status,200,JSON.stringify(edit.data));assert.ok(edit.data.imageRefs.includes(imageRef));
  const editAgain=await req('/api/admin/battle/questions/'+saved.data[0].id,{method:'PATCH',data:{explanation:'Updated again'}});
  assert.equal(editAgain.status,200);assert.ok(editAgain.data.imageRefs.includes(imageRef));
});

test('unequal-team results are separate from default balanced leaderboard and matches can be rematched',async()=>{
  const soloA=await req('/api/battle/teams',{as:users[4].id,method:'POST',data:{name:'Solo Lightning',logo:'lightning'}});
  const soloB=await req('/api/battle/teams',{as:users[5].id,method:'POST',data:{name:'Solo Eagle',logo:'eagle'}});
  assert.equal(soloA.status,201);assert.equal(soloB.status,201);
  const create=await req('/api/battle/create',{as:users[4].id,method:'POST',data:{subject:'Economics',topic:'Demand',format:'1v1',questionCount:5,title:'Rematch challenge',teamId:soloA.data.id,opponentCode:soloB.data.code}});
  assert.equal(create.status,201,JSON.stringify(create.data));const id=create.data.id;
  const room=action=>`/api/battle/rooms/${id}/${action}`;
  assert.equal((await req(room('respond'),{as:users[5].id,method:'POST',data:{accept:true}})).status,200);
  for(const u of users.slice(4,6))assert.equal((await req(room('ready'),{as:u.id,method:'POST',data:{ready:true}})).status,200);
  assert.equal((await req(room('start'),{as:users[4].id,method:'POST',data:{}})).status,200);
  const playing=await req(room(''),{as:users[4].id});const now=Date.now;
  try{Date.now=()=>Number(playing.data.deadline)+5*30000+3000;assert.equal((await req(room(''),{as:users[4].id})).data.status,'finished');}finally{Date.now=now;}
  const rematch=await req(room('rematch'),{as:users[4].id,method:'POST',data:{}});
  assert.equal(rematch.status,201,JSON.stringify(rematch.data));assert.notEqual(rematch.data.room.id,id);assert.notEqual(rematch.data.room.code,create.data.code);
  assert.equal(rematch.data.room.teams.A.ready.length,0);assert.equal(rematch.data.room.teams.B.ready.length,0);
  assert.equal((await req('/api/battle/leaderboard?mode=balanced',{as:users[0].id})).status,200);
  assert.equal((await req('/api/battle/leaderboard?mode=all',{as:users[0].id})).status,200);
});

test('topics are reserved for progress tracking while publishing uses subjects directly',async()=>{
 const created=await req('/api/admin/topics',{method:'POST',data:{subject:'Economics',name:'Market Equilibrium'}});
 assert.equal(created.status,201,JSON.stringify(created.data));
 const topicId=created.data.id;
 const catalog=await req('/api/battle/catalog',{as:users[0].id});
 assert.ok(catalog.data.subjects.includes('Economics'));
 assert.deepEqual(catalog.data.topics,[]);
 const note=await req('/api/admin/notes',{method:'POST',data:{subject:'Economics',title:'Equilibrium notes',body:'Demand meets supply.',published:true}});
 assert.equal(note.status,200,JSON.stringify(note.data));
 assert.equal(note.data.topicId,'');assert.equal(note.data.collectionId,undefined);
 const cbt=await req('/api/admin/cbt-tests',{method:'POST',data:{subject:'Economics',title:'Equilibrium CBT',writeup:'Market concepts',published:true}});
 assert.equal(cbt.status,201,JSON.stringify(cbt.data));assert.equal(cbt.data.collectionId,undefined);
 const video=await req('/api/admin/videos',{method:'POST',data:{subject:'Economics',title:'Economics video',youtubeUrl:'https://www.youtube.com/watch?v=abc123DEF89',published:true}});
 assert.equal(video.status,201,JSON.stringify(video.data));assert.equal(video.data.collectionId,undefined);
 assert.equal((await req('/api/admin/material-collections',{method:'POST',data:{subject:'Economics',name:'Unwanted'}})).status,404);
 // The current product rule deliberately prevents admins changing free accounts' subjects.
 const forbiddenAdmin=await req('/api/admin/students/'+users[0].id,{method:'PATCH',data:{selectedSubjects:['Use of English','Economics']}});
 assert.equal(forbiddenAdmin.status,403);
 const assign=await req('/api/me',{as:users[0].id,method:'PATCH',data:{selectedSubjects:['Use of English','Economics']}});assert.equal(assign.status,200);
 assert.ok((await req('/api/materials',{as:users[0].id})).data.some(x=>x.id===note.data.id));
 assert.ok((await req('/api/cbt-tests',{as:users[0].id})).data.some(x=>x.id===cbt.data.id));
 assert.ok((await req('/api/videos',{as:users[0].id})).data.some(x=>x.id===video.data.id));
 const economics=(await req('/api/admin/subjects')).data.find(x=>x.name==='Economics');
 assert.equal((await req('/api/admin/subjects/'+economics.id,{method:'DELETE'})).status,409);
 assert.equal((await req('/api/admin/topics/'+topicId,{method:'PATCH',data:{name:'Market Clearing'}})).status,200);
 assert.equal((await req('/api/admin/topics/'+topicId,{method:'DELETE'})).status,200);
 assert.ok((await req('/api/admin/notes')).data.some(x=>x.id===note.data.id));
});

test('CBT tests, learning materials and videos remain independent after editing',async()=>{
 const cbt=await req('/api/admin/cbt-tests',{method:'POST',data:{subject:'Economics',title:'Markets test',linkUrl:'https://example.org/quiz',published:true,accessLevel:'restricted'}});
 assert.equal(cbt.status,201);
 const video=await req('/api/admin/videos',{method:'POST',data:{subject:'Economics',title:'Markets video',youtubeUrl:'https://www.youtube.com/watch?v=AbcDeFgHi12',published:true}});
 assert.equal(video.status,201);
 const note=await req('/api/admin/notes',{method:'POST',data:{subject:'Economics',title:'Markets in November',body:'A detailed Economics note.',published:true}});
 assert.equal(note.status,200);
 assert.equal((await req('/api/admin/cbt-tests/'+cbt.data.id,{method:'PATCH',data:{title:'Markets exam'}})).status,200);
 assert.equal((await req('/api/admin/videos/'+video.data.id,{method:'PATCH',data:{title:'Markets video updated'}})).status,200);
 assert.equal((await req('/api/admin/notes/'+note.data.id,{method:'PATCH',data:{title:'Markets note updated'}})).status,200);
 assert.equal((await req('/api/admin/notes')).data.find(x=>x.id===note.data.id).title,'Markets note updated');
 assert.equal((await req('/api/admin/cbt-tests')).data.find(x=>x.id===cbt.data.id).title,'Markets exam');
 assert.equal((await req('/api/admin/videos')).data.find(x=>x.id===video.data.id).title,'Markets video updated');
});

test('Battle Arena math uses the common KaTeX-capable renderer for bare LaTeX and formulas',async()=>{
  const vm=await import('node:vm');
  const script=await fs.readFile(new URL('../public/gb-ui.js',import.meta.url),'utf8');
  const context={window:{katex:{renderToString:(tex)=>`<math>${tex}</math>`}},document:{addEventListener(){}},URL,console};
  vm.runInNewContext(script,context);
  const result=context.window.GBUI.mathHtml(String.raw`Find \frac{3}{4} and \sqrt{16}`);
  assert.match(result,/<math>/);assert.ok(!result.includes('\\frac{3}{4} and'));
  const student=await fs.readFile(new URL('../public/battle.js',import.meta.url),'utf8');
  assert.match(student,/GBUI\.mathHtml/);assert.match(student,/typeset\(q\.q\)/);assert.match(student,/typeset\(option\)/);
});

test('simultaneous opponent answers are both preserved in shared room state',async()=>{
  const a=(await req('/api/battle/teams',{as:users[4].id,method:'POST',data:{name:'Concurrent Blue',logo:'lion'}})).data;
  const b=(await req('/api/battle/teams',{as:users[5].id,method:'POST',data:{name:'Concurrent Red',logo:'wolf'}})).data;
  const creation=await req('/api/battle/create',{as:users[4].id,method:'POST',data:{subject:'Economics',topic:'Demand',format:'1v1',questionCount:5,teamId:a.id,opponentCode:b.code}});
  assert.equal(creation.status,201,JSON.stringify(creation.data));const id=creation.data.id;
  const act=action=>`/api/battle/rooms/${id}/${action}`;
  assert.equal((await req(act('respond'),{as:users[5].id,method:'POST',data:{accept:true}})).status,200);
  for(const u of users.slice(4,6))assert.equal((await req(act('ready'),{as:u.id,method:'POST',data:{ready:true}})).status,200);
  assert.equal((await req(act('start'),{as:users[4].id,method:'POST',data:{}})).status,200);
  const both=await Promise.all(users.slice(4,6).map(u=>req(act('answer'),{as:u.id,method:'POST',data:{answer:1}})));
  assert.deepEqual(both.map(r=>r.status),[200,200],JSON.stringify(both));
  const roomA=await req(act(''),{as:users[4].id});const roomB=await req(act(''),{as:users[5].id});
  assert.notEqual(roomA.data.myAnswer,null,'Team A answer was overwritten by another submitter');
  assert.notEqual(roomB.data.myAnswer,null,'Team B answer was overwritten by another submitter');
  assert.equal(roomA.data.teams.A.score,roomB.data.teams.B.score);
  const chats=await Promise.all(users.slice(4,6).map((u,i)=>req(act('chat'),{as:u.id,method:'POST',data:{text:'Concurrent team message '+i}})));
  assert.deepEqual(chats.map(r=>r.status),[201,201]);
  const chatA=await req(act('chat'),{as:users[4].id}),chatB=await req(act('chat'),{as:users[5].id});
  assert.equal(chatA.data.at(-1).text,'Concurrent team message 0');
  assert.equal(chatB.data.at(-1).text,'Concurrent team message 1');
});
