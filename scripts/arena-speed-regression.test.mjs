import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../public/battle.js',import.meta.url),'utf8');
const core=fs.readFileSync(new URL('../node-functions/lib/api-core.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/battle.html',import.meta.url),'utf8');
const sw=fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');

test('Arena post actions use confirmed server state instead of a compulsory second GET',()=>{
  assert.match(js,/if\(result\.room&&action!=="rematch"\)showRoom\(result\.room\)/);
  assert.match(core,/battleConfirmedRoom/);
  assert.match(core,/submitted:true,room:battleConfirmedRoom/);
  assert.match(core,/message:\{id:message\.id,studentName:/);
});

test('Outgoing Arena messages appear immediately with server acknowledgement and retry-on-error input',()=>{
  assert.match(js,/pendingChat=key;room\.chat=/);
  assert.match(js,/renderChat\(room\.chat\);\s*input\.value=""/);
  assert.match(js,/const reply=await roomAction\("chat",\{text\}\)/);
  assert.match(js,/if\(!input\.value\.trim\(\)\)input\.value=text/);
});

test('Active Arena polls do not overlap, use adaptive cadence and avoid re-rendering unchanged rosters',()=>{
  assert.match(js,/if\(!roomId\|\|polling\|\|document\.hidden\)return/);
  assert.match(js,/2500:room\?\.status==="waiting"\?4000/);
  assert.match(js,/if\(teamViewKey!==teamsKey\)/);
  assert.match(js,/if\(resultViewKey!==resultsKey\)/);
  assert.doesNotMatch(js,/setInterval\(\(\)=>\{if\(roomId&&!document\.hidden\)refreshRoom\(\)\},5000\)/);
});

test('Team browsing lives on its own page; requests debounce and stale results are ignored',()=>{
  const directory=fs.readFileSync(new URL('../public/explore-teams.js',import.meta.url),'utf8');
  assert.match(html,/href="\/explore-teams\.html"/);
  assert.match(directory,/clearTimeout\(timer\);timer=setTimeout\(load,330\)/);
  assert.match(directory,/if\(id!==seq\)return/);
  assert.doesNotMatch(html,/id="exploreTeamList"/);
});

test('New version busts browser caches without changing CBT or video design',()=>{
  assert.match(html,/battle\.js\?v=12\.21\.0/);
  assert.match(sw,/MIN_RUNTIME_VERSION="12\.21\.0"/);
  const cbt=fs.readFileSync(new URL('../public/cbt.html',import.meta.url),'utf8');
  const videos=fs.readFileSync(new URL('../public/videos.html',import.meta.url),'utf8');
  assert.match(cbt,/class="cbt-cover-icon" aria-hidden="true">\$\{icon\}<\/span>/);
  assert.match(videos,/ytimg\.com|youtubeThumbnail|thumbnailUrl|youtube\.com/);
});
