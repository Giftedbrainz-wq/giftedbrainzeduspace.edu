import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const r=x=>fs.readFileSync(new URL('../'+x,import.meta.url),'utf8');
const api=r('node-functions/lib/api-core.js'), ann=r('public/announcements.html'), admin=r('public/admin.html'), prev=r('public/admin-preview.html'), mat=r('public/materials.html');
test('mobile materials cards have curved edges',()=>{
 assert.match(mat,/\.mat-folio[^\{]*\{[^\}]*border-radius/s);
});
test('student reply delete enforces ownership and admin delete has separate privileged route',()=>{
 assert.match(api,/if\(reply\.userId!==u\.id\)return json\(\{error:"You can only delete your own replies\."\},403\)/);
 assert.ok(api.includes('if(m==="DELETE"&&/^\\/api\\/admin\\/announcements'));
 assert.match(ann,/data-delete-reply/);
 assert.match(admin,/adminDelReply/);
});
test('announcement threads retain likes, linking lines and larger red hearts',()=>{
 assert.match(ann,/is-thread-reply/);
 assert.match(ann,/data-like-reply/);
 assert.match(ann,/color:\s*(?:#c[0-9a-f]{5}|#e[0-9a-f]{5}|#d[0-9a-f]{5}|red)|#e[0-9a-f]{5}/i);
});
test('subject catalogue includes previously saved subject references',()=>{
 assert.match(api,/"topics","notes","cbtTests","videos","questionBank"/);
 assert.match(admin,/syncAllSubjects/);
 assert.match(admin,/\/api\/admin\/topics/);
});
test('admin preview route requires admin namespace and remains read-only',()=>{
 assert.match(api,/p==="\/api\/admin\/preview-catalog"/);
 assert.match(admin,/href="\/admin-preview\.html"/);
 assert.match(prev,/read-only|Read-only/);
 assert.match(prev,/\/api\/admin\/preview-catalog/);
 assert.doesNotMatch(prev,/\/api\/admin\/students\/.+PATCH/);
});
