import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('.', import.meta.url).pathname, '..');
const mustContain = [
  ['node-functions/lib/api-core.js', 'AsyncLocalStorage'],
  ['node-functions/lib/api-core.js', 'DATA_CACHE_TTL_MS = 300'],
  ['node-functions/lib/api-core.js', 'studentName'],
  ['node-functions/lib/api-core.js', 'releaseUserUniqueKeys'],
  ['node-functions/lib/api-core.js', 'whatsapp'],
  ['public/register.html', 'id="whatsapp"'],
  ['public/admin.html', 'studentName||"Unknown student"'],
  ['public/admin.html', 'wa.me'],
  ['scripts/load-test.mjs', 'requests'],
];
let failures = 0;
for (const [file, needle] of mustContain) {
  const full = path.join(root, file);
  const ok = fs.readFileSync(full, 'utf8').includes(needle);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${file} :: ${needle}`);
  if (!ok) failures++;
}
for (const file of ['node-functions/lib/api-core.js','node-functions/api/index.js','node-functions/api/[[default]].js','node-functions/api/ping.js','scripts/load-test.mjs']) {
  const full = path.join(root,file);
  const text = fs.readFileSync(full,'utf8');
  if (/REQUEST_ENV\s*=|REQUEST_CLIENT_IP\s*=|globalThis\.__gbEnv\s*=|globalThis\.__gbClientIp\s*=/.test(text)) {
    console.log(`FAIL request-global-state ${file}`); failures++;
  } else console.log(`PASS request-global-state ${file}`);
}
const adminPath = path.join(root, 'public/admin.html');
const adminHtml = fs.readFileSync(adminPath, 'utf8');
const staleAdminUpdateCall = /\["Application update status",\s*update\]/.test(adminHtml);
console.log(`${staleAdminUpdateCall?'FAIL':'PASS'} admin startup has no stale undefined update() call`);
if (staleAdminUpdateCall) failures++;
const markupOnly = adminHtml.split('<script src="/app.js')[0];
const viewSections = new Set([...markupOnly.matchAll(/id="v-([a-z]+)"/g)].map(m => m[1]));
const quickLinks = new Set([...markupOnly.matchAll(/data-admin-view="([a-z]+)"/g)].map(m => m[1]));
const requiredViews = new Set(['overview','verify','students','materials','topics','cbt','videos','connect','ann','feedback','account']);
const missingSections = [...requiredViews].filter(v => !viewSections.has(v));
const missingQuickLinks = [...requiredViews].filter(v => v !== 'overview' && !quickLinks.has(v));
const navComplete = missingSections.length === 0 && missingQuickLinks.length === 0;
console.log(`${navComplete?'PASS':'FAIL'} admin navigation and dashboard shortcuts cover all sections`);
if (!navComplete) { console.error({missingSections, missingQuickLinks}); failures++; }
const staticIds = [...markupOnly.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const duplicateIds = [...new Set(staticIds.filter((id, i) => staticIds.indexOf(id) !== i))];
console.log(`${duplicateIds.length?'FAIL':'PASS'} admin markup has unique static IDs`);
if (duplicateIds.length) { console.error(duplicateIds); failures++; }
const zipSafe = !fs.existsSync(path.join(root,'.env'));
console.log(`${zipSafe?'PASS':'FAIL'} no .env committed in package`); if(!zipSafe) failures++;
process.exit(failures ? 1 : 0);
