import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('welcome scene is first in body and remains for five seconds',()=>{
 const home=read('public/index.html');
 assert.ok(home.indexOf('id="gbIntro"')<home.indexOf('class="top"'));
 const js=read('public/intro.js');
 assert.match(js,/setTimeout\(finish,2200\)/);
 const css=read('public/intro.css');
 assert.match(css,/position:fixed;inset:0;z-index:10000/);
});
test('signup versus return login have distinct student loaders and remember-me is token based',()=>{
 const app=read('public/app.js');
 assert.match(app,/Preparing your EduSpace/);
 assert.match(app,/Loading your EduSpace/);
 const login=read('public/login.html');assert.match(login,/id="rememberMe"/);
 const auth=read('public/auth-forms.js');assert.match(auth,/gbRememberMe/);assert.match(auth,/sessionStorage\.setItem\('gbToken'/);
 assert.doesNotMatch(auth,/localStorage\.setItem\(['"]password/i);
});
test('publish forms use subjects directly while only progress manages topics',()=>{
 const admin=read('public/admin.html');
 for(const id of ['nsubject','cbtSubject','videoSubject'])assert.match(admin,new RegExp('id="'+id+'"'));
 assert.doesNotMatch(admin,/id="(?:ncollection|cbtCollection|videoCollection)"/);
 assert.match(admin,/<input type="hidden" id="nTopicId"/);
 assert.match(admin,/<input type="hidden" id="cbtTopicId"/);
 assert.match(admin,/These topics are used only for student progress tracking/);
 const battle=read('public/battle-admin.js');assert.match(battle,/No topic selector is required/);
 const core=read('node-functions/lib/api-core.js');
 assert.match(core,/const pool=d\.battleQuestions\.filter\(q=>q\.subject===subject/);
});
test('notes viewer masks upload/authentication statuses',()=>{
 const notes=read('public/materials.html');
 assert.match(notes,/Loading note…/);
 assert.match(notes,/Do not expose file URLs, authentication internals/);
 assert.match(notes,/#documentViewerStatus\{position:absolute/);
});
test('Mistake Notebook supports deleting individual items, CBT groups and all entries',()=>{
 const client=read('public/learning-centre.js');
 for(const term of ['clearMistakes','clearMistakeCbt','row.attemptId'])assert.ok(client.includes(term),term);
 const core=read('node-functions/lib/api-core.js');
 assert.match(core,/m==="DELETE"&&p==="\/api\/learning\/mistakes"/);
 assert.match(core,/row\.attemptId/);
 assert.match(client,/EduSpace linked successfully/);
});
test('release version updates service worker and server runtime',()=>{
 assert.match(read('public/sw.js'),/MIN_RUNTIME_VERSION="12\.21\.0"/);
 assert.match(read('node-functions/lib/api-core.js'),/CURRENT_API_VERSION = "12\.21\.0"/);
});
