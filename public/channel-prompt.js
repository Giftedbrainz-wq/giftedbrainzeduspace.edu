/* Lightweight, opt-in WhatsApp channel welcome prompt.
   No network requests, no account data, no third-party code or trackers. */
(()=>{'use strict';
  if(window.top!==window.self||!document.body?.hasAttribute('data-channel-prompt'))return;
  const CHANNEL='https://whatsapp.com/channel/0029VbC1jX73QxRtsF3Kms3r';
  const KEY='gbChannelPromptDecisionV1';
  const DAY=24*60*60*1000;
  const read=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'null')}catch{return null}};
  const record=(action)=>{try{localStorage.setItem(KEY,JSON.stringify({action,time:Date.now()}))}catch{}};
  const previous=read();
  // Following is voluntary; clicking the link is not proof the user followed.
  const cooldown=previous?.action==='opened'?30*DAY:7*DAY;
  if(previous&&Number.isFinite(Number(previous.time))&&Date.now()-Number(previous.time)<cooldown)return;
  let dialog=null,previousFocus=null;
  const close=(choice)=>{
    if(!dialog)return;
    if(choice)record(choice);
    dialog.remove(); dialog=null;
    document.body.classList.remove('gb-channel-prompt-open');
    previousFocus?.focus?.({preventScroll:true});
  };
  const show=()=>{
    if(dialog||document.hidden||document.querySelector('.install-modal,.gb-app-dialog,.critical-modal'))return false;
    if(document.getElementById('gbIntro')&&!document.getElementById('gbIntro').hidden)return false;
    previousFocus=document.activeElement;
    dialog=document.createElement('div');dialog.id='gbChannelWelcome';dialog.className='gb-channel-prompt-overlay';
    dialog.innerHTML=`<section class="gb-channel-prompt" role="dialog" aria-modal="true" aria-labelledby="gbChannelHeading" aria-describedby="gbChannelDesc">
      <button type="button" class="gb-channel-close" data-dismiss aria-label="Close dialog">×</button>
      <span class="gb-channel-symbol" aria-hidden="true">✦</span>
      <h2 id="gbChannelHeading">Follow our WhatsApp Channel</h2>
      <p id="gbChannelDesc">Get EduSpace updates, new learning materials and important announcements.</p>
      <a class="gb-channel-follow" href="${CHANNEL}" target="_blank" rel="noopener noreferrer" data-follow>Follow the Channel ↗</a>
      <button type="button" class="gb-channel-later" data-dismiss>Not now</button>
    </section>`;
    document.body.appendChild(dialog);document.body.classList.add('gb-channel-prompt-open');
    const closeButton=dialog.querySelector('.gb-channel-close');closeButton?.focus({preventScroll:true});
    dialog.addEventListener('click',event=>{
      if(event.target.closest('[data-follow]')){close('opened');return;}
      if(event.target===dialog||event.target.closest('[data-dismiss]'))close('dismissed');
    });
    dialog.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();close('dismissed')}
      if(event.key==='Tab'){
        const focusables=[...dialog.querySelectorAll('button,a[href]')];
        const first=focusables[0],last=focusables[focusables.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
      }
    });
    return true;
  };
  function schedule(){
    // Wait until the intro has finished; retry briefly if another dialog is visible.
    let attempts=0;
    const run=()=>{
      if(document.hidden){document.addEventListener('visibilitychange',()=>{if(!document.hidden)run()},{once:true});return;}
      if(show()||++attempts>16)return;
      setTimeout(run,450);
    };
    setTimeout(run,document.getElementById('gbIntro')?5300:1100);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});
  else schedule();
})();
