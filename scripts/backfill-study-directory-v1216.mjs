/* v12.16.0: guarded, one-time STAGING directory and moderation backfill.
 * Dry-run by default; never include exported personal data in a release ZIP.
 */
import fs from 'node:fs/promises';
import {createStudyChatStore,chatRoom} from '../node-functions/lib/study-chat-store.js';
const argv=process.argv.slice(2);
const file=argv.find(x=>x.startsWith('--file='))?.slice(7);
if(!file)throw Error('Usage: --file=/secure/offline-export.json [--apply --staging]');
const apply=argv.includes('--apply');
if(apply&&(!argv.includes('--staging')||process.env.GB_STUDY_BACKFILL_TARGET!=='STAGING'))
  throw Error('Backfill writes forbidden unless --apply --staging and GB_STUDY_BACKFILL_TARGET=STAGING.');
const source=JSON.parse(await fs.readFile(file,'utf8'));
const d=source?.data&&Array.isArray(source.data.users)?source.data:source;
if(!Array.isArray(d.users)||!Array.isArray(d.learningPartners)||!Array.isArray(d.learningBlocks))
  throw Error('The offline export lacks users, learningPartners or learningBlocks.');
const users=new Map(d.users.filter(u=>u?.id).map(u=>[u.id,u]));
const pairs=new Set();const duplicate=[];const skipped=[];
for(const p of d.learningPartners){
 if(!users.has(p.from)||!users.has(p.to)||p.from===p.to||!['pending','accepted','declined'].includes(p.status)){
  skipped.push(p.id);continue;
 }
 const key=[p.from,p.to].sort().join('\u0000');
 if(pairs.has(key))duplicate.push(p.id);else pairs.add(key);
}
const blocks=d.learningBlocks.filter(b=>users.has(b.from)&&users.has(b.to)&&b.from!==b.to);
console.log(JSON.stringify({mode:apply?'STAGING IMPORT':'DRY RUN',students:users.size,
 partnerships:d.learningPartners.length,uniquePairs:pairs.size,
 duplicatePairCount:duplicate.length,skippedPartnerships:skipped.length,blocks:blocks.length},null,2));
if(duplicate.length||skipped.length)throw Error('Preflight failed: review duplicate/orphaned partnerships before import; nothing was modified.');
if(!apply)process.exit(0);
const db=createStudyChatStore({...process.env,GB_CHAT_BACKEND:'supabase'});
if(!db)throw Error('Staging Supabase connection missing.');
// No bulk deletes. Do not re-run against a live SQL-authoritative system:
// this export may contain older partnership relationships.
for(const user of users.values())await db.upsertStudent(user);
for(const partner of d.learningPartners)await db.upsertPartnership(partner);
for(const block of blocks){
 await db.upsertBlock(block.from,block.to);
 // Historical blocks must revoke any imported private WebSocket entitlement.
 await db.syncRoomMembers(chatRoom('private',block.from,block.to),[]);
}
console.log('Staging import complete. Manually compare SQL counts and blocked pairs before enabling cutover.');
