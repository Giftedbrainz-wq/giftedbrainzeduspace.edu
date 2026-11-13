const REQUESTED_VERSION=new URL(self.location.href).searchParams.get("v")||"12.21.0";
const MIN_RUNTIME_VERSION="12.21.0";
const versionRank=v=>{
  const m=String(v||"").match(/^(\d+)\.(\d+)\.(\d+)/);
  return m?Number(m[1])*1e6+Number(m[2])*1e3+Number(m[3]):0;
};
// Never let an old cached app.js pin the service worker to an old cache.
// Future releases with a higher semantic version still pass through normally.
const VERSION=versionRank(REQUESTED_VERSION)<versionRank(MIN_RUNTIME_VERSION)?MIN_RUNTIME_VERSION:REQUESTED_VERSION;
const CACHE="gb-"+VERSION.replace(/[^A-Za-z0-9._-]/g,"_");
const SHELL=[
  "/","/index.html","/login.html","/register.html","/dashboard.html","/cbt.html","/videos.html","/battle.html","/battle-admin.html",
  "/materials.html","/explore-students.html","/explore-teams.html","/explore-students.js","/explore-teams.js","/discovery.css","/learning-spaces.js","/learning-spaces.css","/premium-access.js","/premium-access.css","/progress.html","/update.html","/announcements.html","/help.html","/account.html","/feedback.html","/diagnostics.html",
  "/admin.html","/admin-preview.html","/v1218-corrections.css","/compact-image.js","/typography.css","/mobile-polish.css","/study-messaging.css","/study-messaging-common.js","/study-chat.html","/study-chat.js","/study-realtime.js","/study-communities.html","/study-communities.js","/channel-prompt.js","/auth-forms.js","/styles.css","/cbt-cards.css","/battle.css","/battle.js","/battle-admin.js","/app.js","/api.js","/gb-ui.js","/jamb-countdown.js","/learning-centre.js","/study-partners.js","/learning.css","/intro.js","/intro.css","/manifest.webmanifest",
  "/brand-gold-v1221.css","/assets/icon-192.png","/assets/icon-light.png","/assets/logo-full.png","/assets/icon-512.png"
];
async function installRuntime(cache){
  try{
    const r=await fetch("/api/app/runtime/manifest",{cache:"no-store"});
    if(!r.ok)return false;
    const manifest=await r.json();
    if(String(manifest.version)!==String(VERSION)||!Array.isArray(manifest.files))return false;
    // Folder entries ("assets/") are not files; skip them instead of firing
    // a request that can only 404.
    // A bounded parallel queue is materially faster than one request per file
    // in series. Six concurrent downloads avoid overwhelming the Blob backend.
    const files=manifest.files.filter(x=>x&&typeof x.path==="string"&&x.path&&!x.path.endsWith("/"));
    let next=0;
    await Promise.all(Array.from({length:Math.min(6,files.length)},async()=>{
      while(next<files.length){
        const f=files[next++];
        try{
          const u="/api/app/runtime/file/"+f.path.split("/").map(encodeURIComponent).join("/");
          const response=await fetch(u,{cache:"no-store",credentials:"same-origin"});
          if(response.ok&&!/text\/html/i.test(response.headers.get('content-type')||''))await cache.put(new Request('/'+f.path),response);
        }catch{}
      }
    }));
    await cache.put(new Request("/__gb_active_runtime__"),new Response(String(manifest.version),{headers:{"content-type":"text/plain"}}));
    return true;
  }catch{return false}
}
// cache.addAll() rejects the whole install if a single file 404s, which used
// to leave the app with no service worker at all. Each file is now cached
// independently so one missing asset cannot break installation.
async function cacheShell(cache){
  // Fetch a few shell assets concurrently rather than overwhelming mobile links
  // with 40+ parallel requests, while keeping install resilient to missing files.
  let next=0;
  const concurrency=Math.min(8,SHELL.length);
  await Promise.all(Array.from({length:concurrency},async()=>{
    while(next<SHELL.length){
      const url=SHELL[next++];
      try{
        const response=await fetch(url,{cache:"no-store",credentials:"same-origin"});
        const contentType=(response.headers.get('content-type')||'').toLowerCase();
        const isStatic=/\.(?:png|jpe?g|gif|webp|svg|ico|js|css|woff2?|ttf|wasm|webmanifest)(?:\?.*)?$/i.test(url);
        if(response.ok&&(!isStatic||!contentType.includes('text/html')))await cache.put(new Request(url),response);
      }catch{}
    }
  }));
}

self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(async cache=>{await cacheShell(cache);await installRuntime(cache);await self.skipWaiting();})));
self.addEventListener("activate",e=>e.waitUntil((async()=>{
  // Remove older Gifted Brainz caches after the new worker is active.
  const keys=await caches.keys();
  await Promise.all(keys.filter(k=>k.startsWith("gb-")&&k!==CACHE).map(k=>caches.delete(k)));
  await self.clients.claim();
})()));
self.addEventListener("message",e=>{
  if(e.data?.type==="SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("push",e=>{
  let data={};
  try{data=e.data?.json()||{}}catch{try{data={body:e.data?.text()||""}}catch{}}
  e.waitUntil(self.registration.showNotification(data.title||"Gifted Brainz Tutorial",{body:data.body||"",icon:"/assets/icon-192.png",badge:"/assets/icon-192.png",data:{url:data.url||"/dashboard.html"},tag:data.type||"gb-notification"}));
});

self.addEventListener("notificationclick",e=>{
  e.notification.close();
  const target=e.notification.data?.url||"/login.html";
  e.waitUntil((async()=>{
    const clients=await self.clients.matchAll({type:"window",includeUncontrolled:true});
    for(const c of clients){try{await c.focus();await c.navigate(target);return}catch{}}
    await self.clients.openWindow(target);
  })());
});
// Cache-first for versioned static application files; network-first for HTML.
// Never intercept cross-origin video thumbnails, YouTube resources, or CDNs.
// Never cache /api responses or private learning/account data in the SW.
self.addEventListener("fetch",e=>{
  const u=new URL(e.request.url);
  if(u.origin!==self.location.origin||e.request.method!=="GET"||u.pathname.startsWith("/api/" )||u.pathname==="/api")return;
  e.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const isStatic=/\.(?:js|css|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|wasm|webmanifest)$/i.test(u.pathname)||u.pathname.startsWith('/assets/');
    const isGraphic=u.pathname.startsWith('/assets/')||e.request.destination==='image';
    const usable=r=>!!r&&r.ok&&(!isStatic||!/text\/html|text\/plain/i.test(r.headers.get('content-type')||''));
    const fail=()=>new Response('Static resource unavailable',{status:404,headers:{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'}});
    // Query versions (?v=...) and shell paths are the same versioned asset
    // within this service worker's cache. On upgrade, CACHE changes entirely.
    const cacheKey=isStatic?new Request(u.origin+u.pathname):e.request;
    const cached=await cache.match(cacheKey,{ignoreSearch:isStatic});
    const runtimeActive=!!await cache.match('/__gb_active_runtime__');
    if(isStatic&&usable(cached)){
      if(!runtimeActive){
        // Refresh static copies in the background, not on the critical path.
        e.waitUntil(fetch(e.request,{cache:'no-cache'}).then(r=>{
          if(usable(r))return cache.put(cacheKey,r.clone());
        }).catch(()=>{}));
      }
      return cached;
    }
    if(runtimeActive&&usable(cached))return cached;
    try{
      const response=await fetch(e.request,{cache:isStatic?'default':'no-cache'});
      if(isStatic&&!usable(response))return usable(cached)?cached:fail();
      if(response.ok){
        // Static responses are safe to cache. HTML remains network-first to
        // honour deploys, with a cached offline fallback.
        e.waitUntil(cache.put(cacheKey,response.clone()).catch(()=>{}));
      }
      return response;
    }catch{
      if(usable(cached))return cached;
      if(isStatic)return fail();
      if(e.request.mode==='navigate'||e.request.destination==='document')return(await cache.match('/index.html'))||new Response('Offline',{status:503});
      return new Response('Offline',{status:503,headers:{'content-type':'text/plain'}});
    }
  })());
});
