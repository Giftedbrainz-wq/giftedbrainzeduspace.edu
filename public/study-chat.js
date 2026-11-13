(()=>{'use strict';
const {api,esc,avatar,when,dateLabel,status,me}=GBStudy,$=id=>document.getElementById(id);
const params=new URLSearchParams(location.search),other=params.get('with'),communityId=params.get('community'),isGroup=!!communityId;
const myId=me().id,scroll=$('chatHistory');
let messages=[],group=null,partner=null,selectedReply='',pending=false,polling=false,cacheHash='',lastRead='',goalOpen=false,hasOlder=false;
const say=(s,e)=>status($('chatStatus'),s,e);
if(!myId||!(isGroup?communityId:other)){location.replace('/study-partners.html');return}
const root=isGroup?`communities/${encodeURIComponent(communityId)}/messages`:'partners/messages';
const listUrl=()=>root+(isGroup?'':'?with='+encodeURIComponent(other));
const dt=d=>{let n=new Date(d);return isNaN(n)?'':n.toISOString()};
const findMessage=id=>messages.find(m=>m.id===id);
// Linkify escaped text only. Never insert message text as trusted HTML.
function chatTextHtml(value){
 const safe=esc(String(value||''));
 return safe.replace(/https?:\/\/[^\s<>"']+/gi,raw=>{
   const matched=raw.match(/^(.*?)([),.!?;:]*)$/);
   const address=matched?.[1]||raw,tail=matched?.[2]||'';
   // Permit only explicit HTTP(S) destinations.
   try {const url=new URL(address.replace(/&amp;/g,'&'));if(!['https:','http:'].includes(url.protocol))return raw;}
   catch{return raw}
   return `<a class="study-chat-link" href="${address}" target="_blank" rel="noopener noreferrer">${address}</a>${tail}`;
 });
}
function showBubble(m){
 const own=m.from===myId,removed=!!m.deletedAt,edited=!!m.editedAt,all=own?'mine':'';
 if(removed)return '';
 const timestamp=esc(when(m.createdAt));
 const ticks=own?(m._pending?'<b class="pending">◷</b>':isGroup?'<b>✓</b>':m.readAt?'<b class="seen" title="Read">✓✓</b>':m.deliveredAt?'<b title="Delivered">✓✓</b>':'<b title="Sent">✓</b>'):'';
 const reply=m.replyTo?findMessage(m.replyTo):null;
 
 const tools=removed?'':`<button type="button" class="msg-more" data-menu="${esc(m.id)}" aria-label="Message options" aria-expanded="false" title="Message options">⋮</button><div class="msg-tools" hidden><button type="button" data-action="reply" data-id="${esc(m.id)}" title="Reply">↩ Reply</button>${own?`<button type="button" data-action="edit" data-id="${esc(m.id)}" title="Edit">✎ Edit</button><button type="button" data-action="delete" data-id="${esc(m.id)}" title="Delete">🗑 Delete</button>`:isGroup?'':`<button type="button" data-action="report" data-id="${esc(m.id)}" title="Report">⚑</button>`}${isGroup&&!own&&group?.isLead?`<button type="button" data-action="delete" data-id="${esc(m.id)}" title="Remove for community">🗑 Delete</button>`:''}</div>`;
 return `<div class="study-message ${all}" data-message="${esc(m.id)}"><div class="msg-bubble">
 ${isGroup&&!own?`<div class="msg-author">${esc(m.fromName||'Member')}</div>`:''}
 ${reply?`<div class="msg-quote">↩ ${esc(reply.deletedAt?'Message withdrawn':reply.text||'Message')}</div>`:''}
 <div class="msg-text">${chatTextHtml(m.text||'')}</div>
 <div class="msg-meta">${edited?'<span>Edited · </span>':''}${timestamp} ${ticks}</div>
 ${tools}</div></div>`;
}
function renderMessages(force=false){const hash=JSON.stringify(messages.map(m=>[m.id,m.text,m.deletedAt,m.readAt,m.deliveredAt,m.editedAt,m.reactions,m._pending]));if(!force&&hash===cacheHash)return;cacheHash=hash;
 const nearBottom=scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<110;
 const oldHeight=scroll.scrollHeight,oldTop=scroll.scrollTop;
 let lastDate='',content='';
 for(const m of messages.filter(m=>!m.deletedAt)){const date=dateLabel(m.createdAt);if(date!==lastDate){content+=`<div class="study-date">${esc(date)}</div>`;lastDate=date;}content+=showBubble(m)}
 scroll.innerHTML=(hasOlder?'<button type="button" class="btn light" id="loadOlderMessages" style="display:block;margin:3px auto 15px">Load earlier messages</button>':'')+(content||'<p class="study-empty">No messages yet. Start the conversation.</p>');
 if(force||nearBottom)scroll.scrollTop=scroll.scrollHeight;else scroll.scrollTop=oldTop+(scroll.scrollHeight-oldHeight);
}
async function fetchNew(initial=false){if(polling||document.hidden||pending)return;polling=true;
 try{const query=isGroup?'?':('&');const since=!initial&&messages.length?encodeURIComponent(messages.filter(m=>!m._pending).at(-1)?.createdAt||''):'';
 const endpoint=listUrl()+(since?query+'after='+since:'');
 const rows=await api(endpoint);
 if(initial){messages=rows;hasOlder=rows.length>=60;renderMessages(true)}else{
   // Get recent full state occasionally so read receipts, edits and reactions appear.
   if(since){const ids=new Set(messages.map(m=>m.id));for(const row of rows){if(!ids.has(row.id)){messages.push(row);ids.add(row.id)}}}
   else messages=rows;
   const max=messages.length>160; if(max)messages=messages.slice(-160);
   renderMessages();
 }
 if(!isGroup&&document.visibilityState==='visible'&&messages.some(m=>m.from===other&&!m.readAt&&!m._pending)){
   const receipt=await api('partners/messages/read','POST',{with:other});lastRead=receipt.readAt;for(const msg of messages)if(msg.from===other&&!msg.readAt)msg.readAt=receipt.readAt;
 }
 }catch(e){say(e.message,true)}finally{polling=false}
}
// Sync only new or modified records (including read receipts) instead of
// re-downloading the entire conversation every three seconds. The overlap
// compensates for network timing and service/DB clock skew. A periodic full
// refresh still recovers missed changes and reconciles older legacy messages.
let ticks=0,lastChangeCursor=Date.now()-15000;
async function refresh(forceFull=false){
 if(document.hidden||polling||pending)return;
 polling=true;
 const full=forceFull || ++ticks%24===0;
 const started=Date.now();
 try{
   const query=full?'':((isGroup?'?':'&')+'changedAfter='+encodeURIComponent(new Date(Math.max(0,lastChangeCursor)).toISOString()));
   const rows=await api(listUrl()+query);
   // Full refresh is a reconciliation snapshot; delta responses are only
   // messages whose state changed since the previous cursor.
   const byId=new Map(messages.map(x=>[x.id,x]));
   for(const row of rows){
     const pendingItem=messages.find(x=>x._pending&&x.clientId&&x.clientId===row.clientId);
     if(pendingItem)byId.delete(pendingItem.id);
     byId.set(row.id,row);
   }
   messages=[...byId.values()].sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
   if(messages.length>160)messages=messages.slice(-160);
   lastChangeCursor=started-15000;
   renderMessages();
   if(!isGroup&&rows.some(m=>m.from===other&&!m.readAt&&!m.deletedAt)){
     const receipt=await api('partners/messages/read','POST',{with:other});
     for(const msg of messages)if(msg.from===other&&!msg.readAt)msg.readAt=receipt.readAt;
     renderMessages();
   }
   say('');
 }catch(e){say(e.message,true)}finally{polling=false}
}
async function init(){try{
 if(isGroup){group=await api('communities/'+encodeURIComponent(communityId));$('chatBack').href='/study-communities.html';$('chatTitle').textContent=group.name;
 $('chatPresence').textContent=`${group.members}/20 members · ${group.leaderName} (Community Lead)`;$('chatAvatar').src='/api/community-photo/'+encodeURIComponent(group.id);$('chatAvatar').onerror=()=>{$('chatAvatar').onerror=null;$('chatAvatar').src='/assets/avatars/scholar-01.png'};}
 else{const r=await api('partners');partner=r.find(x=>x.status==='accepted'&&x.person?.id===other);if(!partner)throw Error('An accepted partnership is required to open this conversation.');
 $('chatTitle').textContent=partner.person.name||partner.person.username;$('chatAvatar').src=avatar(partner.person.avatar);$('chatPresence').innerHTML=partner.person.online?'🟢 Online':'⚪ Offline';}
 await fetchNew(true);if(!isGroup){const r=await api('partners/messages/read','POST',{with:other});for(const msg of messages)if(msg.from===other&&!msg.readAt)msg.readAt=r.readAt;}
 }catch(e){say(e.message,true);$('chatText').disabled=true;$('chatForm').querySelector('button').disabled=true;}}
function quote(id){selectedReply=id;const target=findMessage(id);$('composerQuoteText').textContent='↩ Reply to: '+String(target?.text||'Message').slice(0,90);$('composerQuote').style.display='flex';$('chatText').focus()}
$('cancelQuote').addEventListener('click',()=>{selectedReply='';$('composerQuote').style.display='none'});
$('chatForm').addEventListener('submit',async ev=>{ev.preventDefault();if(pending)return;const input=$('chatText'),text=input.value.trim();if(!text)return;
 const clientId=(globalThis.crypto?.randomUUID?.()||String(Date.now())+Math.random());const provisional={id:'temp-'+clientId,clientId,from:myId,to:other,text,replyTo:selectedReply,createdAt:new Date().toISOString(),reactions:[],_pending:true,fromName:me().name};
 messages.push(provisional);renderMessages(true);input.value='';selectedReply='';$('composerQuote').style.display='none';input.focus();
 try{const saved=await api(root,'POST',{to:other,text,clientId,replyTo:provisional.replyTo});const index=messages.findIndex(x=>x.clientId===clientId);if(index>=0)messages[index]=saved;renderMessages(true);say('');}
 catch(e){const x=messages.find(m=>m.clientId===clientId);if(x)x._pending=false;input.value=text;say('Could not send: '+e.message,true);renderMessages(true);}
});
$('chatHistory').addEventListener('click',async ev=>{
 const menu=ev.target.closest('[data-menu]');
 if(menu){const owner=menu.closest('.study-message');const options=owner?.querySelector('.msg-tools');if(!options)return;
   $('chatHistory').querySelectorAll('.msg-tools').forEach(el=>{if(el!==options)el.hidden=true});
   options.hidden=!options.hidden; menu.setAttribute('aria-expanded',String(!options.hidden));return;}

 if(ev.target.closest('#loadOlderMessages')){const before=messages.filter(m=>!m._pending).at(0)?.createdAt;if(!before)return;
   const endpoint=listUrl()+(isGroup?'?':'&')+'before='+encodeURIComponent(before);
   try{const older=await api(endpoint);const ids=new Set(messages.map(m=>m.id));messages=[...older.filter(m=>!ids.has(m.id)),...messages];hasOlder=older.length>=60;renderMessages();}catch(e){say(e.message,true)}return;}
 const button=ev.target.closest('[data-action]');if(!button)return;const action=button.dataset.action,id=button.dataset.id,m=findMessage(id);if(!m)return;
 try{
 if(action==='reply'){quote(id);return}
 if(action==='edit'){
   const text=await GBUI.promptValue('Edit your message','Update your message',m.text,{maxLength:1000});if(text===null)return;
   const endpoint=isGroup?root+'/'+encodeURIComponent(id):'partners/messages/'+encodeURIComponent(id);
   const result=await api(endpoint,'PATCH',{text});Object.assign(m,result.message||result);renderMessages(true);return;
 }
 if(action==='delete'){
   let scope='everyone';if(!isGroup){const choice=await GBUI.promptValue('Delete message','Type "everyone" to withdraw your message for everyone, or "me" to hide it only for you.',m.from===myId?'everyone':'me',{maxLength:10});if(choice===null)return;scope=choice.toLowerCase();if(!['me','everyone'].includes(scope))throw Error('Use "me" or "everyone".');}
   if(!await GBUI.confirmAction('Delete message','Delete this message?', 'Delete'))return;
   const endpoint=isGroup?root+'/'+encodeURIComponent(id):'partners/messages/'+encodeURIComponent(id)+'?scope='+scope;
   await api(endpoint,'DELETE');messages=messages.filter(x=>x.id!==id);renderMessages(true);return;
 }
 if(action==='report'){
   const reason=await GBUI.promptValue('Report message','Reason for reporting','Inappropriate message',{maxLength:300});if(reason===null)return;
   await api('partners/report','POST',{messageId:id,reason});say('Your report was submitted.');
 }
 }catch(e){say(e.message,true)}
});
async function details(){const box=$('chatDetails');if(!box.hidden){box.hidden=true;box.classList.remove('study-details-screen');return}box.hidden=false;box.classList.add('study-details-screen');
 if(isGroup){try{group=await api('communities/'+encodeURIComponent(communityId));box.innerHTML=`<button type="button" id="closeStudyDetails" class="btn light">← Back to chat</button><div class="study-contact-profile"><img src="/api/community-photo/${encodeURIComponent(group.id)}" alt="Community picture" onerror="this.onerror=null;this.src='/assets/avatars/scholar-01.png'"><h3>👥 ${esc(group.name)}</h3></div>${group.isLead?'<label class="study-photo-upload">Change community picture<input id="communityPicture" type="file" accept="image/png,image/jpeg,image/webp"></label>':''}<p class="muted">${esc(group.description||'')}</p><p><b>${group.members}/20 members</b> · Community Lead: ${esc(group.leaderName)}</p><button class="btn light" id="copyInvite">Copy invitation</button> <button class="btn light" id="leaveCommunity">${group.isLead?'Dissolve community':'Leave community'}</button><div id="communityMembers"></div>`;
 if(group.isLead){box.querySelector('#communityPicture')?.addEventListener('change',async e=>{if(!e.target.files?.[0])return;try{const webp=await GBCompactImage(e.target.files[0]);await api('communities/'+encodeURIComponent(group.id)+'/picture','POST',{webp});say('Community picture updated.');const img=$('chatAvatar');img.src='/api/community-photo/'+encodeURIComponent(group.id)+'?v='+Date.now();box.querySelector('.study-contact-profile img').src=img.src;}catch(err){say(err.message,true)}})}
 const memberBox=box.querySelector('#communityMembers');memberBox.innerHTML=`<h3>Members</h3>`+group.memberProfiles.map(p=>`<div class="study-person"><img src="${avatar(p.avatar)}" alt=""><span class="study-person-main"><strong>${esc(p.name)}</strong><small>@${esc(p.username||'student')}</small></span>${group.isLead&&p.id!==myId?`<button class="btn light" data-lead="${esc(p.id)}">Make Lead</button><button class="btn light" data-remove="${esc(p.id)}">Remove</button>`:''}</div>`).join('')+(group.isLead?`<h3>Join requests</h3>`+group.pendingProfiles.map(p=>`<div class="study-person"><strong class="study-person-main">${esc(p.name)}</strong><button class="btn primary" data-request="${esc(p.id)}" data-accept="1">Accept</button><button class="btn light" data-request="${esc(p.id)}" data-accept="0">Decline</button></div>`).join(''):'');
 box.querySelector('#copyInvite').addEventListener('click',async()=>{const link=location.origin+'/study-communities.html?community='+encodeURIComponent(group.id)+'&code='+encodeURIComponent(group.inviteCode);try{await navigator.clipboard.writeText(link);say('Invitation link copied.')}catch{say('Share this link: '+link)}});
 box.querySelector('#leaveCommunity').addEventListener('click',async()=>{if(!await GBUI.confirmAction('Leave community','Leave this community? If you are the sole Community Lead, this will dissolve the community.','Continue'))return;try{await api('communities/'+encodeURIComponent(group.id)+'/leave','POST',{});location.href='/study-communities.html'}catch(e){say(e.message,true)}});
 memberBox.addEventListener('click',async e=>{const btn=e.target.closest('[data-lead],[data-request],[data-remove]');if(!btn)return;try{if(btn.dataset.remove){if(!await GBUI.confirmAction('Remove member','Remove this student from the community?','Remove'))return;await api('communities/'+encodeURIComponent(group.id)+'/members/'+encodeURIComponent(btn.dataset.remove),'DELETE');}else if(btn.dataset.lead)await api('communities/'+encodeURIComponent(group.id)+'/lead','POST',{userId:btn.dataset.lead});else await api('communities/'+encodeURIComponent(group.id)+'/requests','POST',{userId:btn.dataset.request,accept:btn.dataset.accept==='1'});box.hidden=true;details()}catch(err){say(err.message,true)}});
 }catch(e){say(e.message,true)}}
 else{box.innerHTML=`<button type="button" id="closeStudyDetails" class="btn light">← Back to chat</button><div class="study-contact-profile"><img src="${avatar(partner?.person?.avatar)}" alt="Student profile"><h2>${esc(partner?.person?.name||partner?.person?.username||'Student')}</h2><p>${partner?.person?.online?'🟢 Online':'⚪ Offline'}</p></div><h3>Shared Study Communities</h3><div id="sharedStudyCommunities" class="study-shared-communities"><p class="muted">Loading shared communities…</p></div><h3>Shared study goals</h3><div id="studyGoals"></div><form class="study-form" id="studyGoalForm"><label>Goal<input name="title" maxlength="160" placeholder="Revise Stoichiometry" required></label><label>Target date<input type="date" name="date" required></label><button class="btn light" type="submit">＋ Add study goal</button></form><button class="btn light" type="button" id="endPartnership">End partnership</button> <button class="btn light" type="button" id="blockPartner">Block student</button><button class="btn light" type="button" id="reportPartner">Report student</button>`;
 async function sharedCommunities(){const host=box.querySelector('#sharedStudyCommunities');if(!host)return;try{
  const result=await api('communities?mine=1');
  const candidates=(result.communities||[]).filter(c=>c.joined).slice(0,20);
  const responses=await Promise.all(candidates.map(c=>api('communities/'+encodeURIComponent(c.id)).catch(()=>null)));
  const shared=responses.filter(c=>c&&(c.memberProfiles||[]).some(p=>p.id===other));
  host.innerHTML=shared.length?shared.map(c=>`<a class="study-person" href="/study-chat.html?community=${encodeURIComponent(c.id)}">👥 ${esc(c.name)}</a>`).join(''):'<p class="muted">No shared Study Communities.</p>';
 }catch{host.innerHTML='<p class="muted">Shared communities are unavailable.</p>';}}
 void sharedCommunities();
 async function goals(){try{const list=await api('partners/goals?with='+encodeURIComponent(other));box.querySelector('#studyGoals').innerHTML=list.map(g=>`<p class="study-request">${esc(g.title)} · ${esc(g.date)} (${g.completedBy?.length||0}/2 completed) <button class="btn light" data-goal="${esc(g.id)}">${g.completedBy?.includes(myId)?'Undo':'Complete'}</button></p>`).join('')||'<p class="study-empty">No goals yet.</p>';}catch(e){say(e.message,true)}}
 await goals();box.querySelector('#studyGoalForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.target);try{await api('partners/goals','POST',{to:other,title:f.get('title'),date:f.get('date')});e.target.reset();await goals()}catch(err){say(err.message,true)}});
 box.querySelector('#studyGoals').addEventListener('click',async e=>{const b=e.target.closest('[data-goal]');if(!b)return;try{await api('partners/goals/'+b.dataset.goal,'PATCH',{completed:b.textContent==='Complete'});await goals()}catch(err){say(err.message,true)}});
 box.querySelector('#endPartnership').addEventListener('click',async()=>{if(!await GBUI.confirmAction('End partnership','This will stop new messages. Continue?','End'))return;try{await api('partners/'+encodeURIComponent(partner.id),'DELETE');location.href='/study-partners.html'}catch(e){say(e.message,true)}});
 box.querySelector('#reportPartner').addEventListener('click',async()=>{const reason=await GBUI.promptValue('Report student','Describe your concern. Private conversations will not be shared unless you report a specific message.','',{maxLength:300});if(reason===null)return;try{await api('partners/report-student','POST',{userId:other,reason});say('Your report has been submitted.')}catch(err){say(err.message,true)}});
 box.querySelector('#blockPartner').addEventListener('click',async()=>{if(!await GBUI.confirmAction('Block student','Block this student and end your partnership?','Block'))return;try{await api('partners/block','POST',{userId:other});location.href='/study-partners.html'}catch(e){say(e.message,true)}});
 }
}
// Adapt the chat to the actual browser viewport, including the mobile keyboard.
function fitChatViewport(){
 if(innerWidth>760){$('chatHistory')?.style.removeProperty('scroll-padding-bottom');$('chatForm')?.closest('.study-chat-main')?.style.removeProperty('height');return;}
 const view=window.visualViewport;
 const height=view?.height||innerHeight;
 const top=$('chatForm')?.closest('.study-chat-main')?.getBoundingClientRect().top||0;
 const size=Math.max(260,Math.floor(height-top-6));
 $('chatForm').closest('.study-chat-main').style.height=size+'px';
}
window.addEventListener('resize',fitChatViewport,{passive:true});
window.visualViewport?.addEventListener('resize',fitChatViewport,{passive:true});
window.visualViewport?.addEventListener('scroll',fitChatViewport,{passive:true});
requestAnimationFrame(fitChatViewport);
$('chatText').addEventListener('focus',()=>setTimeout(fitChatViewport,150));
$('chatInfo').addEventListener('click',details);
$('chatDetails').addEventListener('click',e=>{if(e.target.closest('#closeStudyDetails')){$('chatDetails').hidden=true;$('chatDetails').classList.remove('study-details-screen')}});
// WebSocket broadcast is only an authenticated change notification. Every
// actual message still comes through the EduSpace API (permissions enforced).
// Polling remains a fallback for unconfigured Supabase, outages and offline use.
const live=window.GBStudyLive?.connection({
 path:isGroup?'?community='+encodeURIComponent(communityId):'?with='+encodeURIComponent(other),
 onChange:()=>refresh(),onStatus:()=>{}
});
api('partners/presence','POST',{}).catch(()=>{});
setInterval(()=>{if(document.visibilityState==='visible'&&navigator.onLine)api('partners/presence','POST',{}).catch(()=>{});},30000);
init().then(()=>live?.start());
const scheduleRefresh=()=>{setTimeout(()=>{
   if(!document.hidden)refresh();scheduleRefresh();
 },live?.isLive()?45000:3500)};scheduleRefresh();
// The interval closure checks current state each time, including reconnects.
// Trigger a full reconciliation when the page becomes visible again.
document.addEventListener('visibilitychange',()=>{if(!document.hidden){api('partners/presence','POST',{}).catch(()=>{});refresh(true);}});
window.addEventListener('pagehide',()=>live?.close());
})();
