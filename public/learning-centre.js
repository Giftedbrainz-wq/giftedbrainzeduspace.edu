(()=>{'use strict';
if(!window.GB?.token?.()){location.replace('/login.html');return;}
GBUI.mount({active:'/learning-centre.html'});
const $=id=>document.getElementById(id),esc=GBUI.esc;
let state={mistakes:[],saved:[],plans:[],badges:[],resources:[],overview:{counts:{}}},quiz=null;
const api=async(path,method='GET',body)=>GB.api('/api/learning/'+path,{method,...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});
function say(msg,err=false){$('learningStatus').innerHTML=msg?`<div class="learning-feedback ${err?'error':''}">${esc(msg)}</div>`:'';}
// Render permitted mathematical delimiters safely after text has been escaped.
// This is optional; the notebook works offline without the external renderer.
function renderStudyMath(node){
 if(typeof window.renderMathInElement!=="function"||!node)return;
 try{window.renderMathInElement(node,{throwOnError:false,delimiters:[
   {left:"$$",right:"$$",display:true},{left:"\\[",right:"\\]",display:true},
   {left:"\\(",right:"\\)",display:false},{left:"$",right:"$",display:false}
 ]});}catch{}
}
function todayLocalDate(){const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');}
function textDate(date){try{return new Date(date+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});}catch{return date;}}
function questionMarkup(q){const opts=Array.isArray(q.options)?q.options:[];return `<p>${esc(q.question)}</p>${opts.length?`<ol class="learning-options" type="A">${opts.map(x=>`<li>${esc(x)}</li>`).join('')}</ol>`:''}`;}
function details(q){const opts=Array.isArray(q.options)?q.options:[];const correct=Number.isInteger(q.correctIndex)&&opts[q.correctIndex]!==undefined?`<p><strong>Correct answer:</strong> ${esc(opts[q.correctIndex])}</p>`:'';return `<div class="learning-explain" role="note">${correct}<strong>Explanation</strong><p>${esc(q.explanation||'An explanation has not yet been provided. Review your notes or ask your tutor for help.')}</p></div>`;}
function renderQuestions(type){const list=type==='mistakes'?state.mistakes:state.saved;const container=$(type==='mistakes'?'mistakeList':'savedList');
 container.innerHTML=list.length?list.map(q=>`<article class="learning-item"><small>${esc(q.subject||'General')} ${q.topic?'· '+esc(q.topic):''} · ${esc(q.source==='assessment_hub'?'Assessment Hub':q.source==='battle'?'Battle Arena':'My entry')}</small>${questionMarkup(q)}<span class="learning-pill ${q.mastered?'done':''}">${type==='mistakes'?(q.mastered?'✓ Mastered':'Needs revision'):'⭐ Bookmarked'}</span><div class="learning-actions"><button type="button" class="btn light" data-explain="${esc(q.id)}" data-list="${type}">💡 Ask for Explanation</button>${type==='mistakes'?`<button type="button" class="btn light" data-master="${esc(q.id)}">${q.mastered?'Revisit':'Mark mastered'}</button>`:''}<button type="button" class="btn light" data-remove="${esc(q.id)}" data-list="${type}">Remove</button></div><div id="explain-${esc(q.id)}" hidden>${details(q)}</div></article>`).join(''):'<div class="learning-empty">No questions here yet. Add one above to begin your revision list.</div>';
}
function renderPlans(){const today=todayLocalDate();$('planList').innerHTML=state.plans.length?state.plans.map(x=>{
 const r=x.resource;const raw=r&&!r.locked?String(r.url||''):'';
 const url=/^https?:\/\/[^\s]+$/i.test(raw)||/^\/(?!\/)[a-zA-Z0-9/?&=_%.-]+$/.test(raw)?raw:'';
 return `<article class="learning-item"><small>${esc(textDate(x.date))}${x.time?' • '+esc(x.time):''} ${!x.completed&&x.date<=today?' • Due':''}</small><h3>${esc(x.title)}</h3><p class="learning-muted">${esc(x.subject||'Independent study')} · ${esc(x.type)}</p><span class="learning-pill ${x.completed?'done':''}">${x.completed?'Completed':'Scheduled'}</span>${r?`<p><small>${esc(r.title)}${r.locked?' 🔒 Premium resource':''}</small></p>${url?`<a class="resource-link" href="${esc(url)}" ${url.startsWith('http')?'target="_blank" rel="noopener noreferrer"':''}>Open resource ↗</a>`:''}`:''}<div class="learning-actions"><button class="btn light" type="button" data-complete="${esc(x.id)}">${x.completed?'Mark not completed':'✓ Complete'}</button><button class="btn light" type="button" data-remove="${esc(x.id)}" data-list="plans">Remove</button></div></article>`;
 }).join(''):'<div class="learning-empty">Your study plan is empty. Add an activity above.</div>';
}
function renderBadges(){ $('badgeList').innerHTML=state.badges.map(x=>`<article class="learning-item learning-badge ${x.earned?'':'unearned'}"><div class="symbol">${esc(x.icon)}</div><div style="flex:1;min-width:0"><h3>${esc(x.title)} ${x.earned?'✓':''}</h3><p class="learning-muted">${esc(x.description)}</p><small>${x.current} / ${x.target} ${x.earned?'· Earned':'· In progress'}</small><div class="learning-progress"><span style="width:${Math.max(0,Math.min(100,x.progress))}%"></span></div></div></article>`).join('');}
function renderOverview(){const c=state.overview.counts||{};$('learningSummary').innerHTML=[['📕','Mistakes to revise',c.mistakes],['📅','Upcoming tasks',c.plans],['⭐','Saved questions',c.saved],['🏅','Badges earned',(state.badges||[]).filter(x=>x.earned).length]].map(([icon,label,count])=>`<div class="learning-stat"><span>${icon} ${label}</span><strong>${Number(count)||0}</strong></div>`).join('');const hub=state.overview.hub||{};const linkedDevices=Math.max(0,Number(hub.linkedDevices)||0),maxDevices=Math.max(1,Number(hub.maxDevices)||2);$('hubLinkTools').hidden=!(hub.enabled&&linkedDevices<maxDevices);$('hubNotice').hidden=false;$('hubNotice').textContent=hub.enabled?`${linkedDevices?'EduSpace linked successfully. ':''}Assessment Hub: ${linkedDevices} of ${maxDevices} devices linked.${linkedDevices>=maxDevices?' Maximum of 2 linked devices reached.':' You can link '+(maxDevices-linkedDevices)+' more.'}`:'Assessment Hub connection is currently unavailable.';if(linkedDevices>=maxDevices){$('hubLinkResult').hidden=true;$('hubLinkResult').textContent='';}}
function renderMistakeBulkControls(){
  const quizzes=new Map();
  for(const row of state.mistakes){const id=String(row.quizId||row.testId||row.cbtId||row.attemptId||'');if(row.source==='assessment_hub'&&id)quizzes.set(id,row.quizTitle||row.testTitle||(row.attemptId===id?'CBT attempt '+id:'CBT '+id));}
  const sel=$('removeMistakeCbt'),btn=$('clearMistakeCbt');
  sel.hidden=btn.hidden=!quizzes.size;
  sel.innerHTML=[...quizzes].map(([id,title])=>`<option value="${esc(id)}">${esc(title)}</option>`).join('');
  $('clearMistakes').disabled=!state.mistakes.length;
}
function renderAll(){renderMistakeBulkControls();renderQuestions('mistakes');renderQuestions('saved');renderPlans();renderBadges();renderOverview();renderStudyMath($('mistakeList'));renderStudyMath($('savedList'));}
async function load(){try{const {overview,mistakes,plans,saved,badges,resources}=await api('bootstrap');Object.assign(state,{overview,mistakes,plans,saved,badges,resources});$('planResource').innerHTML='<option value="">No linked resource</option>'+resources.map(x=>`<option value="${esc(x.type+':'+x.id)}">${esc(x.type.toUpperCase()+' · '+x.subject+' · '+x.title+(x.locked?' 🔒':''))}</option>`).join('');renderAll();}catch(e){say(e.message||'Unable to load Learning Centre.',true);}}
document.querySelectorAll('[data-tab]').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b===btn)));['mistakes','plans','saved','badges'].forEach(x=>$('tab-'+x).hidden=x!==btn.dataset.tab);history.replaceState(null,'','#'+btn.dataset.tab);}));
function openTab(tab){const target=document.querySelector('[data-tab="'+tab+'"]');target?.click();}
for(const [formId,route] of [['mistakeForm','mistakes'],['saveForm','saved']]){$(formId).addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget,btn=form.querySelector('[type=submit]');btn.disabled=true;try{const data=Object.fromEntries(new FormData(form));
 const opts=(data.optionLines||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 if(opts.length && opts.length<2)throw new Error('Enter at least two options, or leave the options empty.');
 if(opts.length>6)throw new Error('Enter no more than six options.');
 const choice=String(data.correctChoice||'').trim().toUpperCase();
 if(choice && (!opts.length||choice.charCodeAt(0)-65>=opts.length))throw new Error('Choose a correct option that appears in your list.');
 if(opts.length){data.options=opts;if(choice)data.correctIndex=choice.charCodeAt(0)-65;}
 delete data.optionLines;delete data.correctChoice;
 await api(route,'POST',data);form.reset();form.closest('details').open=false;say('Question saved successfully.');await load();}catch(err){say(err.message,true);}finally{btn.disabled=false;}});}
$('planForm').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget,btn=form.querySelector('[type=submit]');btn.disabled=true;try{const data=Object.fromEntries(new FormData(form));const value=data.resource||'';delete data.resource;const pos=value.indexOf(':');if(pos>0){data.resourceType=value.slice(0,pos);data.resourceId=value.slice(pos+1);}await api('plans','POST',data);form.reset();form.querySelector('[name=date]').value=todayLocalDate();say('Study activity added.');await load();}catch(err){say(err.message,true);}finally{btn.disabled=false;}});
document.querySelector('main').addEventListener('click',async e=>{const b=e.target.closest('[data-explain],[data-remove],[data-master],[data-complete]');if(!b)return;
 if(b.dataset.explain){const panel=$('explain-'+b.dataset.explain);panel.hidden=!panel.hidden;b.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden)renderStudyMath(panel);return;}
 if(b.dataset.remove&&!await GBUI.confirmAction('Remove learning item?', 'This item will be removed from your personal list.', 'Remove item'))return;
 b.disabled=true;try{
 if(b.dataset.master){const q=state.mistakes.find(x=>x.id===b.dataset.master);await api('mistakes/'+encodeURIComponent(q.id),'PATCH',{mastered:!q.mastered});}
 if(b.dataset.complete){const q=state.plans.find(x=>x.id===b.dataset.complete);await api('plans/'+encodeURIComponent(q.id),'PATCH',{completed:!q.completed});}
 if(b.dataset.remove)await api(b.dataset.list+'/'+encodeURIComponent(b.dataset.remove),'DELETE');
 await load();say('Changes saved.');
 }catch(err){say(err.message,true)}finally{b.disabled=false;}
});

function startQuiz(type){
  const questions=(type==='mistakes'?state.mistakes:state.saved).filter(x=>Array.isArray(x.options)&&x.options.length>=2&&Number.isInteger(x.correctIndex)&&x.correctIndex>=0&&x.correctIndex<x.options.length);
  if(!questions.length){say('A revision quiz needs questions with answer options and a verified correct answer. More questions will be available after Assessment Hub is linked.',true);return;}
  quiz={type,questions:questions.slice(0,15),index:0,correct:0,submitted:false};renderQuiz();
}
function renderQuiz(){
  if(!quiz)return;const target=$(quiz.type==='mistakes'?'mistakeQuiz':'savedQuiz');target.hidden=false;
  if(quiz.index>=quiz.questions.length){target.innerHTML=`<h3>Revision complete</h3><p>You answered <strong>${quiz.correct} of ${quiz.questions.length}</strong> questions correctly.</p><div class="learning-actions"><button type="button" class="btn primary" data-quiz-close>Finish revision</button></div>`;return;}
  const q=quiz.questions[quiz.index];target.innerHTML=`<p class="muted">Question ${quiz.index+1} of ${quiz.questions.length} · ${esc(q.subject)}</p><h3>${esc(q.question)}</h3><form id="revisionQuizForm">${q.options.map((o,i)=>`<label class="quiz-option"><input type="radio" name="answer" value="${i}" required><span><strong>${'ABCDEF'[i]}.</strong> ${esc(o)}</span></label>`).join('')}<div class="learning-actions"><button class="btn primary" type="submit">Check answer</button><button class="btn light" type="button" data-quiz-close>Exit quiz</button></div></form><div id="revisionAnswer" aria-live="polite"></div>`;
  renderStudyMath(target);
}
function closeQuiz(){if(!quiz)return;$(quiz.type==='mistakes'?'mistakeQuiz':'savedQuiz').hidden=true;quiz=null;}
$('quizMistakes').addEventListener('click',()=>startQuiz('mistakes'));
$('clearMistakes').addEventListener('click',async()=>{
 if(!state.mistakes.length||!await GBUI.confirmAction('Clear Mistake Notebook?','Every saved mistake will be removed. This cannot be undone.','Clear notebook',{requirePhrase:'CLEAR NOTEBOOK'}))return;
 const b=$('clearMistakes');b.disabled=true;try{await api('mistakes','DELETE',{});await load();say('Your Mistake Notebook has been cleared.');}catch(e){say(e.message,true);}finally{b.disabled=false;}
});
$('clearMistakeCbt').addEventListener('click',async()=>{
 const id=$('removeMistakeCbt').value;if(!id||!await GBUI.confirmAction('Remove this CBT from the notebook?','All mistakes saved from this CBT will be removed.','Remove CBT mistakes'))return;
 const b=$('clearMistakeCbt');b.disabled=true;try{const r=await api('mistakes','DELETE',{quizId:id});await load();say((r.removed||0)+' question(s) removed from that CBT.');}catch(e){say(e.message,true);}finally{b.disabled=false;}
});
$('quizSaved').addEventListener('click',()=>startQuiz('saved'));
document.addEventListener('submit',e=>{if(e.target.id!=='revisionQuizForm'||!quiz)return;
 e.preventDefault();if(quiz.submitted)return;const rawSelected=new FormData(e.target).get('answer');if(rawSelected===null)return;
 const selected=Number(rawSelected),q=quiz.questions[quiz.index],correct=selected===q.correctIndex;
 if(!Number.isInteger(selected)||selected<0||selected>=q.options.length)return;quiz.submitted=true;if(correct)quiz.correct++;
 e.target.querySelectorAll('input').forEach(input=>{input.disabled=true;const line=input.closest('.quiz-option');line.classList.toggle('correct',Number(input.value)===q.correctIndex);line.classList.toggle('wrong',Number(input.value)===selected&&!correct);});
 e.target.querySelector('[type=submit]').disabled=true;
 $('revisionAnswer').innerHTML=`<div class="learning-explain"><strong>${correct?'✓ Correct!':'Review this answer'}</strong><p>${esc(q.explanation||'The correct choice is '+q.options[q.correctIndex]+'.')}</p><button type="button" class="btn primary" data-quiz-next>Next →</button></div>`;
 renderStudyMath($('revisionAnswer'));
});
document.addEventListener('click',e=>{if(e.target.closest('[data-quiz-close]'))closeQuiz();if(e.target.closest('[data-quiz-next]')&&quiz){quiz.index++;quiz.submitted=false;renderQuiz();}});
$('generateHubCode').addEventListener('click',async e=>{const btn=e.currentTarget;btn.disabled=true;try{const x=await api('integration/link-code','POST',{});$('hubLinkResult').hidden=false;$('hubLinkResult').textContent='One-time code: '+x.code+' (expires in 15 minutes). Use only on the official Assessment Hub website.';}catch(err){say(err.message,true)}finally{btn.disabled=false;}});
$('planForm').querySelector('[name=date]').value=todayLocalDate();
const hash=location.hash.slice(1);if(['mistakes','saved','plans','badges'].includes(hash))openTab(hash);load();
})();
