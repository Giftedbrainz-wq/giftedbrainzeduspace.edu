import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
test('welcome and homepage omit unwanted prompts and visible phone',()=>{
 const h=read('public/index.html');
 assert.doesNotMatch(h,/id=["']gbSkipIntro["']/);assert.doesNotMatch(h,/id=["']install["']/);
 assert.doesNotMatch(h,/Need Help/i);assert.match(h,/Detailed Tutorial/i);
});
test('signup name suggestion and secure remembered session endpoints exist',()=>{
 const ui=read('public/auth-forms.js'),api=read('node-functions/lib/api-core.js');
 assert.match(ui,/rememberDevice/);assert.match(api,/\/api\/auth\/refresh/);
 assert.match(api,/HttpOnly; Secure; SameSite=Strict/);assert.match(api,/\/api\/auth\/logout/);
 assert.match(ui,/email/i);
});
test('help support standalone and contact number absent from markup',()=>{
 const h=read('public/help.html');assert.match(h,/Contact Administrator/);
 assert.doesNotMatch(h,/(?:234|\+234)8156767275/);
 assert.match(read('node-functions/lib/api-core.js'),/\/api\/support\/whatsapp/);
});
test('private messaging has no reactions or deleted placeholders in visible conversation',()=>{
 const chat=read('public/study-chat.js');
 assert.doesNotMatch(chat,/data-action="react"/);
 assert.match(chat,/messages\.filter\(m=>!m\.deletedAt\)/);
 assert.match(chat,/data-action="delete"/);
});
test('online and offline status have correct indicators',()=>{
 const common=read('public/study-messaging-common.js');
 const c=read('public/study-partners.js');
 assert.match(read('public/study-chat.js'),/⚪/);assert.match(read('public/study-chat.js'),/🟢/);
 assert.match(c,/⚪/);
});
test('announcement replies pagination, likes, threading and PDF sizing present',()=>{
 const a=read('public/announcements.html'),core=read('node-functions/lib/api-core.js');
 assert.match(a,/View all/);assert.match(core,/item\.replies\.slice\(0,5\)/);
 assert.match(core,/parentId/);assert.match(core,/\/like/);
 const materials=read('public/materials.html');assert.match(materials,/pdf-page-holder/);
});
test('picture compression and upload guardrails exist',()=>{
 assert.match(read('public/compact-image.js'),/webp/i);
 const core=read('node-functions/lib/api-core.js');assert.match(core,/\/api\/me\/photo/);
 assert.match(core,/\/api\/community-photo/);assert.match(core,/60000/);
});
test('student plan controls validated by backend',()=>{
 const api=read('node-functions/lib/api-core.js');
 assert.match(api,/selectedSubjects/);assert.match(api,/activated/);
});
