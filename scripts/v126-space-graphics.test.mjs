import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const get=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const api=get('node-functions/lib/api-core.js');
const cbt=get('public/cbt.html');
const mats=get('public/materials.html');
const spaces=get('public/learning-spaces.js');

test('public and premium spaces are classified without exposing restricted content',()=>{
  const fnStart=api.indexOf('function isActivatedAccount(user)');
  const fnEnd=api.indexOf('// The following metadata projection protects',fnStart);
  assert.ok(fnStart>=0&&fnEnd>fnStart);
  const context={URL};
  vm.runInNewContext(api.slice(fnStart,fnEnd),context);
  const free={accountType:'free'},active={accountType:'activated'};
  const url=x=>new URL('https://portal.example/api/materials?space='+x);
  assert.equal(vm.runInNewContext('spaceAccessLevel(new URL("https://x/?space=public"), {accountType:"free"})',context),'public');
  assert.equal(vm.runInNewContext('spaceAccessLevel(new URL("https://x/?space=premium"), {accountType:"free"})',context),null);
  assert.equal(vm.runInNewContext('spaceAccessLevel(new URL("https://x/?space=premium"), {accountType:"activated"})',context),'restricted');
  assert.equal(vm.runInNewContext('matchesSpace({accessLevel:"restricted"},"public")',context),false);
  assert.equal(vm.runInNewContext('matchesSpace({accessLevel:"restricted"},"restricted")',context),true);
});
test('student list APIs all filter by selected space on the server',()=>{
  const range=(a,b)=>api.slice(api.indexOf(a),api.indexOf(b,api.indexOf(a)+1));
  assert.match(range('p === "/api/cbt-tests"','p === "/api/videos"'),/matchesSpace\(t,space\)/);
  assert.match(range('p === "/api/notes"','p === "/api/me"'),/matchesSpace\(n,space\)/);
  assert.doesNotMatch(api,/p === "\/api\/material-collections"/);
  assert.match(api,/if \(protectedNote && !isActivatedAccount\(currentStudent\)\)/);
  assert.match(api,/p === "\/api\/learning-space"/);
  assert.match(api,/learningResources\(d,user,space\)/);
  assert.match(api,/x\.published&&allowed\.includes\(x\.subject\)&&matchesSpace\(x,space\)/);
});
test('student UI has isolated spaces; free accounts never get premium tab',()=>{
  assert.match(spaces,/activated \? `<button class="gb-space-tab premium"/);
  assert.match(spaces,/if\(tier !== "activated" && space === "premium"\)space="public"/);
  assert.match(cbt,/api\/cbt-tests\?space=/);
  assert.match(mats,/api\/materials\?space=/);
  assert.doesNotMatch(mats,/api\/material-collections/);
  assert.match(mats,/GBLearningSpaces\.init/);
  assert.match(get('public/sw.js'),/learning-spaces\.js/);
});
test('learning materials have progressive first-page rendering and a graceful separate-view option',()=>{
  assert.match(mats,/await renderPage\(0\)/);
  assert.match(mats,/IntersectionObserver/);
  assert.match(mats,/id="documentOpenSeparate"/);
  assert.match(mats,/setTimeout\(\(\)=>complete\(false\),5000\)/);
  assert.match(mats,/Learning materials could not be loaded/);
});
test('all premium graphics are packaged locally and referenced as browser-safe images',()=>{
  for(const item of ['assets/icon.png','assets/subject-cover/chemistry.png','assets/battle/lion.png','assets/avatars/scholar-01.png']){
    const asset=new URL('../'+item,import.meta.url);
    assert.ok(fs.existsSync(asset),item);
    assert.ok(fs.statSync(asset).size>1000,item+' has no image data');
  }
  assert.match(cbt,/cbt-cover-icon.*\$\{icon\}/);
  assert.doesNotMatch(cbt,/subjectArt\(subject\)|assets\/battle\/crown/);
  assert.match(get('public/battle.js'),/\/assets\/battle\/.*\.png/);
  assert.match(get('public/materials.html'),/material-subject-section/);
  const sw=get('public/sw.js');
  assert.match(sw,/isGraphic/);
  assert.ok(sw.includes('text\\/html|text\\/plain'));
});
