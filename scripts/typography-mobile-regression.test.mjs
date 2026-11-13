import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const pub=path.join(root,'public');
const read=n=>fs.readFileSync(path.join(pub,n),'utf8');
const pages=fs.readdirSync(pub).filter(x=>x.endsWith('.html'));
const fontURL='https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap';
test('all EduSpace pages share the new web-font, final mobile sheet and preconnects',()=>{
  assert.equal(pages.length,24);
  for(const page of pages){
    const html=read(page);
    assert.ok(html.includes(fontURL),page+' missing web-font');
    assert.ok(html.includes('https://fonts.gstatic.com'),page+' missing preconnect');
    assert.ok(html.includes('/typography.css?v=12.21.0'),page+' missing mobile CSS');
    assert.ok(html.indexOf('/typography.css?v=12.21.0')<html.indexOf('</head>'),page+' CSS placed outside head');
  }
});
test('modern sans-serif font is used consistently without changing maths or monospace',()=>{
  const base=read('styles.css');
  const type=read('typography.css');
  assert.match(base,/--gb-font:'Plus Jakarta Sans'/);
  assert.match(type,/font-family: var\(--gb-font\)/);
  assert.match(base,/pre,code,kbd,samp,\.monospace\{font-family:ui-monospace/);
  assert.match(base,/\.katex,\.katex \*\{font-family:KaTeX_Main/);
  assert.ok(!base.includes('Baskervville'));
});
test('phone sizing is compact and controls remain zoom-friendly',()=>{
  const t=read('typography.css');
  assert.match(t,/@media \(max-width: 600px\)/);
  assert.match(t,/html \{ font-size: 15px; \}/);
  assert.match(t,/font-size: 16px !important/);
  assert.doesNotMatch(t,/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/);
  assert.match(read('sw.js'),/MIN_RUNTIME_VERSION="12\.18\.0"/);
  assert.match(read('sw.js'),/"\/typography\.css"/);
});
test('project never distributes font binaries',()=>{
  const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
  assert.deepEqual(walk(root).filter(f=>/\.(woff2?|ttf|otf)$/i.test(f)),[]);
});
