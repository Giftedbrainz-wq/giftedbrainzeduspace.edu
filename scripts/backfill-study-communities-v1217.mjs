/* One-time staging-only Study Community import. No export contents are logged.
 * Run dry first. Never rerun using stale Blob data after SQL has accepted writes. */
import fs from 'node:fs/promises';
import {createStudyChatStore,chatRoom} from '../node-functions/lib/study-chat-store.js';

const args=process.argv.slice(2);
const file=args.find(x=>x.startsWith('--file='))?.slice(7);
if(!file)throw Error('Usage: --file=/secure/offline-export.json [--apply --staging]');
const apply=args.includes('--apply');
if(apply&&(!args.includes('--staging')||process.env.GB_STUDY_BACKFILL_TARGET!=='STAGING'))
 throw Error('Community writes require --apply --staging and GB_STUDY_BACKFILL_TARGET=STAGING.');
const source=JSON.parse(await fs.readFile(file,'utf8'));
const data=source?.data&&Array.isArray(source.data.users)?source.data:source;
if(!Array.isArray(data.users)||!Array.isArray(data.learningCommunities))
 throw Error('Expected users and learningCommunities arrays in the offline snapshot.');
const ids=new Set(data.users.map(u=>u?.id).filter(Boolean));
const communities=data.learningCommunities;
const seen=new Set();const errors=[];let members=0,requests=0;
for(const c of communities){
 if(!c||typeof c.id!=='string'||!c.id||seen.has(c.id)){
  errors.push('duplicate/invalid community identifier');continue;
 }
 seen.add(c.id);
 const memberIds=Array.isArray(c.members)?c.members:[];
 const pendingIds=Array.isArray(c.pending)?c.pending:[];
 if(!ids.has(c.lead)||!memberIds.includes(c.lead))errors.push('lead is missing or not a member');
 if(memberIds.length<1||memberIds.length>20||new Set(memberIds).size!==memberIds.length)
  errors.push('invalid community capacity or duplicate member');
 if(memberIds.some(id=>!ids.has(id))||pendingIds.some(id=>!ids.has(id)))errors.push('orphaned member/request');
 if(new Set(pendingIds).size!==pendingIds.length||pendingIds.some(id=>memberIds.includes(id)))
  errors.push('duplicate/already-accepted join request');
 if(!['public','private'].includes(c.visibility)||!['approval','open'].includes(c.joinMode))
  errors.push('invalid visibility/join mode');
 if(c.visibility==='private'&&!c.inviteCode)errors.push('private community lacks invitation code');
 if(typeof c.name!=='string'||c.name.length<4||c.name.length>75)errors.push('invalid name');
 members+=memberIds.length;requests+=pendingIds.length;
}
const leaders=new Map();for(const c of communities){if(c?.lead)leaders.set(c.lead,(leaders.get(c.lead)||0)+1);}
if([...leaders.values()].some(n=>n>5))errors.push('lead limit exceeded');
console.log(JSON.stringify({mode:apply?'STAGING IMPORT':'DRY RUN',communities:communities.length,
 members,requests,validationErrors:errors.length,valid:errors.length===0},null,2));
if(errors.length)throw Error('Preflight failed: '+[...new Set(errors)].join('; '));
if(!apply)process.exit(0);
const db=createStudyChatStore({...process.env,GB_CHAT_BACKEND:'supabase'});
if(!db)throw Error('Study Community SQL store unavailable.');
for(const c of communities){
 await db.upsertCommunity(c);
 await db.syncCommunityMembers(c);
 await db.syncRoomMembers(chatRoom('community',c.id),c.members);
 await db.importCommunityRequests(c.id,c.pending);
}
console.log('Staging import written; compare membership, pending requests and invitations before cutover.');
