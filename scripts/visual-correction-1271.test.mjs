import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const file=n=>fs.readFileSync(new URL('../public/'+n,import.meta.url),'utf8');
test('video cards render actual youtube thumbnail (never a generic logo)',()=>{
 const html=file('videos.html');
 assert.match(html,/https:\/\/i\.ytimg\.com\/vi\/\$\{id\}\/hqdefault\.jpg/);
 assert.doesNotMatch(html,/subject-cover\/general|assets\/battle|eduspace-crown/);
 assert.match(html,/host==="youtu.be"/);assert.match(html,/url\.searchParams\.get\("v"\)/);
});
test('CBT cards only use subject icon and uniform brand blue',()=>{
 const html=file('cbt.html'),css=file('cbt-cards.css');
 assert.match(html,/class="cbt-cover-icon" aria-hidden="true">\$\{icon\}<\/span>/);
 assert.doesNotMatch(html,/assets\/battle\/|cbt-subject-art|subjectArt\(subject\)/);
 assert.match(css,/#0b2d5c/);assert.match(css,/data-variant="1"/);
});
