import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const api = read('node-functions/lib/api-core.js');
const admin = read('public/admin.html');
const materials = read('public/materials.html');
const cbt = read('public/cbt.html');
const videos = read('public/videos.html');
const arena = read('public/battle.html');
const battle = read('public/battle.js');
const battleAdmin = read('public/battle-admin.html');
const ui = read('public/gb-ui.js');

test('account tiers default safely and are supported by automatic registration and admin changes', () => {
  assert.match(api, /if \(!\["free", "activated"\]\.includes\(u\.accountType\)\) u\.accountType = "free"/);
  assert.match(api, /approval: "approved", approved: true, avatar:validAvatar\(x\.avatar\), accountType: "free"/);
  assert.match(api, /if \(x\.accountType !== void 0\)/);
  assert.match(admin, /<option value="free"/);
  assert.match(admin, /<option value="activated"/);
  assert.match(admin, /id="freeStudentsList"/);
  assert.match(admin, /id="activatedStudentsList"/);
  assert.match(admin, /data-account-tier/);
});

test('public space excludes premium items and server enforces access to restricted note attachments', () => {
  assert.match(api, /function materialCatalogueItem\(note, user\)/);
  assert.match(api, /if \(!locked\) return \{ \.\.\.note, locked: false \}/);
  assert.match(api, /function spaceAccessLevel\(url, user\)/);
  assert.match(api, /function matchesSpace\(resource, space\)/);
  assert.match(api, /filter\(n => n\.published && allowed\.includes\(n\.subject\) && matchesSpace\(n,space\)\)/);
  assert.match(api, /if \(!space\) return json\(\{ error: "Premium space requires an activated account\." \}, 403\)/);
  assert.match(api, /if \(catalogue\.locked\) return catalogue/);
  assert.match(api, /\.map\(n => materialCatalogueItem\(n, u\)\)/);
  assert.match(api, /if \(!canAccessLevel\(u, n\.accessLevel\)\) return json\(\{ error: "This learning material is reserved for activated accounts/);
  assert.match(api, /if \(protectedNote && !isActivatedAccount\(currentStudent\)\)/);
  assert.match(api, /locked \? "" : t\.linkUrl/);
  assert.match(materials, /data-material-premium/);
  assert.match(cbt, /data-cbt-premium/);
  assert.match(admin, /id="naccess"/);
  assert.match(admin, /id="enAccess"/);
  assert.match(materials, /items\.filter\(m=>m\.accessLevel!=="restricted"&&!m\.locked\)/);
});

test('CBT tests support access tiers and server-side lock metadata; video lessons remain unrestricted', () => {
  assert.match(api, /p === "\/api\/cbt-tests"[\s\S]{0,1000}matchesSpace\(t,space\)/);
  assert.match(api, /accessLevel: x\.accessLevel === "restricted" \? "restricted" : "public"/);
  assert.match(admin, /id="cbtAccessLevel"/);
  assert.match(cbt, /id="testSearch"/);
  assert.match(cbt, /testSearch.*addEventListener\("input"/s);
  const videoRoute = api.slice(api.indexOf('if (m === "GET" && p === "/api/videos")'), api.indexOf('if (m === "GET" && p === "/api/progress")'));
  assert.ok(videoRoute.length > 0);
  assert.doesNotMatch(videoRoute, /canAccessLevel|accessLevel/);
  assert.match(videos, /id="videoSearch"/);
});

test('Scholars Connect is removed and replaced by a private, moderated Battle Arena', () => {
  assert.doesNotMatch(api, /p === "\/api\/connect\/messages"/);
  assert.doesNotMatch(api, /p === "\/api\/admin\/connect\/messages"/);
  assert.match(api, /battleStudentHandler\(request,d,a,p,m,url\)/);
  assert.match(api, /battleAdminHandler\(request,d,p,m,url\)/);
  assert.match(api, /room\.messages\.filter\(x=>x\.side===side\)/);
  assert.match(api, /action==="approve"\|\|action==="decline"/);
  assert.match(api, /action==="answer"/);
  assert.match(api, /BATTLE_QUESTION_SECONDS = 30/);
  assert.match(arena, /id="battleChatForm"/);
  assert.match(arena, /id="joinCode"/);
  assert.match(battle, /request to join/);
  assert.match(battleAdmin, /Match.*Team Chat Moderation/);
  assert.match(ui, /href: "\/battle\.html"/);
  assert.doesNotMatch(ui, /\/scholars-connect\.html/);
});

test('Premium upgrade prompt routes to the correct WhatsApp number and historical sessions are not presented', () => {
  const premiumJs=read('public/premium-access.js');
  const premiumCss=read('public/premium-access.css');
  assert.match(premiumJs,/2348156767275/);
  assert.match(premiumJs,/Contact Administrator/);
  assert.match(premiumJs,/encodeURIComponent\(message\)/);
  assert.match(premiumCss,/gb-premium-whatsapp/);
  assert.match(materials,/premium-access\.js/);
  assert.match(cbt,/premium-access\.js/);
  assert.doesNotMatch(admin,/Practice sessions|Practice submissions|Practice history|\/api\/admin\/results/);
  assert.doesNotMatch(read('public/account.html'),/Practice sessions|practice results/);
  assert.match(admin,/Topics completed/);
  assert.match(read('public/progress.html'),/Browse learning materials/);
  assert.match(read('public/materials.html'),/material-grid/);
  assert.match(read('public/admin.html'),/renderMaterialsBoard/);
  assert.doesNotMatch(read('public/materials.html'),/material-collection-card/);
  assert.doesNotMatch(read('public/admin.html'),/Create Collection/);
});
