import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const html=fs.readFileSync(new URL('../public/cbt.html',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/cbt-cards.css',import.meta.url),'utf8');
const sw=fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
test('CBT library uses illustrated, responsive cards rather than raw links',()=>{
  for(const part of ['cbt-page-intro','cbt-card-cover','cbt-cover-illustration','cbt-card-action','cbt-grid'])
    assert.ok(html.includes(part)||css.includes(part),part);
  assert.match(css,/grid-template-columns:repeat\(auto-fill,minmax\(min\(100%,275px\),1fr\)\)/);
  assert.match(css,/@media\(max-width:440px\)/);
});
test('CBT test links retain the original Assessment Hub destination and are protocol-checked',()=>{
  assert.match(html,/testUrl\(t\.linkUrl\)/);
  assert.match(html,/\["http:","https:"\]\.includes\(url\.protocol\)/);
  assert.match(html,/href="\$\{esc\(href\)\}" target="_blank" rel="noopener noreferrer"/);
  assert.match(html,/esc\(t\.linkLabel\|\|"Start Assessment"\)/);
});
test('legacy locked cards remain safe while server hides premium tests from the Public space',()=>{
  assert.match(html,/const locked=!!t\.locked/);
  assert.match(html,/data-cbt-premium/);
  assert.match(html,/GBPremium\.show\("CBT test",t\.title\)/);
  assert.match(html,/locked\?"Activated account required"/);
});
test('subject filtering, search and no-matches state remain present',()=>{
  assert.match(html,/renderTabs\(\)/);
  assert.match(html,/matchesSearch\(t\)/);
  assert.match(html,/No CBT tests match your search/);
  assert.match(html,/cbtTestCount/);
  assert.match(html,/current==="All"\?"All CBT tests"/);
});
test('CBT cards use subject icons and no badge/art logos while offline CSS remains cached',()=>{
  assert.match(html,/class="cbt-cover-icon" aria-hidden="true">\$\{icon\}<\/span>/);
  assert.doesNotMatch(html,/assets\/battle\/crown\.png|cbt-subject-art|subjectArt\(subject\)/);
  assert.match(sw,/"\/cbt-cards\.css"/);
  assert.match(sw,/MIN_RUNTIME_VERSION="12\.21\.0"/);
});
