/* Gifted Brainz — JAMB countdown. Mounts into any [data-jamb-countdown] element.
   The date comes from the admin setting (/api/jamb-countdown) and refreshes every 5 minutes. */
(function(){
  const els=[...document.querySelectorAll("[data-jamb-countdown]")];
  if(!els.length) return;
  let target=0,label="JAMB UTME",offset=0,timer=null;
  const pad=n=>String(n).padStart(2,"0");
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function render(){
    if(!target) return;
    let ms=Math.max(0,target-(Date.now()+offset));
    const d=Math.floor(ms/864e5),h=Math.floor(ms/36e5)%24,m=Math.floor(ms/6e4)%60,s=Math.floor(ms/1e3)%60;
    const when=new Date(target).toLocaleDateString(undefined,{weekday:"short",day:"numeric",month:"long",year:"numeric",hour:"numeric",minute:"2-digit",timeZone:"Africa/Lagos"});
    const html= ms<=0
      ? `<div class="jc-title">${esc(label)}</div><div class="jc-done">It's exam day! Best of luck 🎉</div>`
      : `<div class="jc-title">Countdown to ${esc(label)}</div>
         <div class="jc-units">
           <div class="jc-unit"><b>${d}</b><span>Days</span></div>
           <div class="jc-unit"><b>${pad(h)}</b><span>Hours</span></div>
           <div class="jc-unit"><b>${pad(m)}</b><span>Minutes</span></div>
           <div class="jc-unit"><b>${pad(s)}</b><span>Seconds</span></div>
         </div><div class="jc-date">${esc(when)}</div>`;
    els.forEach(el=>{el.innerHTML=html;el.hidden=false});
  }
  async function load(){
    try{
      const r=await fetch("/api/jamb-countdown",{cache:"no-store"});
      const x=await r.json();
      const t=Date.parse(x.target);
      if(t){target=t;label=x.label||label;if(x.now)offset=x.now-Date.now();}
    }catch{ if(!target) target=Date.parse("2027-03-14T23:00:00Z"); }
    render();
    if(!timer) timer=setInterval(render,1000);
  }
  els.forEach(el=>el.hidden=true);
  load(); setInterval(load,5*60*1000);
})();
