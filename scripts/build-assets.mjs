/* Publish root-level design assets to EdgeOne static output. */
import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const source=path.join(root,'assets');
const target=path.join(root,'public','assets');
if(!fs.existsSync(source)) throw Error('Missing root assets folder. Restore it before deploying.');
if(!fs.existsSync(path.join(source,'logo-full.png')) || !fs.existsSync(path.join(source,'avatars','scholar-01.png')) || !fs.existsSync(path.join(source,'battle','lion.png'))) {
  throw Error('Root assets are incomplete. No deployment output was written.');
}
fs.rmSync(target,{recursive:true,force:true});
fs.cpSync(source,target,{recursive:true});
const expected=[...fs.readdirSync(path.join(source,'avatars')).filter(f=>f.endsWith('.png')).map(f=>'avatars/'+f),...fs.readdirSync(path.join(source,'battle')).filter(f=>f.endsWith('.png')).map(f=>'battle/'+f),...fs.readdirSync(path.join(source,'subject-cover')).filter(f=>f.endsWith('.png')).map(f=>'subject-cover/'+f)];
for(const relative of expected){const file=path.join(target,relative);if(!fs.existsSync(file)||fs.statSync(file).size===0)throw Error('Image missing from public output: '+relative)}
console.log('Published '+expected.length+' checked image assets to public/assets/ for EdgeOne.');
