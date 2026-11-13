import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8');
const admin=read('public/admin.html'),api=read('node-functions/lib/api-core.js'),cbt=read('public/cbt.html');
test('CBT editor supports separate, editable assessment and performance URLs',()=>{
 for(const id of ['cbtLinkUrl','cbtLinkLabel','cbtPerformanceUrl','cbtPerformanceLabel']) assert.ok(admin.includes(`id="${id}"`),id);
 assert.match(admin,/performanceUrl:\$\("cbtPerformanceUrl"\)\.value\.trim\(\)/);
 assert.match(admin,/performanceLabel:\$\("cbtPerformanceLabel"\)\.value\.trim\(\)/);
 assert.match(admin,/\$\("cbtPerformanceUrl"\)\.value=t\.performanceUrl\|\|""/);
});
test('Students get an optional second CTA, with different text and independent URL',()=>{
 assert.match(cbt,/const performanceHref=testUrl\(t\.performanceUrl\)/);
 assert.match(cbt,/cbt-card-performance/);
 assert.match(cbt,/Check Performance/);
 assert.match(cbt,/!locked&&performanceHref/);
 assert.match(cbt,/href="\$\{esc\(performanceHref\)\}" target="_blank" rel="noopener noreferrer"/);
});
test('Server validates performance URLs and never reveals them to free students when locked',()=>{
 assert.match(api,/performanceUrl: locked \? "" : \(t\.performanceUrl \|\| ""\)/);
 assert.match(api,/performanceLabel: locked \? ""/);
 assert.match(api,/Performance link must start with http:\/\/ or https:\/\//);
 assert.match(api,/t\.performanceUrl = performanceUrl/);
});
test('Old data remains compatible while resource sections expose no folder metadata',()=>{
 assert.match(api,/performanceUrl: cleanString\(x\.performanceUrl \|\| "", 1000\)/);
 assert.match(api,/locked \? "" : \(t\.performanceUrl \|\| ""\)/);
 assert.doesNotMatch(api,/p === "\/api\/material-collections"/);
 assert.doesNotMatch(read('public/materials.html'),/material-collection-card/);
});
test('Source assets are outside public and build pipeline publishes necessary files',()=>{
 assert.ok(fs.existsSync('assets/battle/lion.svg'));
 assert.ok(fs.existsSync('assets/avatars/scholar-01.png'));
 assert.match(read('edgeone.json'),/scripts\/build-assets\.mjs/);
 assert.match(read('scripts/build-assets.mjs'),/fs\.cpSync\(source,target/);
 for(let i=1;i<=24;i++)assert.ok(fs.existsSync(`assets/avatars/scholar-${String(i).padStart(2,'0')}.png`));
});
