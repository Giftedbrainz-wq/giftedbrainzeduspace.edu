import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync as read} from 'node:fs';
const txt=file=>read(new URL('../'+file,import.meta.url),'utf8');

test('channel prompt is compact, optional and consistent on all entry routes',()=>{
  const js=txt('public/channel-prompt.js'),css=txt('public/styles.css');
  for(const page of ['index.html','login.html','dashboard.html']){
    const html=txt('public/'+page);
    assert.match(html,/data-channel-prompt="on"/,page);
    assert.match(html,/channel-prompt\.js\?v=12\.18\.0/,page);
  }
  assert.match(js,/whatsapp\.com\/channel\/0029VbC1jX73QxRtsF3Kms3r/);
  assert.match(js,/gbChannelPromptDecisionV1/);
  assert.match(js,/7\*DAY/);
  assert.match(js,/30\*DAY/);
  assert.match(js,/aria-modal="true"/);
  assert.match(js,/data-follow/);
  assert.match(js,/data-dismiss/);
  assert.match(js,/event\.key==='Escape'/);
  assert.match(js,/document\.hidden/);
  assert.match(css,/width:min\(360px,100%\)/);
  assert.match(css,/\.gb-channel-follow\{/);
  assert.doesNotMatch(js,/fetch\(|XMLHttpRequest|team-logo|badge-logo/);
});
test('service worker caches the promotion script without caching private API responses',()=>{
  const sw=txt('public/sw.js');
  assert.match(sw,/"\/channel-prompt\.js"/);
  assert.match(sw,/MIN_RUNTIME_VERSION="12\.18\.0"/);
  assert.match(sw,/concurrency=Math\.min\(8,SHELL\.length\)/);
  assert.match(sw,/u\.pathname\.startsWith\("\/api\/"/);
});
