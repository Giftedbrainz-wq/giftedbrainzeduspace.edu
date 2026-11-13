import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');const read=p=>fs.readFileSync(path.join(root,'public',p),'utf8');
test('Study Partners uses separate private chat and community screens without duplicated bulky lists',()=>{
 const list=read('study-partners.html'),chat=read('study-chat.html'),communities=read('study-communities.html');
 assert.match(list,/id="chatList"/);assert.match(list,/id="partnerRequests"/);assert.match(list,/explore-students.html/);
 assert.match(chat,/id="chatHistory"/);assert.match(chat,/id="chatForm"/);assert.match(communities,/id="communityCards"/);
 for(const file of ['study-partners.html','study-chat.html','study-communities.html']){
  assert.match(read(file),/Plus\+Jakarta\+Sans/);assert.match(read(file),/mobile-polish.css\?v=12\.18\.0/);
 }
});
test('Message timestamps, date dividers, message deletion and read receipts have UI handlers',()=>{
 const js=read('study-chat.js'),common=read('study-messaging-common.js');
 assert.match(common,/toLocaleTimeString/);assert.doesNotMatch(common,/second:\s*'numeric'/);
 assert.match(common,/Yesterday/);assert.match(js,/data-action="edit"/);assert.match(js,/data-action="reply"/);
 assert.match(js,/data-action="delete"/);assert.doesNotMatch(js,/data-action="react"/);assert.match(js,/readAt/);
 assert.match(js,/class="seen"/);assert.match(read('study-messaging.css'),/\.seen/);
});
test('mobile header and announcement thread fit small screens without giant reply button',()=>{
 const css=read('mobile-polish.css');assert.match(css,/@media\(max-width:700px\)/);
 assert.match(css,/\.topbar \.topbar-right\{[^}]*width:auto!important/);
 assert.match(css,/\.announcement-reply-form\{display:grid!important/);
 assert.match(css,/\.announcement-reply-form button\{width:auto!important/);
 assert.match(read('announcements.html'),/Student replies/);
});
test('messaging asset list and service worker cache version updated',()=>{
 const sw=read('sw.js');assert.match(sw,/MIN_RUNTIME_VERSION="12\.18\.0"/);
 for(const asset of ['study-chat.html','study-chat.js','study-messaging-common.js','study-communities.html','study-communities.js','mobile-polish.css'])assert.ok(sw.includes('/'+asset),asset);
});
