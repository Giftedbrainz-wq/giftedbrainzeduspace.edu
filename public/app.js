/* Defensive global: pages use GB from inline handlers; api.js replaces this with the full client.
   Keeping a safe placeholder prevents a stale/missing API asset from producing the misleading
   "GB is not defined" ReferenceError. */
if (!window.GB) window.GB = {
  token: () => { try { return localStorage.getItem("gbToken") || sessionStorage.getItem("gbToken") || ""; } catch { return ""; } },
  api: async () => { throw new Error("Gifted Brainz API client is unavailable. Please refresh the page."); },
  logout: () => { try { fetch('/api/auth/logout',{method:'POST',credentials:'include',keepalive:true}).catch(()=>{});localStorage.removeItem("gbToken");localStorage.removeItem("gbAdminToken");localStorage.removeItem("gbUser");sessionStorage.removeItem("gbToken");sessionStorage.removeItem("gbUser"); } catch {} location="/"; }
};

/*
 * Authentication failsafe: stop native form navigation when an auth handler
 * fails to attach. Events are marked in a WeakSet rather than by adding custom
 * properties to browser SubmitEvent objects.
 */
(function installAuthSubmitGuard(){
  if (window.__gbAuthSubmitGuardInstalled) return;
  window.__gbAuthSubmitGuardInstalled = true;
  const handledEvents = new WeakSet();
  window.GBMarkAuthEventHandled = function(event){
    if(event && typeof event === "object") handledEvents.add(event);
  };
  document.addEventListener("submit", function(event){
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const path = String(location.pathname || "").replace(/\/+$/, "").toLowerCase();
    const adminLogin = path.endsWith("/admin.html") && form.id === "lf";
    const studentLogin = path.endsWith("/login.html") && form.id === "f";
    const studentRegister = path.endsWith("/register.html") && form.id === "f";
    if (!adminLogin && !studentLogin && !studentRegister) return;
    // Prevent the browser's native GET submission immediately, even if an
    // authentication script could not initialise.
    event.preventDefault();
    setTimeout(function(){
      if (handledEvents.has(event)) return;
      const message = form.closest(".formbox")?.querySelector("#lm, #msg");
      if (message) {
        message.className = "error";
        message.textContent = "The sign-in or registration handler did not start, so nothing was submitted. Refresh the page and try again. If the problem continues, clear the site's cached data and reopen it.";
      }
    }, 0);
  }, true);
})();

(function(){
  function banner(){
    const b=document.getElementById("networkBanner");
    if(!b)return;
    const update=()=>{
      b.textContent=navigator.onLine?"":"You are disconnected from the internet. Connect to the internet to continue.";
      b.classList.toggle("show",!navigator.onLine);
    };
    addEventListener("online",update,{passive:true});
    addEventListener("offline",update,{passive:true});
    update();
  }
  window.notifyOffline=()=>{
    const message="You are disconnected from the internet. Please connect to the internet to continue.";
    if(window.GBUI?.message){void window.GBUI.message(message,{title:"Connection lost",tone:"error"});return;}
    let host=document.getElementById("gbOfflineMessage");
    if(!host){host=document.createElement("div");host.id="gbOfflineMessage";host.setAttribute("role","alert");host.style="position:fixed;z-index:10000;left:16px;right:16px;bottom:20px;max-width:520px;margin:auto;padding:15px 18px;background:#fff;border:1px solid #dba1a1;border-left:5px solid #b42318;border-radius:12px;box-shadow:0 12px 36px #0002;color:#172b4d;font-weight:700";document.body.appendChild(host);}
    host.textContent=message;
  };
  window.showNetworkError=el=>{if(el){el.className="error";el.textContent="Network error. Please connect to the internet and try again."}};
  banner();
})();

/* PWA install support shared by all portal pages. The install control is
   intentionally visible whenever the site is running in a browser and the
   app is not currently installed. On browsers without beforeinstallprompt,
   it opens platform-specific installation instructions instead. */
(function(){
  let deferred=null;
  let modal=null;
  const standalone=()=>matchMedia("(display-mode: standalone)").matches || navigator.standalone===true;
  const buttons=()=>Array.from(document.querySelectorAll("#install, .install-btn"));
  const isInstalled=()=>standalone();

  function hide(){
    buttons().forEach(b=>{b.hidden=true;b.setAttribute("aria-hidden","true")});
    closeModal();
  }
  function reveal(){
    if(isInstalled()) return hide();
    buttons().forEach(b=>{b.hidden=true;b.setAttribute("aria-hidden","true")});
  }
  function instructions(){
    const ua=navigator.userAgent;
    if(/iPhone|iPad|iPod/i.test(ua)) return 'On iPhone or iPad: tap Share in Safari, then choose “Add to Home Screen”.';
    if(/Android/i.test(ua)) return 'On Android: open the browser menu (⋮) and choose “Install app” or “Add to Home screen”.';
    return 'On desktop: use the install icon in your browser address bar, or open the browser menu and choose “Install Gifted Brainz Tutorial”.';
  }
  function closeModal(){if(modal){modal.remove();modal=null}}
  function openModal(){
    if(isInstalled()||modal)return;
    modal=document.createElement("div");
    modal.className="install-modal";
    modal.innerHTML='<div class="install-card" role="dialog" aria-modal="true" aria-label="Install Gifted Brainz Tutorial">'+
      '<img src="/assets/icon-192.png" alt="Gifted Brainz Tutorial" width="76" height="76">'+
      '<h3>Install Gifted Brainz Tutorial</h3>'+
      '<p class="muted">Install the app for faster access, a home-screen icon and offline-ready pages.</p>'+
      '<p class="install-steps muted"></p>'+
      '<button class="btn gold" data-install-now type="button" style="width:100%">'+(deferred?'Install App':'Show Install Steps')+'</button>'+
      '<button class="btn light" data-install-later type="button" style="width:100%;margin-top:8px">Not now</button>'+
      '</div>';
    document.body.appendChild(modal);
    modal.querySelector(".install-steps").textContent=deferred?"Tap Install App to continue.":instructions();
    modal.addEventListener("click",e=>{
      if(e.target!==modal && !e.target.closest("[data-install-later]"))return;
      // "Not now" is remembered for a week, so the prompt does not reappear on
      // every single visit.
      try{localStorage.setItem("gbInstallDismissed",String(Date.now()))}catch{}
      closeModal();
    });
  }
  async function promptInstall(){
    if(isInstalled()) return hide();
    if(deferred){
      const promptEvent=deferred;
      deferred=null;
      try{
        await promptEvent.prompt();
        const choice=await promptEvent.userChoice;
        if(choice?.outcome==="accepted"){hide();return;}
      }catch{}
      reveal();
      if(modal){
        modal.querySelector(".install-steps").textContent=instructions();
        const action=modal.querySelector("[data-install-now]");
        if(action)action.textContent="Show Install Steps";
      }
      return;
    }
    if(modal){
      modal.querySelector(".install-steps").textContent=instructions();
      return;
    }
    openModal();
  }

  addEventListener("beforeinstallprompt",e=>{
    e.preventDefault();
    deferred=e;
    reveal();
    if(modal){
      const action=modal.querySelector("[data-install-now]"),steps=modal.querySelector(".install-steps");
      if(action)action.textContent="Install App";
      if(steps)steps.textContent="Tap Install App to continue.";
    }
    // Installation promotion removed from EduSpace navigation.
  });
  addEventListener("appinstalled",()=>{deferred=null;try{localStorage.setItem("gbWasInstalled","1")}catch{};hide()});

  if(navigator.getInstalledRelatedApps){
    navigator.getInstalledRelatedApps().then(apps=>{if(apps?.length)hide();else reveal()}).catch(reveal);
  }

  document.addEventListener("click",e=>{
    if(e.target.closest("[data-install-now]")){e.preventDefault();promptInstall();return;}
    const b=e.target.closest("#install, .install-btn");
    if(!b)return;
    e.preventDefault();
    promptInstall();
  });

  let autoDone=false;
  function maybeAutoPopup(){return; /* Installation prompts are disabled. */
    if(autoDone||isInstalled())return;
    if(document.body?.dataset.installPopup!=="on")return;
    let dismissed=0; try{dismissed=Number(localStorage.getItem("gbInstallDismissed")||0)}catch{}
    if(dismissed && Date.now()-dismissed < 7*24*60*60*1000) return;
    autoDone=true;
    const splash=document.getElementById("splash");
    setTimeout(openModal,splash?8200:900);
  }

  const VERSION_KEY="gbAppVersion";
  const BASE_VERSION="12.21.0";
  const read=k=>{try{return localStorage.getItem(k)||""}catch{return ""}};
  if("serviceWorker" in navigator){
    addEventListener("load",()=>{
      const v=read(VERSION_KEY)||BASE_VERSION;
      navigator.serviceWorker.register("/sw.js?v="+encodeURIComponent(v),{updateViaCache:"none"}).catch(()=>{});
    },{once:true});
  }

  function init(){reveal();maybeAutoPopup()}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
  else init();
  window.GBInstall={open:openModal,prompt:promptInstall};
})();

/* ------------------------------------------------------------------
   App update support.
------------------------------------------------------------------- */
(function(){
  const VERSION_KEY="gbAppVersion";
  const BASE_VERSION="12.21.0";
  const read=k=>{try{return localStorage.getItem(k)||""}catch{return ""}};
  const write=(k,v)=>{try{localStorage.setItem(k,v)}catch{}};
  const safeVersion=v=>String(v||"").replace(/[^A-Za-z0-9._-]/g,"_");
  let updating=false;

  const versionNumber=v=>{const m=String(v||"").match(/^(\d+)\.(\d+)\.(\d+)/);return m?Number(m[1])*1000000+Number(m[2])*1000+Number(m[3]):0};
  async function serverManifest(){
    try{
      const r=await fetch("/api/app/runtime/manifest",{cache:"no-store"});
      if(!r.ok)return null;
      const d=await r.json();
      // An older published runtime may still exist in Blob storage after a ZIP
      // deployment. It must never roll the newly released static assets back.
      if(!d?.version||versionNumber(d.version)<versionNumber(BASE_VERSION))return null;
      return Array.isArray(d.files)&&d.files.length?d:null;
    }catch{return null}
  }

  async function activateVersion(version){
    if(!version||!navigator.serviceWorker)return false;
    const v=safeVersion(version);
    write(VERSION_KEY,v);
    try{
      const reg=await navigator.serviceWorker.register("/sw.js?v="+encodeURIComponent(v),{updateViaCache:"none"});
      await reg.update().catch(()=>{});
      if(reg.waiting){reg.waiting.postMessage({type:"SKIP_WAITING"});}
      else if(reg.installing){
        const worker=reg.installing;
        await new Promise(resolve=>{
          const timer=setTimeout(resolve,15000);
          worker.addEventListener("statechange",()=>{if(["installed","activated","redundant"].includes(worker.state)){clearTimeout(timer);resolve()}},{once:false});
        });
        if(reg.waiting)reg.waiting.postMessage({type:"SKIP_WAITING"});
      }
      return true;
    }catch{return false}
  }

  async function applyUpdate(manifest){
    if(updating||!manifest?.version)return;
    const current=read(VERSION_KEY);
    if(current===String(manifest.version))return;
    updating=true;
    document.documentElement.dataset.appUpdating="1";
    const msg=document.createElement("div");
    msg.id="gbSilentUpdate";
    msg.style="position:fixed;inset:auto 12px 12px 12px;z-index:99999;background:#082d63;color:#fff;padding:12px 16px;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.2);font-weight:800;text-align:center";
    msg.textContent="Applying the latest Gifted Brainz Tutorial update…";
    document.body?.appendChild(msg);
    try{
      // The new service worker fetches this same manifest and downloads every
      // released public asset into its versioned cache before it becomes active.
      // No user confirmation is required, and all account data stays in Blobs.
      const swReady=navigator.serviceWorker && await activateVersion(manifest.version);
      if(swReady){
        write("gbPendingUpdate",String(manifest.version));
        let reloaded=false;
        const onController=()=>{if(reloaded)return;reloaded=true;write(VERSION_KEY,String(manifest.version));write("gbPendingUpdate","");location.reload()};
        navigator.serviceWorker.addEventListener("controllerchange",onController,{once:true});
        setTimeout(()=>{if(!reloaded){reloaded=true;write(VERSION_KEY,String(manifest.version));write("gbPendingUpdate","");location.reload()}},15000);
      }else{
        // Even without a service worker, HTML/API runtime updates are already
        // server-side. Revalidate the document so a normal browser picks up a
        // fresh static deployment immediately.
        write(VERSION_KEY,String(manifest.version));
        setTimeout(()=>location.reload(),250);
      }
    }catch{
      updating=false; document.documentElement.dataset.appUpdating=""; msg.remove();
    }
  }

  async function registerCurrent(){
    const m=await serverManifest();
    const previous=read(VERSION_KEY);
    const v=String(m?.version||previous||BASE_VERSION);
    const forced=sessionStorage.getItem("gbForceUpdateCheck")==="1";
    // A device with no stored version must still install the live runtime
    // package. The old build treated a first visit as "already up to date",
    // which is exactly why a published update could exist on the server while
    // the phone kept serving the older static files.
    if(m && (!previous || previous!==String(m.version) || forced)){
      sessionStorage.removeItem("gbForceUpdateCheck");
      write(VERSION_KEY,previous||BASE_VERSION);
      await applyUpdate(m);
      return;
    }
    write(VERSION_KEY,v);
    if("serviceWorker" in navigator){
      try{await navigator.serviceWorker.register("/sw.js?v="+encodeURIComponent(safeVersion(v)),{updateViaCache:"none"})}catch{}
    }
  }

  let lastVersionCheck=0;
  async function check(){
    // No duplicate manifest read immediately after page startup, and no
    // server requests from hidden tabs. Visibility resume still checks for updates.
    if(document.hidden||Date.now()-lastVersionCheck<45000)return;
    lastVersionCheck=Date.now();
    const m=await serverManifest();
    if(m && read(VERSION_KEY)!==String(m.version)) await applyUpdate(m);
  }

  function init(){
    if(!read(VERSION_KEY))write(VERSION_KEY,BASE_VERSION);
    setTimeout(()=>{lastVersionCheck=Date.now();registerCurrent().catch(()=>{})},500);
    setInterval(()=>check().catch(()=>{}),60000);
    document.addEventListener("visibilitychange",()=>{if(!document.hidden)check().catch(()=>{})});
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();;


/* Branded login-success loader. It is deliberately limited to login screens and
   is never triggered by normal navigation, in-page actions, or background loads. */
(function installLoginSuccessLoader(){
  if(window.__gbLoginSuccessLoaderInstalled)return;window.__gbLoginSuccessLoaderInstalled=true;
  const path=String(location.pathname||"").replace(/\/+$/,"").toLowerCase();
  if(path!=="/login.html" && path!=="/admin.html" && path!=="/register.html")return;
  const isAdmin=path==="/admin.html";
  const loaderTitle=isAdmin?"Loading Admin Console":path==="/register.html"?"Preparing your EduSpace":"Loading your EduSpace";
  const loaderSubtitle=isAdmin?"Preparing your admin console…":path==="/register.html"?"Setting up your learning dashboard…":"Opening your learning dashboard…";
  const loader=document.createElement("div");
  loader.className="gb-page-loader";loader.setAttribute("role","status");loader.setAttribute("aria-live","polite");loader.setAttribute("aria-label",loaderTitle);
  loader.innerHTML='<div class="gb-loader-card"><div class="gb-loader-spinner" aria-hidden="true"><span class="gb-loader-ring"></span><img class="gb-loader-mark" src="/assets/icon-light.png" alt=""></div><p class="gb-loader-title">'+loaderTitle+'<span class="gb-loader-dots"></span></p><p class="gb-loader-subtitle">'+loaderSubtitle+'</p><div class="gb-loader-track" aria-hidden="true"><span></span></div></div>';
  document.body.appendChild(loader);
  const show=()=>{loader.classList.add("show");loader.setAttribute("aria-hidden","false");return Date.now();};
  const hide=()=>{loader.classList.remove("show");loader.setAttribute("aria-hidden","true");};
  const hold=async(startedAt,minMs=350)=>{const elapsed=Date.now()-(Number(startedAt)||Date.now());await new Promise(resolve=>setTimeout(resolve,Math.max(0,minMs-elapsed)));};
  const showAndHold=async(minMs=350)=>{const startedAt=show();await hold(startedAt,minMs);return startedAt;};
  window.GBLoginLoader={show,hide,hold,showAndHold};
})();
