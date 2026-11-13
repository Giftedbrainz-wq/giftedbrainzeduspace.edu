/* Optional Supabase/Postgres messaging repository. No credentials reach browsers.
 * The default is the legacy blob path until the SQL migration and server settings
 * have been verified on staging. This is not an unauthenticated public API. */
import crypto from 'node:crypto';

export const chatRoom = (kind, one, two = '') => kind === 'community'
  ? `c:${one}`
  : `p:${crypto.createHash('sha256').update([one, two].sort().join('\u0000')).digest('hex')}`;

export function createStudyChatStore(env, fetchImpl = fetch) {
  if ((env.GB_CHAT_BACKEND || '').toLowerCase() !== 'supabase') return null;
  const url = String(env.GB_CHAT_SUPABASE_URL || '').replace(/\/+$/, '');
  const secret = String(env.GB_CHAT_SUPABASE_SECRET || '');
  if (!/^https:\/\/[^/]+$/.test(url) || !secret || secret.length < 25) {
    throw Error('The dedicated chat database is enabled but its HTTPS URL or server-side secret is missing.');
  }
  const headers = {'apikey':secret,'content-type':'application/json'};
  if (/^eyJ[A-Za-z0-9_-]+\./.test(secret)) headers.authorization=`Bearer ${secret}`;
  async function call(target, {method='GET', body, extra={}} = {}) {
    const response = await fetchImpl(`${url}/rest/v1/${target}`, {
      method, headers:{...headers,...extra},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(8000)
    });
    const raw = await response.text(); let value;
    try {value=raw?JSON.parse(raw):null;} catch {value=null;}
    if (!response.ok) {
      const cause = String(value?.message || value?.error || 'Unknown database error').slice(0,180);
      const err = Error(`Chat database request failed (${response.status}): ${cause}`);
      err.status = response.status; err.dbCode = String(value?.code || ""); throw err;
    }
    return value;
  }
  const rpc=(fn,body)=>call(`rpc/${fn}`,{method:'POST',body});
  const row = data => data?.payload || data || null;
  return {
    async list(room,{after=0,before=Infinity,limit=60}={}) {
      const q=new URLSearchParams({select:'payload',room_key:`eq.${room}`,limit:String(Math.min(100,Math.max(1,limit))),order:`created_at.${after?'asc':'desc'},id.${after?'asc':'desc'}`});
      if (after) q.set('created_at',`gt.${new Date(after).toISOString()}`);
      else if (Number.isFinite(before)) q.set('created_at',`lt.${new Date(before).toISOString()}`);
      const rows=await call(`gb_study_messages?${q}`);
      return Array.isArray(rows) ? (after ? rows : rows.reverse()).map(row) : [];
    },
    async changes(room, afterTime, limit=100) {
      const q=new URLSearchParams({select:'payload',room_key:`eq.${room}`,
        updated_at:`gt.${new Date(afterTime).toISOString()}`,
        order:'updated_at.asc,id.asc',limit:String(Math.min(100,limit))});
      const rows=await call(`gb_study_messages?${q}`);
      return Array.isArray(rows)?rows.map(row):[];
    },
    async get(room,id) {
      if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
      const q=new URLSearchParams({select:'payload',room_key:`eq.${room}`,id:`eq.${id}`,limit:'1'});
      const rows=await call(`gb_study_messages?${q}`);return row(rows?.[0]);
    },
    async send(room,from,to,text,clientId,replyTo='') {
      return rpc('gb_study_send',{p_room:room,p_sender:from,p_recipient:to||null,p_text:text,p_client:clientId||crypto.randomUUID(),p_reply:replyTo||''});
    },
    async act(room,id,user,action,value='',moderator=false) {
      return rpc('gb_study_action',{p_room:room,p_id:id,p_actor:user,p_action:action,p_value:value,p_moderator:!!moderator});
    },
    async read(room,user) {return rpc('gb_study_read',{p_room:room,p_recipient:user});},
    async deliver(user) {return rpc('gb_study_deliver',{p_recipient:user});},
    async inbox(user) {return rpc('gb_study_inbox',{p_user:user});},
    // Metadata mirrors are kept outside EdgeOne's large shared Blob. This is
    // a staged migration: authentication remains in the existing server.
    async upsertStudent(user) {
      const payload={id:String(user.id),display_name:String(user.name||''),username:String(user.username||''),avatar:String(user.avatar||''),status:String(user.status||'active'),updated_at:new Date().toISOString()};
      return call('gb_study_students?on_conflict=id',{method:'POST',body:[payload],extra:{Prefer:'resolution=merge-duplicates,return=minimal'}});
    },
    async upsertPartnership(partner) {
      const payload={id:String(partner.id),from_id:String(partner.from),to_id:String(partner.to),status:String(partner.status),updated_at:partner.updatedAt||new Date().toISOString()};
      if(partner.createdAt&&!Number.isNaN(Date.parse(partner.createdAt)))payload.created_at=partner.createdAt;
      return call('gb_study_partnerships?on_conflict=id',{method:'POST',body:[payload],extra:{Prefer:'resolution=merge-duplicates,return=minimal'}});
    },
    async removePartnership(id) {
      return call('gb_study_partnerships?id=eq.'+encodeURIComponent(String(id)),{method:'DELETE'});
    },
    async communityMutation(action,actor,{id='',target='',accept=false,payload={}}={}) {
      return rpc('gb_study_community_mutate',{
        p_action:action,p_actor:actor,p_community:id,p_target:target,p_accept:!!accept,p_payload:payload
      });
    },
    async communitySnapshot(actor,{id='',query='',mine=false,limit=150}={}) {
      const result=await rpc('gb_study_community_snapshot',{
        p_actor:actor,p_id:id,p_query:query,p_mine:!!mine,p_limit:limit
      });
      return Array.isArray(result)?result:[];
    },
    async upsertCommunity(group) {
      const payload={id:String(group.id),name:String(group.name),subject:String(group.subject||''),description:String(group.description||''),visibility:String(group.visibility||'public'),join_mode:String(group.joinMode||'open'),invite_code:String(group.inviteCode||''),lead_id:String(group.lead),updated_at:new Date().toISOString()};
      if(group.createdAt&&!Number.isNaN(Date.parse(group.createdAt)))payload.created_at=group.createdAt;
      return call('gb_study_community_directory?on_conflict=id',{method:'POST',body:[payload],extra:{Prefer:'resolution=merge-duplicates,return=minimal'}});
    },
    async importCommunityRequests(id,userIds) {
      const values=[...new Set((userIds||[]).map(String))];
      if(!values.length)return;
      return call('gb_study_community_requests?on_conflict=community_id,user_id',{
        method:'POST',body:values.map(user_id=>({community_id:String(id),user_id})),
        extra:{Prefer:'resolution=ignore-duplicates,return=minimal'}
      });
    },
    async removeCommunity(id) {
      await call('gb_study_community_members?community_id=eq.'+encodeURIComponent(String(id)),{method:'DELETE'});
      return call('gb_study_community_directory?id=eq.'+encodeURIComponent(String(id)),{method:'DELETE'});
    },
    async syncCommunityMembers(group) {
      return rpc('gb_study_sync_community',{p_community:String(group.id),p_lead:String(group.lead),p_members:[...new Set((group.members||[]).map(String))]});
    },
    async syncRoomMembers(room,ids) {
      return rpc('gb_study_sync_room',{p_room:room,p_members:[...new Set(ids.map(String))]});
    },
    async searchStudents(q,limit=40,offset=0) {
      const query=new URLSearchParams({select:'id,display_name,username,avatar,status',status:'eq.active',order:'username.asc',limit:String(Math.max(1,Math.min(40,limit))),offset:String(Math.max(0,offset))});
      if(q)query.set('or',`(username.ilike.*${String(q).replace(/[%*,()]/g,'')}*,display_name.ilike.*${String(q).replace(/[%*,()]/g,'')}*)`);
      return call('gb_study_students?'+query);
    },
    async findPartnerships(user) {
      const rows=await call('gb_study_partnerships?select=id,from_id,to_id,status,created_at,updated_at&or='+encodeURIComponent(`(from_id.eq.${user},to_id.eq.${user})`));
      return (rows||[]).map(x=>({id:x.id,from:x.from_id,to:x.to_id,status:x.status,createdAt:x.created_at,updatedAt:x.updated_at}));
    },
    async searchDirectory(actor,q='',offset=0,limit=40){
      return rpc('gb_study_student_search',{p_actor:actor,p_query:q,p_offset:offset,p_limit:limit});
    },
    async getStudentProfiles(ids){
      const unique=[...new Set(ids.map(String).filter(v=>/^[A-Za-z0-9_-]{1,120}$/.test(v)))].slice(0,40);
      if(!unique.length)return [];
      const q=new URLSearchParams({select:'id,display_name,username,avatar,status,last_seen_at',id:`in.(${unique.join(',')})`});
      const rows=await call('gb_study_students?'+q);
      return (rows||[]).map(x=>({id:x.id,name:x.display_name,username:x.username,avatar:x.avatar,
        online:x.status==='active'&&Number(x.last_seen_at)>Date.now()-120000}));
    },
    async blockedFor(actor){
      const q=encodeURIComponent(`(from_id.eq.${actor},to_id.eq.${actor})`);
      const rows=await call(`gb_study_blocks?select=from_id,to_id&or=${q}`);
      return (rows||[]).map(x=>({from:x.from_id,to:x.to_id}));
    },
    async partnerMutation(action,actor,{other='',id='',accept=false}={}){
      return rpc('gb_study_partner_mutate',{
        p_action:action,p_actor:actor,p_other:other,p_id:id,p_accept:!!accept
      });
    },
    async touchStudent(id){
      return rpc('gb_study_touch_student',{p_id:id,p_at:Date.now()});
    },
    async upsertBlock(from,to){
      return call('gb_study_blocks?on_conflict=from_id,to_id',{
        method:'POST',body:[{from_id:from,to_id:to}],extra:{Prefer:'resolution=ignore-duplicates,return=minimal'}
      });
    },
    async purgeCommunityStudent(user) {
      return rpc('gb_study_community_purge_student',{p_user:user});
    },
    async purgeUser(user) {
      // Delete both sender-owned and recipient-linked messages. A removed student
      // must not retain chat data in the external store after account deletion.
      await call(`gb_study_messages?sender_id=eq.${encodeURIComponent(user)}`,{method:'DELETE'});
      await call(`gb_study_messages?recipient_id=eq.${encodeURIComponent(user)}`,{method:'DELETE'});
      if (/^(1|true|yes|on)$/i.test(String(env.GB_CHAT_REALTIME_ENABLED||'')) || String(env.GB_STUDY_DIRECTORY_BACKEND||'').toLowerCase()==='supabase' || String(env.GB_STUDY_COMMUNITY_BACKEND||'').toLowerCase()==='supabase') {
      await call(`gb_study_room_members?user_id=eq.${encodeURIComponent(user)}`,{method:'DELETE'});
      if(String(env.GB_STUDY_DIRECTORY_BACKEND||'').toLowerCase()==='supabase'){
        await call(`gb_study_blocks?from_id=eq.${encodeURIComponent(user)}`,{method:'DELETE'});
        await call(`gb_study_blocks?to_id=eq.${encodeURIComponent(user)}`,{method:'DELETE'});
      }
      if(String(env.GB_STUDY_COMMUNITY_BACKEND||'').toLowerCase()==='supabase') await rpc('gb_study_community_purge_student',{p_user:user});
      else await call(`gb_study_community_members?user_id=eq.${encodeURIComponent(user)}`,{method:'DELETE'});
      await call(`gb_study_partnerships?from_id=eq.${encodeURIComponent(user)}`,{method:'DELETE'});
      await call(`gb_study_partnerships?to_id=eq.${encodeURIComponent(user)}`,{method:'DELETE'});
      await call(`gb_study_students?id=eq.${encodeURIComponent(user)}`,{method:'DELETE'});
      }
    },
    async purgeCommunity(room) {
      // Used only after the Community Lead's authorisation has been verified.
      return call(`gb_study_messages?room_key=eq.${encodeURIComponent(room)}`,{method:'DELETE'});
    }
  };
}
