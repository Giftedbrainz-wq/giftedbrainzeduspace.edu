/* Battle Arena: authenticated match room UI. Members request to join one named team; opponents accept their own invitation. No answer keys are fetched during live rounds. */
(()=>{
"use strict";
if(!GB.token()){location.replace("/login.html");return;}
GBUI.mount({active:"/battle.html"});
const $=id=>document.getElementById(id),esc=GBUI.esc;
let myTeams=[],catalog={subjects:[],topics:[],formats:{},logos:[]},room=null,roomId="",selectedAnswer=null,lastRound=-1,lastStatus="",polling=false,chatBusy=false,chatLast="",clockSkew=0,lastExpiryRefresh=0;
// Protect interactive actions from duplicated clicks and stale network responses.
let roomEpoch=0,answerBusy=false,pendingChat=null,teamViewKey="",resultViewKey="";
const logo=name=>`/assets/battle/${encodeURIComponent(name||"lion")}.png?v=12.6.2`;
const call=(url,method="GET",body)=>GB.api(url,{method, ...(body===undefined?{}:{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),retryAttempts:1});
const note=(text,error=false)=>{const el=$("battleNotice");el.textContent=text||"";el.classList.toggle("error",!!error);};
const datestr=s=>{try{return new Date(s).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}catch{return ""}};
function renderMath(){if(typeof GBUI.renderMath==="function")GBUI.renderMath(document.getElementById("arenaRoom"));}
const typeset=text=>typeof GBUI.mathHtml==="function"?GBUI.mathHtml(text):esc(text);
const copyText=async value=>{try{await navigator.clipboard.writeText(value);note("Copied to clipboard.")}catch{note("Share this code: "+value)}};
async function loadTeams(){
  if(roomId||document.hidden)return;
  const r=await call("/api/battle/teams");myTeams=r.teams||[];
  $("createMyTeam").innerHTML=myTeams.filter(t=>t.isLeader).map(t=>`<option value="${esc(t.id)}">${esc(t.name)} (${t.members.length} player${t.members.length===1?"":"s"})</option>`).join("");
  $("myTeamsList").innerHTML=myTeams.length?myTeams.map(t=>`<article class="battle-roster"><div class="battle-team-head"><img class="battle-logo" src="${logo(t.logo)}" alt=""><div><h3>${esc(t.name)}</h3><small>${t.members.length}/3 players · ${t.leaderOnline?"🟢 Online":"⚪ Offline"} · ${t.isLeader?"👑 You are leader":"Team member"}</small></div></div><p class="battle-team-identifier">TEAM ID: <strong>${esc(t.code)}</strong> <button class="btn light" data-copy-team="${esc(t.code)}">Copy Team ID</button></p><div class="battle-roster-people">${t.members.map(u=>`<span>${esc(u.name)}${u.id===t.leader?" 👑":""}</span>`).join("")}</div>${t.isLeader?`<div class="battle-actions"><button type="button" class="btn light" data-nullify-team="${esc(t.id)}">✕ Nullify team</button></div>`:""}${t.isLeader?(t.pending||[]).map(u=>`<p>🔔 ${esc(u.name)} requests to join. <button class="btn primary" data-team-approval="approve" data-team-id="${esc(t.id)}" data-user="${esc(u.id)}">Approve</button> <button class="btn light" data-team-approval="decline" data-team-id="${esc(t.id)}" data-user="${esc(u.id)}">Decline</button></p>`).join(""):""}</article>`).join(""):'<p class="muted">Create a team or join one using a shared Team ID.</p>';

  $("inviteList").innerHTML=(r.invitations||[]).length?`<h3>⚔️ Challenges waiting for your response</h3>`+(r.invitations||[]).map(i=>`<article class="battle-invite"><strong>${esc(i.challenger)} challenges ${esc(i.opponent)}!</strong><p>${esc(i.title)} · ${esc(i.subject)} · ${esc(i.format)}</p><button class="btn primary" data-respond="accept" data-invite-room="${esc(i.roomId)}">Accept Challenge</button><button class="btn light" data-respond="decline" data-invite-room="${esc(i.roomId)}">Decline</button></article>`).join(""):"";
}

function logoChoices(host,field="battleLogo"){$(host).innerHTML=catalog.logos.map((id,i)=>`<label title="${esc(id)}"><input type="radio" name="${field}" value="${esc(id)}" ${i===0?"checked":""}><img class="gb-logo-variant gb-logo-variant-${i%8}" src="${logo(id)}" alt="${esc(id)} logo"></label>`).join("");}

function showHome(){roomEpoch++;teamViewKey="";resultViewKey="";lastRound=-1;lastStatus="";document.body.classList.remove("battle-in-progress","battle-finished");roomId="";room=null;$("arenaRoom").hidden=true;$("battleLeaderboard").hidden=true;$("arenaHome").hidden=false;history.replaceState(null,"","/battle.html");loadRecent();loadTeams().catch(e=>note(e.message,true));}
let allMatchRows=[],matchesExhausted=false;
const matchCard=r=>`<div class="battle-mini-result"><b>${esc(r.title)}</b> · ${esc(r.subject)} <span class="battle-pill">${esc(r.outcome||r.status)}</span><br><small>${esc(r.opponent||'Opponent')} · ${new Date(r.createdAt).toLocaleDateString()} · ${esc(r.scoreA)}–${esc(r.scoreB)}</small> <button type="button" class="btn light" data-room="${esc(r.id)}">Open room →</button></div>`;
function renderRecent(){const host=$("battleRecent");host.innerHTML=allMatchRows.length?allMatchRows.slice(0,5).map(matchCard).join('')+(allMatchRows.length>5?'<button type="button" class="btn light" id="showAllBattleMatches">View all matches →</button>':''):'<p class="muted">No matches yet. Create your first challenge.</p>';}
async function loadRecent(){try{allMatchRows=await call("/api/battle/mine?limit=25");matchesExhausted=allMatchRows.length<25;renderRecent()}catch(e){$("battleRecent").textContent=e.message;}}
function roomLink(){return location.origin+"/battle.html?code="+encodeURIComponent(room.code)}
function teamCard(side){const t=room.teams[side],mine=room.myTeam===side,leader=t.leader===myId(),waiting=room.status==="waiting";
  const parts=t.members.map(u=>`<li><b>${esc(u.name)}</b> ${u.id===t.leader?"👑 Leader":""} ${t.ready.includes(u.id)?"✅ Ready":""} ${leader&&u.id!==t.leader&&waiting?`<button class="btn light" data-action="transfer" data-team="${side}" data-user="${esc(u.id)}" title="Make leader">👑</button><button class="btn light" data-action="remove" data-user="${esc(u.id)}">Remove</button>`:""}</li>`).join("");
  const targetPending=(t.pending||[]).map(u=>`<div class="battle-mini-result">${esc(u.name)} <button class="btn primary" data-action="approve" data-team="${side}" data-user="${esc(u.id)}">Approve</button> <button class="btn light" data-action="decline" data-team="${side}" data-user="${esc(u.id)}">Decline</button></div>`).join("");
  const canJoin=waiting&&!room.myTeam&&!room.sourceTeamId&&t.members.length<t.capacity;
  return `<section class="battle-team ${mine?"mine":""}"><header class="battle-team-head"><img class="battle-logo" src="${logo(t.logo)}" alt="${esc(t.logo)} badge"><div><h3>${esc(t.name)}</h3><span class="battle-section-sub">Team ${side} • ${t.members.length}/${t.capacity} players</span></div></header><div class="battle-pill">Score: ${t.score} points</div><ul>${parts||"<li>Waiting for players</li>"}</ul>${canJoin?`<button class="btn primary" data-action="request" data-team="${side}">Request to join Team ${side}</button>`:""}${targetPending}${mine&&waiting?`<div class="battle-team-actions">${leader?`<button class="btn light" data-action="customise" data-team="${side}">✏️ Edit team</button>`:""}<button class="btn ${t.ready.includes(myId())?"light":"primary"}" data-action="ready" data-ready="${t.ready.includes(myId())?"0":"1"}">${t.ready.includes(myId())?"✓ Ready (undo)":"I'm ready"}</button></div>`:""}</section>`;
}
function myId(){try{return JSON.parse(localStorage.getItem("gbUser")||"{}").id||""}catch{return ""}}
function gameQuestion(){if(!room||room.status!=="active"||!room.current)return;
  const q=room.current, key=room.round;
  if(key!==lastRound||lastStatus!=="active"){
    selectedAnswer=null;lastRound=key;
    $("questionNum").textContent=`QUESTION ${q.number} OF ${room.total}`;
    const refs=Array.isArray(q.imageRefs)&&q.imageRefs.length?q.imageRefs:(q.imageRef?[q.imageRef]:[]);const picture=refs.map((path,i)=>`<p><img class="battle-qimg" src="${esc(GB.fileUrl(path,{inline:true}))}" alt="Question diagram ${i+1}"></p>`).join("");
    $("battleQuestion").innerHTML=(q.passage?`<blockquote>${typeset(q.passage)}</blockquote>`:"")+`<div>${typeset(q.q)}</div>`+picture;
    $("battleOptions").innerHTML=q.options.map((option,i)=>`<label class="battle-option"><input type="radio" name="battleAnswer" value="${i}"><span><b>${"ABCDEF"[i]}.</b> ${typeset(option)}</span></label>`).join("");
    $("battleOptions").querySelectorAll("input").forEach(el=>el.addEventListener("change",()=>{selectedAnswer=Number(el.value)}));
    renderMath();
  }
  const done=room.myAnswer!==null&&room.myAnswer!==undefined;
  $("submitAnswer").hidden=!room.leader||done;
  $("suggestAnswer").hidden=!!room.leader||done;
  $("answerInfo").textContent=done?"Your team submitted its final answer. Waiting for the next round.":room.leader?"You are the team leader. Discuss, then submit your answer.":"Suggest an answer and discuss it with your team leader.";
  if(done)$("battleOptions").querySelectorAll("input").forEach(el=>el.disabled=true);
  const counts=(room.suggestions||[]).map(s=>`${esc(s.name)}: ${"ABCDEF"[s.answer]}`).join(" · ");
  if(counts)$("answerInfo").textContent+=` Suggestions: ${counts}`;
}
function updateTimer(){if(!room||room.status!=="active")return;const remaining=Math.max(0,Math.ceil((Number(room.deadline)-Date.now()-clockSkew)/1000));$("battleTimer").textContent=`00:${String(remaining).padStart(2,"0")}`;$("battleTimer").classList.toggle("urgent",remaining<=5);if(!remaining){$("submitAnswer").disabled=true;$("suggestAnswer").disabled=true;const expiry=Number(room.deadline);if(expiry&&lastExpiryRefresh!==expiry){lastExpiryRefresh=expiry;refreshRoom();}}else{$("submitAnswer").disabled=answerBusy;$("suggestAnswer").disabled=answerBusy||!!room.leader;}}
function resultsMarkup(){
  const winner=room.winner, draw=winner==="draw";
  const label=draw?"An honourable draw":(room.teams[winner]?.name||"Winning team")+" wins!";
  const teams=["A","B"].map(side=>{
    const t=room.teams[side],past=(room.history||[]).map(h=>h[side==="A"?"teamA":"teamB"]);
    const correct=past.filter(x=>x&&x.points>0).length,missed=past.filter(x=>x&&x.points===0).length,unanswered=past.filter(x=>!x).length;
    return `<article class="battle-score-team ${winner===side?"champion":""}">
      <img src="${logo(t.logo)}" alt="${esc(t.name)} badge" class="battle-score-logo">
      <div class="battle-score-team-name">${esc(t.name)}</div><div class="battle-score-points">${Number(t.score)||0}<small> POINTS</small></div>
      <span class="battle-score-caption">${winner===side?"🏆 CHAMPIONS":draw?"🤝 DRAW":"FINALIST"}</span>
      <div class="battle-score-breakdown"><span>✓ ${correct} correct</span><span>✕ ${missed} incorrect</span><span>○ ${unanswered} unanswered</span></div>
    </article>`;
  }).join('<div class="battle-score-versus">VS</div>');
  return `<section class="battle-result-celebrate battle-result-premium"><div class="battle-result-kicker">GIFTED BRAINZ · FINAL RESULTS</div>
    <div class="battle-victory-icon" aria-hidden="true">🏆</div><h2>${draw?"MATCH DRAWN":"VICTORY"}</h2><h3>${esc(label)}</h3>
    <div class="battle-scoreboard">${teams}</div>
    <p class="muted">Every point reflects the team's decisions. Review your answers below.</p>
    <div class="battle-actions battle-result-actions"><button class="btn primary" id="returnFromBattle">← Return to EduSpace</button>${room.canRematch?'<button class="btn gold" id="rematchBtn">⚔️ Rematch</button>':""}</div>
  </section><div class="battle-history">${(room.history||[]).map((h,i)=>`<article><strong>Question ${i+1}.</strong> ${h.passage?`<blockquote>${esc(h.passage)}</blockquote>`:""}${typeset(h.q)}${(h.imageRefs||[]).map((ref,n)=>`<img class="battle-qimg" src="${esc(GB.fileUrl(ref,{inline:true}))}" alt="Review diagram ${n+1}">`).join("")}<div class="battle-review-answer">Correct answer: ${typeset(h.options[h.answer]||"")}</div><small>Team A: ${h.teamA?`${typeset(h.options[h.teamA.answer]||"")} (${h.teamA.points} points)`:"No answer"} · Team B: ${h.teamB?`${typeset(h.options[h.teamB.answer]||"")} (${h.teamB.points} points)`:"No answer"}</small><p>${typeset(h.explanation||"")}</p><button type="button" class="btn light" data-save-battle="${esc(h.id||"")}" ${h.id?"":"disabled"}>⭐ Save question for later</button></article>`).join("")}</div>`;
}
function showRoom(data){
  if(!data||!data.id)return;
  const switched=roomId && roomId!==data.id;
  if(switched){roomEpoch++;teamViewKey="";resultViewKey="";lastRound=-1;lastStatus="";chatLast="";}
  if(pendingChat&&Array.isArray(data.chat)){
    // A concurrent poll must not erase the sender's temporary message.
    const saved=new Set(data.chat.map(m=>m.id));
    data.chat=[...data.chat,...(room?.chat||[]).filter(m=>m.pending&&!saved.has(m.id))];
  }
  room=data;roomId=data.id;
  if(Array.isArray(data.chat))renderChat(data.chat);
  document.body.classList.toggle("battle-in-progress",data.status==="active");
  document.body.classList.toggle("battle-finished",data.status==="finished");
  clockSkew=Number(data.serverTime||Date.now())-Date.now();
  $("arenaHome").hidden=true;$("battleLeaderboard").hidden=true;$("arenaRoom").hidden=false;
  const url="/battle.html?room="+encodeURIComponent(roomId);
  if(location.pathname+location.search!==url)history.replaceState(null,"",url);
  const state=data.status==="waiting"?"BATTLE LOBBY":data.status==="active"?"LIVE MATCH":data.status.toUpperCase();
  if($("roomStatus").textContent!==state)$("roomStatus").textContent=state;
  if($("roomTitle").textContent!==data.title)$("roomTitle").textContent=data.title;
  if($("roomCode").textContent!==data.code)$("roomCode").textContent=data.code;
  const meta=`${data.format} • ${data.subject} • ${data.questionCount} questions • ${data.difficulty||"mixed"} difficulty • 30 seconds/round${data.speedBonus?" • speed bonus on":""}`;
  if($("roomMeta").textContent!==meta)$("roomMeta").textContent=meta;
  const teamsKey=JSON.stringify([data.id,data.status,data.challengeStatus,data.myTeam,data.leader,data.teams,data.sizes]);
  if(teamViewKey!==teamsKey){
    teamViewKey=teamsKey;
    $("arenaTeams").innerHTML=teamCard("A")+teamCard("B");
    if(data.status==="waiting"&&data.challengeStatus==="pending")$("arenaTeams").insertAdjacentHTML("afterbegin",'<p class="battle-waiting-banner">⏳ Awaiting opponent team leader acceptance. Once accepted, every player can mark Ready.</p>');
    if(data.status==="waiting"&&data.myTeam==="A"&&data.leader){
      const ready=["A","B"].every(side=>{const t=data.teams[side];return t.leader&&t.members.length===t.capacity&&t.members.every(u=>t.ready.includes(u.id))});
      $("arenaTeams").insertAdjacentHTML("beforeend",`<div class="card"><p>${ready?"Both teams are ready!":"Waiting for players and Ready confirmations."}</p><button class="btn primary" id="startBattle" ${ready?"":"disabled"}>Start Battle ⚔️</button></div>`);
    }
  }
  $("battleGame").hidden=data.status!=="active"||!data.myTeam;
  $("chatBack").hidden=data.status!=="active";
  $("battleReview").hidden=data.status!=="finished";
  $("battleChatCard").hidden=!data.myTeam||!["waiting","active"].includes(data.status);
  if(data.status==="active")gameQuestion();
  if(data.status==="finished"){
    const resultsKey=JSON.stringify([data.id,data.winner,data.history,data.teams]);
    if(resultViewKey!==resultsKey){resultViewKey=resultsKey;$("battleReview").innerHTML=resultsMarkup();renderMath();}
  }
  lastStatus=data.status;updateTimer();
}
async function refreshRoom(quiet=true){
  if(!roomId||polling||document.hidden)return;
  polling=true;
  const target=roomId,epoch=roomEpoch;
  try{
    const r=await call("/api/battle/rooms/"+encodeURIComponent(target));
    if(target===roomId && epoch===roomEpoch){showRoom(r);if(!quiet)note("Room refreshed.");}
  }catch(e){if(target===roomId&&/match room has closed/i.test(e.message||'')){showHome();note('The match room has closed after inactivity or team nullification.',true);}else if(!quiet&&target===roomId)note(e.message,true)}
  finally{polling=false}
}
async function roomAction(action,body){
  if(!roomId)throw Error("Open a room first.");
  const target=roomId;roomEpoch++;
  const result=await call(`/api/battle/rooms/${encodeURIComponent(target)}/${action}`,"POST",body);
  if(target===roomId){
    // Save responses carry their authoritative room snapshot; no redundant GET.
    if(result.room&&action!=="rematch")showRoom(result.room);
    else if(!result.room&&action!=="chat"&&action!=="rematch")await refreshRoom();
  }
  return result;
}
function renderChat(data){const last=data.at(-1)?.id||"";if(chatLast===last)return;chatLast=last;$("battleMessages").innerHTML=data.length?data.map(m=>`<div class="battle-bubble ${m.mine?"mine":""} ${m.pending?"sending":""}"><strong>${esc(m.studentName)}</strong><p>${esc(m.text)}</p><time>${m.pending?"Sending…":esc(datestr(m.createdAt))}</time></div>`).join(""):'<p class="muted">No messages yet. Say hello to your teammates!</p>';$("battleMessages").scrollTop=$("battleMessages").scrollHeight;}
async function refreshChat(){if(!roomId||!room?.myTeam||chatBusy||$("battleChatCard").hidden)return;chatBusy=true;try{const data=await call(`/api/battle/rooms/${roomId}/chat`);renderChat(data)}catch(e){note(e.message,true)}finally{chatBusy=false}}
async function joinLookup(code){
  const text=code.trim().toUpperCase();let info;
  if(text.startsWith("BT-")){info={kind:"team",team:await call("/api/battle/teams/lookup?code="+encodeURIComponent(text))};}
  else info=await call("/api/battle/lookup?code="+encodeURIComponent(text));
  if(info.kind==="room"){showRoom(info.room);return;}
  if(info.kind!=="team")throw Error("Enter a valid Team ID or Match Room code.");
  if(info.team.alreadyMember)return note("You already belong to this team. Check your team list.");
  if(!await GBUI.confirmAction("Request to join "+info.team.name+"?","Only this team's leader can approve your request.","Send request"))return;
  await call("/api/battle/teams/"+encodeURIComponent(info.team.id)+"/request","POST",{});
  note("Request sent to "+info.team.name+". The team leader will approve or decline it.");
}
function showCreate(){const el=$("createForm");el.hidden=!el.hidden;$("joinForm").hidden=true;}
function showJoin(){const el=$("joinForm");el.hidden=!el.hidden;$("createForm").hidden=true;}
$("openCreate").onclick=showCreate;$("openJoin").onclick=showJoin;
$("openTeamCreate").onclick=()=>{$("teamCreateForm").hidden=!$("teamCreateForm").hidden;$("teamManager").scrollIntoView({behavior:"smooth"})};
$("teamCreateForm").onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await call("/api/battle/teams","POST",{name:$("newTeamName").value,logo:document.querySelector('input[name="teamLogo"]:checked')?.value});$("teamCreateForm").reset();$("teamCreateForm").hidden=true;await loadTeams();note("Team created. Share its Team ID with members.")}catch(err){note(err.message,true)}finally{b.disabled=false}};
$("teamManager").onclick=async e=>{
  const cp=e.target.closest("[data-copy-team]"),approval=e.target.closest("[data-team-approval]"),invite=e.target.closest("[data-respond]"),nullify=e.target.closest("[data-nullify-team]");
  if(cp)return copyText(cp.dataset.copyTeam);
  if(nullify){
    if(!await GBUI.confirmAction('Nullify this team?', 'The team will be dissolved, its pending challenges cancelled and its Team ID will stop working. Past match results remain saved.','Nullify team'))return;
    nullify.disabled=true;try{await call('/api/battle/teams/'+encodeURIComponent(nullify.dataset.nullifyTeam)+'/nullify','POST',{});await Promise.all([loadTeams(),loadRecent()]);note('Team successfully nullified.');}catch(err){note(err.message,true)}finally{nullify.disabled=false;}return;
  }
  const b=approval||invite;if(!b)return;b.disabled=true;
  try{
    if(approval){await call(`/api/battle/teams/${encodeURIComponent(b.dataset.teamId)}/${b.dataset.teamApproval}`,"POST",{userId:b.dataset.user})}
    else{const accepted=b.dataset.respond==="accept";await call(`/api/battle/rooms/${encodeURIComponent(b.dataset.inviteRoom)}/respond`,"POST",{accept:accepted});if(accepted){roomId=b.dataset.inviteRoom;await refreshRoom(false);note("Challenge accepted. Mark Ready when your team is prepared.");return;}}
    await loadTeams();note("Team updated.");
  }catch(err){note(err.message,true)}finally{b.disabled=false}
};
$("joinForm").onsubmit=async e=>{e.preventDefault();try{note("");await joinLookup($("joinCode").value)}catch(err){note(err.message,true)}};
$("createForm").onsubmit=async e=>{e.preventDefault();const btn=e.submitter;btn.disabled=true;try{note("");const data=await call("/api/battle/create","POST",{title:$("createTitle").value,format:$("createFormat").value,subject:$("createSubject").value,questionCount:Number($("createCount").value),difficulty:$("createDifficulty").value,teamId:$("createMyTeam").value,opponentCode:$("opponentTeamCode").value});showRoom(data);note("Challenge sent! The opposing team's leader can accept or decline it.");}catch(err){note(err.message,true)}finally{btn.disabled=false}};
$("arenaTeams").addEventListener("click",async e=>{const btn=e.target.closest("[data-action]");if(!btn)return;const action=btn.dataset.action;if(action==="customise"){
  const cur=room.teams[btn.dataset.team];const name=await GBUI.promptValue("Team name","Choose your team name",cur.name,{maxLength:50});if(name===null)return;const logoName=await GBUI.promptValue("Team badge",`Choose: ${catalog.logos.join(", ")}`,cur.logo,{maxLength:20,validate:v=>catalog.logos.includes(v.trim().toLowerCase())?"":"Choose a logo from the gallery."});if(logoName===null)return;try{await roomAction("team",{name,logo:logoName.trim().toLowerCase()})}catch(err){note(err.message,true)}return;
}
  btn.disabled=true;try{let body={team:btn.dataset.team,userId:btn.dataset.user};if(action==="ready")body={ready:btn.dataset.ready==="1"};if(action==="remove"&&!await GBUI.confirmAction("Remove teammate?","This member will leave the match room.","Remove"))return;await roomAction(action,body);note(action==="request"?"Join request sent to the team leader.":"Updated.");}catch(err){note(err.message,true)}finally{btn.disabled=false}
});
$("arenaTeams").addEventListener("click",async e=>{const b=e.target.closest("#startBattle");if(!b||b.disabled)return;b.disabled=true;try{await roomAction("start",{});note("Battle started! Good luck.")}catch(err){b.disabled=false;note(err.message,true)}});
async function sendBattleAnswer(action){
  if(answerBusy)return;
  if(action==="suggest"&&room?.leader)return note("Only team members suggest answers to the leader.",true);
  if(selectedAnswer===null)return note("Choose an answer first.",true);
  const answer=selectedAnswer,round=room?.round,btn=$(action==="answer"?"submitAnswer":"suggestAnswer");
  answerBusy=true;btn.disabled=true;
  const prior=btn.textContent;btn.textContent=action==="answer"?"Submitting…":"Sending…";
  try{
    await roomAction(action,{answer});
    note(action==="answer"?"Final answer submitted.":"Suggestion shared with your team leader.");
  }catch(err){note(err.message,true)}
  finally{answerBusy=false;btn.textContent=prior;if(room?.round===round)updateTimer();}
}
$("submitAnswer").onclick=()=>sendBattleAnswer("answer");
$("suggestAnswer").onclick=()=>sendBattleAnswer("suggest");
$("battleChatForm").onsubmit=async e=>{
  e.preventDefault();
  const input=$("battleChatInput"),text=input.value.trim();
  if(!text||chatBusy||!room?.myTeam)return;
  chatBusy=true;
  const key="pending-"+Date.now()+"-"+Math.random().toString(36).slice(2);
  const temp={id:key,studentName:"You",text,createdAt:new Date().toISOString(),mine:true,pending:true};
  pendingChat=key;room.chat=[...(room.chat||[]),temp];renderChat(room.chat);
  input.value="";
  try{
    const reply=await roomAction("chat",{text});
    if(room?.chat){
      const committed=reply.message||{...temp,pending:false};
      // A poll can race with the acknowledgement: never render a duplicate.
      room.chat=[...room.chat.filter(m=>m.id!==key&&m.id!==committed.id),committed]
        .sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
      renderChat(room.chat);
    }
  }catch(err){
    if(room?.chat){room.chat=room.chat.filter(m=>m.id!==key);renderChat(room.chat);}
    if(!input.value.trim())input.value=text;
    note(err.message,true);
  }finally{pendingChat=null;chatBusy=false;}
};
$("chatRefresh").onclick=()=>{chatLast="";refreshChat()};
$("jumpToTeamChat").onclick=()=>$("battleChatCard").scrollIntoView({behavior:"smooth",block:"start"});
$("chatBack").onclick=()=>$("battleGame").scrollIntoView({behavior:"smooth",block:"start"});
$("battleReview").addEventListener("click",async e=>{const save=e.target.closest("[data-save-battle]");if(save){save.disabled=true;try{await call("/api/learning/saved","POST",{source:"battle",roomId,questionId:save.dataset.saveBattle});save.textContent="✓ Saved to Learning Centre";note("Question bookmarked in My Learning Centre.");}catch(err){save.disabled=false;note(err.message,true);}return;}
if(e.target.id==="returnFromBattle"){showHome();return;}if(e.target.id!=="rematchBtn")return;e.target.disabled=true;try{const r=await roomAction("rematch",{});showRoom(r.room);note("Rematch created! Everyone can confirm Ready again.");}catch(err){note(err.message,true)}finally{if(e.target.isConnected)e.target.disabled=false}});
$("exitRoom").onclick=showHome;
$("copyCode").onclick=async()=>{try{await navigator.clipboard.writeText(room.code);note("Match code copied.")}catch{note("Match code: "+room.code)}};
$("shareLink").onclick=async()=>{const link=roomLink();try{if(navigator.share)await navigator.share({title:"Brainz Battle Arena",url:link});else{await navigator.clipboard.writeText(link);note("Invitation link copied.")}}catch{note("Share this link: "+link)}};
$("battleRecent").addEventListener("click",e=>{if(e.target.closest('#showAllBattleMatches')){const pane=document.createElement('section');pane.id='battleMatchHistory';pane.className='battle-history-full';pane.innerHTML='<div class="battle-history-panel"><div class="section-head"><h2>Match history</h2><button class="btn light" id="closeBattleHistory">Close ✕</button></div><div id="allBattleMatches"></div></div>';document.body.appendChild(pane);pane.querySelector('#closeBattleHistory').onclick=()=>pane.remove();let shown=0;const render=()=>{const box=pane.querySelector('#allBattleMatches');shown=Math.min(shown+25,allMatchRows.length);box.innerHTML=allMatchRows.slice(0,shown).map(matchCard).join('')+(!matchesExhausted||shown<allMatchRows.length?'<button class="btn light" id="moreBattleMatches">Show more</button>':'')};render();pane.addEventListener('click',async event=>{if(event.target.closest('#moreBattleMatches')){const button=event.target.closest('#moreBattleMatches');button.disabled=true;button.textContent='Loading…';try{if(shown>=allMatchRows.length&&!matchesExhausted){const next=await call('/api/battle/mine?limit=25&offset='+allMatchRows.length);allMatchRows.push(...next);matchesExhausted=next.length<25;}render();}catch(error){note(error.message,true);button.disabled=false;button.textContent='Try again';}return;}const roomButton=event.target.closest('[data-room]');if(roomButton){pane.remove();roomId=roomButton.dataset.room;refreshRoom(false)}});return;}const b=e.target.closest("[data-room]");if(!b)return;roomId=b.dataset.room;refreshRoom(false)});
$("showLeaderboard").onclick=async()=>{$("arenaHome").hidden=true;$("arenaRoom").hidden=true;$("battleLeaderboard").hidden=false;try{const rows=await call("/api/battle/leaderboard?mode="+encodeURIComponent($("rankMode").value));$("battleLeaders").innerHTML=rows.length?rows.map((r,i)=>`<div class="battle-leader-row"><span>${i+1}.</span><img src="${logo(r.logo)}" alt=""><b>${esc(r.team)}</b><small>${r.wins} wins / ${r.played} played • ${r.points} points</small></div>`).join(""):'<p>No completed matches yet.</p>';}catch(err){note(err.message,true)}};
$("leaderboardBack").onclick=showHome;$("rankMode").onchange=()=>$("showLeaderboard").click();
async function init(){try{const background=[loadRecent(),loadTeams()];catalog=await call("/api/battle/catalog");$("createSubject").innerHTML=catalog.subjects.map(s=>`<option>${esc(s)}</option>`).join("");$("createFormat").innerHTML=Object.keys(catalog.formats).map(v=>`<option ${v==="1v1"?"selected":""}>${esc(v)}</option>`).join("");logoChoices("teamLogos","teamLogo");await Promise.all(background);const params=new URLSearchParams(location.search);const opponent=params.get("opponent"),id=params.get("room"),code=params.get("code");if(opponent){$("createForm").hidden=false;$("opponentTeamCode").value=opponent;const format=`${myTeams.find(t=>t.id===$("createMyTeam").value)?.members?.length||1}v${Number(params.get("size")||1)}`;if([...$("createFormat").options].some(o=>o.value===format))$("createFormat").value=format;}if(id){roomId=id;await refreshRoom(false);}else if(code){$("joinForm").hidden=false;$("joinCode").value=code;await joinLookup(code);}}catch(err){note(err.message,true)}}
// Adaptive, non-overlapping polling: faster during live play, minimal traffic
// for completed rooms. This is a conservative bridge until a scalable push
// service can be deployed; polling is NOT a WebSocket substitute at 1k users.
async function battlePollLoop(){
  if(roomId&&!document.hidden)await refreshRoom();
  const next=room?.status==="active"?2500:room?.status==="waiting"?4000:roomId?20000:10000;
  setTimeout(battlePollLoop,next+Math.floor(Math.random()*600));
}
setTimeout(battlePollLoop,1200);
setInterval(updateTimer,200);
// Refresh invitations without refetching Explore Teams on every cycle.
// Use explicit refresh/search for discovery; keep lobby notices responsive.
setInterval(()=>{if(!roomId&&!document.hidden)loadTeams({explore:false}).catch(()=>{})},6000);
setInterval(()=>{if(!document.hidden)call('/api/learning/partners/presence','POST',{}).catch(()=>{})},60000);
void call('/api/learning/partners/presence','POST',{}).catch(()=>{});
setInterval(()=>{if(!roomId&&!document.hidden)loadRecent()},60000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden){if(roomId)refreshRoom();else loadTeams().catch(()=>{})}});
init();
})();
