/* One-time, staging-only migration helper. Takes an authorised, offline
 * EdgeOne Blob JSON export as input. NEVER embeds that export in a ZIP.
 * Default mode is dry-run. Writes require --apply --staging and explicit
 * GB_CHAT_BACKFILL_TARGET=STAGING. Designed to be rerunnable/idempotent. */
import fs from 'node:fs/promises';
import {createStudyChatStore,chatRoom} from '../node-functions/lib/study-chat-store.js';

const argv=process.argv.slice(2);
const input=argv.find(x=>x.startsWith('--file='))?.slice(7);
if(!input){console.error('Usage: node scripts/backfill-study-directory.mjs --file=/secure/export.json [--apply --staging]');process.exitCode=2;}
else{
 const apply=argv.includes('--apply');
 if(apply&&(!argv.includes('--staging')||process.env.GB_CHAT_BACKFILL_TARGET!=='STAGING')){
   throw Error('Write protection: use --apply --staging and GB_CHAT_BACKFILL_TARGET=STAGING on a staging project.');
 }
 const snapshot=JSON.parse(await fs.readFile(input,'utf8'));
 const d=snapshot?.data&&Array.isArray(snapshot.data.users)?snapshot.data:snapshot;
 if(!Array.isArray(d.users)||!Array.isArray(d.learningPartners)||!Array.isArray(d.learningCommunities)){
   throw Error('Export is missing users/learningPartners/learningCommunities arrays. No changes made.');
 }
 const users=new Map(d.users.map(u=>[u.id,u]));
 const partners=d.learningPartners.filter(p=>users.has(p.from)&&users.has(p.to)&&['pending','accepted','declined'].includes(p.status));
 const communities=d.learningCommunities.filter(c=>c?.id&&users.has(c.lead)&&Array.isArray(c.members)&&c.members.length>0&&c.members.length<=20&&c.members.includes(c.lead)&&c.members.every(id=>users.has(id)));
 console.log(JSON.stringify({mode:apply?'APPLY-STAGING':'DRY-RUN',students:users.size,partnerships:partners.length,communities:communities.length,skippedCommunities:d.learningCommunities.length-communities.length},null,2));
 if(apply){
   const store=createStudyChatStore({...process.env,GB_CHAT_BACKEND:'supabase'});
   if(!store)throw Error('A valid staging SQL chat connection is required.');
   for(const u of users.values())await store.upsertStudent(u);
   for(const p of partners){
     await store.upsertPartnership(p);
     const blocked=(d.learningBlocks||[]).some(b=>[p.from,p.to].includes(b.from)&&[p.from,p.to].includes(b.to));
     await store.syncRoomMembers(chatRoom('private',p.from,p.to),p.status==='accepted'&&!blocked?[p.from,p.to]:[]);
   }
   for(const c of communities){
     await store.upsertCommunity(c);await store.syncCommunityMembers(c);
     await store.syncRoomMembers(chatRoom('community',c.id),c.members);
   }
   console.log('Staging metadata backfill completed. Compare SQL counts with the export before switching on WebSockets.');
 }
}
