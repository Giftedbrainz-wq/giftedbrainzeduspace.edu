import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('The shared EduSpace type token now uses Plus Jakarta Sans',()=>{
  const css=read('public/styles.css');assert.match(css,/--gb-font:'Plus Jakarta Sans',system-ui/);
  assert.match(css,/html,body,button,input,select,textarea,option\{font-family:var\(--gb-font\)!important\}/);
});
test('Study Partners has one Explore Students button, not a bulky auto-loaded directory',()=>{
  const html=read('public/study-partners.html'),js=read('public/study-partners.js');
  assert.match(html,/href="\/explore-students\.html"/);assert.doesNotMatch(html,/id="exploreStudents"/);
  assert.doesNotMatch(js,/void explore\(true\)/);
  const directory=read('public/explore-students.html'),code=read('public/explore-students.js');
  assert.match(directory,/id="studentSearch"/);assert.match(code,/data-request=/);assert.match(code,/Request Partnership/);
});
test('Explore Teams has a separate page; only online teams appear',()=>{
  const html=read('public/battle.html'),dir=read('public/explore-teams.html'),code=read('node-functions/lib/api-core.js');
  assert.match(html,/href="\/explore-teams\.html"/);assert.doesNotMatch(html,/id="exploreTeamList"/);
  assert.match(dir,/id="teamDirectory"/);assert.match(code,/leaderOnline/);assert.match(code,/Date\.now\(\)-120000/);
  assert.match(code,/const BATTLE_ROOM_TTL = 15 \* 60 \* 1000/);
  assert.match(code,/const BATTLE_TEAM_IDLE_TTL = 15 \* 60 \* 1000/);
  assert.match(read('public/battle.js'),/data-nullify-team/);
});
test('Student announcement replies are shared and HTML escaped',()=>{
  const html=read('public/announcements.html'),code=read('node-functions/lib/api-core.js');
  assert.match(html,/announcement-reply-form/);assert.match(html,/GBUI\.esc\(r\.message\|\|''\)/);
  assert.match(code,/replies"\]/);assert.match(code,/m==="POST" && \/\^\\\/api\\\/announcements/);
  assert.match(code,/item\.published/);
});
test('New discovery pages and scripts are cached with the v12.21.0 service worker',()=>{
  const sw=read('public/sw.js');for(const file of ['/explore-students.html','/explore-teams.html','/explore-students.js','/explore-teams.js','/discovery.css'])assert.ok(sw.includes(file),file);
  assert.match(sw,/MIN_RUNTIME_VERSION="12\.18\.0"/);
});
