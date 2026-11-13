/* ------------------------------------------------------------------
   Gifted Brainz Tutorial — shared portal shell.

   Every student page includes this file. It renders the left-hand menu
   (each entry is an icon *plus its name*), the top bar, the mobile menu
   button, and the helpers used to display rich announcements, media and
   "Show more / Show less" lists.
------------------------------------------------------------------- */
window.GBUI = (() => {

  const NAV_GROUPS = [
    { title: "Home", items: [
      { href: "/dashboard.html", icon: "🏠", label: "Dashboard", desc: "Your overview at a glance" }
    ]},
    { title: "CBT Tests", items: [
      { href: "/cbt.html", icon: "📝", label: "CBT Tests", desc: "Subject-by-subject test write-ups and links" },
      { href: "/videos.html", icon: "🎬", label: "Video Lessons", desc: "Subject-by-subject YouTube video lessons" },
      { href: "/battle.html", icon: "⚔️", label: "Brainz Battle Arena", desc: "Create or join team quiz battles" }
    ]},
    { title: "Learn", items: [
      { href: "/materials.html", icon: "📚", label: "Learning Materials", desc: "Notes and files by subject" },
      { href: "/announcements.html", icon: "📢", label: "Announcements", desc: "News from Gifted Brainz" }
    ]},
    { title: "Progress", items: [
      { href: "/progress.html", icon: "✅", label: "Progress Tracking", desc: "Tick topics and track coverage" },
      { href: "/learning-centre.html", icon: "🧠", label: "My Learning Centre", desc: "Mistakes, planner, saved questions and badges" },
      { href: "/study-partners.html", icon: "🤝", label: "Study Partners", desc: "Private academic collaboration" }
    ]},
    { title: "Support & Account", items: [
      { href: "/feedback.html", icon: "⭐", label: "Feedback & Rating", desc: "Rate the app and send complaints" },
      { href: "/help.html", icon: "🆘", label: "Help & Support", desc: "Talk to us on WhatsApp" },
      { href: "/account.html", icon: "👤", label: "My Account", desc: "Your profile and sign out" }
    ]}
  ];
  const NAV = NAV_GROUPS.flatMap(group => group.items);

  const SUBJECTS = ["Mathematics", "Use of English", "Physics", "Chemistry", "Biology"];
  const SUBJECT_ICONS = {
    "Mathematics": "➗", "Use of English": "📘", "Physics": "⚡",
    "Chemistry": "🧪", "Biology": "🌿"
  };
  // Shared subject emojis are administered globally and cached for quick first paint.
  try{Object.assign(SUBJECT_ICONS,JSON.parse(sessionStorage.getItem("gbSubjectIcons")||"{}"));}catch{}
  const refreshSubjectIcons=()=>window.GB?.api?.("/api/subjects/icons").then(rows=>{
    if(!Array.isArray(rows))return;
    for(const row of rows)if(row?.name&&row?.emoji)SUBJECT_ICONS[row.name]=row.emoji;
    try{sessionStorage.setItem("gbSubjectIcons",JSON.stringify(SUBJECT_ICONS));}catch{}
    window.dispatchEvent(new CustomEvent("gb-subject-icons"));
  }).catch(()=>{});
  if(window.GB?.api) Promise.resolve().then(refreshSubjectIcons);
  const EMOJI = { home:"🏠", materials:"📚", check:"✅", warning:"⚠️" };
  function mySubjects(){
    try {
      const u = JSON.parse(localStorage.getItem("gbUser") || sessionStorage.getItem("gbUser") || "{}");
      const selected = Array.isArray(u.selectedSubjects) ? u.selectedSubjects.filter(s => typeof s==="string" && s.trim() && s.length<=80) : [];
      return selected.length ? [...new Set(selected)] : ["Use of English"];
    } catch { return ["Use of English"]; }
  }

  const esc = v => String(v ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ----------------------------- the shell ----------------------------- */
  function shell(opts = {}) {
    const active = opts.active || location.pathname;
    const links = NAV_GROUPS.map(group => `
      <div class="nav-group">
        <div class="nav-group-title">${esc(group.title)}</div>
        ${group.items.map(item => {
          const on = item.href === active;
          return `<a class="${on ? "active" : ""}" href="${item.href}" aria-label="${esc(item.label)} — ${esc(item.desc)}" ${on ? 'aria-current="page"' : ""}>
            <span class="ic" aria-hidden="true">${item.icon}</span>
            <span class="nav-text"><span class="lbl">${esc(item.label)}</span><small>${esc(item.desc)}</small></span>
          </a>`;
        }).join("")}
      </div>`).join("");


    return `
    <button class="menu-toggle" id="menuToggle" type="button" aria-label="Open navigation menu" aria-controls="sidebar" aria-expanded="false">☰ Menu</button>
    <div class="scrim" id="scrim" hidden></div>
    <aside class="sidebar" id="sidebar">
      <a class="side-brand" href="/dashboard.html">
        <img class="logo-transparent" src="/assets/icon-light.png" alt="Gifted Brainz Tutorial">
        <span>Gifted Brainz<br><small>Tutorial</small></span>
      </a>
      <nav class="sidenav" aria-label="Main menu">${links}</nav>
      <div class="side-foot">Gifted Brainz Tutorial<br>No cramming, just understanding.</div>
    </aside>`;
  }

  function mount(opts = {}) {
    const host = document.getElementById("shell");
    if (!host) return;
    host.classList.add("shell");
    const main = host.querySelector(".main");
    host.insertAdjacentHTML("afterbegin", shell(opts));
    if (main) host.appendChild(main);
    const content = host.querySelector(".content");
    // Channel promotions are intentionally limited to the public homepage and student login page.
    // GBUI.mount is used only by authenticated/internal portal pages, so do not inject the banner here.

    const sidebar = document.getElementById("sidebar");
    const scrim = document.getElementById("scrim");
    const toggle = document.getElementById("menuToggle");
    const close = () => { sidebar.classList.remove("open"); scrim.hidden = true; };
    toggle?.addEventListener("click", () => {
      const open = !sidebar.classList.contains("open");
      sidebar.classList.toggle("open", open);
      scrim.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      if (open) sidebar.querySelector("a")?.focus();
    });
    scrim?.addEventListener("click", close);
    sidebar?.addEventListener("click", e => { if (e.target.closest("a")) close(); });
    addEventListener("keydown", e => { if (e.key === "Escape") close(); });

    const who = document.getElementById("who");
    if (who) {
      try {
        const u = JSON.parse(localStorage.getItem("gbUser") || sessionStorage.getItem("gbUser") || "{}");
        if (u && u.name) who.textContent = u.name;
      } catch {}
    }
    // The chosen avatar is shared across My Account, the topbar and Study Partners.
    const right=document.querySelector('.topbar-right');
    if(right && !right.querySelector('.gb-header-avatar')){
      const picture=document.createElement('a');picture.className='gb-header-avatar';picture.href='/account.html';picture.title='My account';
      picture.setAttribute('aria-label','Open my account');right.prepend(picture);
      const refreshAvatar=()=>{let user={};try{user=JSON.parse(localStorage.getItem('gbUser')||sessionStorage.getItem('gbUser')||'{}')}catch{};
        const avatar=/^scholar-(0[1-9]|1\d|2[0-4])$/.test(user.avatar||'')?user.avatar:'scholar-01';
        picture.innerHTML=`<img src="${/^custom-[a-f0-9-]{36}$/.test(user.avatar||'')?'/api/profile-photo/'+user.avatar.slice(7):'/assets/avatars/'+avatar+'.png'}" alt="Your profile picture" width="38" height="38">`;
      };
      refreshAvatar();window.addEventListener('storage',refreshAvatar);window.addEventListener('gb-profile-updated',refreshAvatar);
    }
    setTimeout(()=>{notificationCenter();syncGrantedDeviceNotifications();},0);
  }

  /* --------------------------- notifications --------------------------- */
  function pushBytes(value){
    const s=String(value||"").replace(/-/g,"+").replace(/_/g,"/");
    const pad=s.length%4?"=".repeat(4-s.length%4):"";
    const raw=atob(s+pad); return Uint8Array.from(raw,c=>c.charCodeAt(0));
  }
  async function enableDeviceNotifications(){
    if(!("Notification" in window)||!("serviceWorker" in navigator)||!("PushManager" in window)) throw new Error("This browser does not support device notifications.");
    const permission=Notification.permission==="granted"?"granted":await Notification.requestPermission();
    if(permission!=="granted") throw new Error("Device notifications are blocked. Allow notifications for this site in your browser settings, then try again.");
    const reg=await navigator.serviceWorker.ready;
    const key=await GB.api("/api/push/public-key");
    let sub=await reg.pushManager.getSubscription();
    if(!sub) sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:pushBytes(key.publicKey)});
    const json=sub.toJSON();
    await GB.api("/api/push/subscribe",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(json)});
    return true;
  }
  async function syncGrantedDeviceNotifications(){
    try{
      if(!window.GB?.token?.() || !("Notification" in window) || Notification.permission!=="granted") return false;
      await enableDeviceNotifications();
      return true;
    }catch{return false}
  }
  function notificationCenter(){
    if(document.getElementById("gbNoticeButton")) return;
    const top=document.querySelector(".topbar-right");
    if(!top || !window.GB?.token?.()) return;
    const wrap=document.createElement("div");
    wrap.style="position:relative;display:inline-flex";
    wrap.innerHTML=`<button class="btn light" id="gbNoticeButton" type="button" aria-label="Notifications" style="position:relative">🔔<span id="gbNoticeBadge" style="display:none;position:absolute;top:-5px;right:-5px;min-width:18px;height:18px;padding:0 4px;border-radius:20px;background:#b91c1c;color:#fff;font-size:.68rem;line-height:18px;font-weight:900"></span></button><div id="gbNoticePanel" hidden style="position:absolute;right:0;top:46px;width:min(360px,calc(100vw - 28px));max-height:420px;overflow:auto;background:#fff;border:1px solid rgba(8,45,99,.15);border-radius:16px;box-shadow:0 18px 45px rgba(0,0,0,.18);z-index:5000;padding:10px"></div>`;
    top.prepend(wrap);
    const button=wrap.querySelector("#gbNoticeButton"), panel=wrap.querySelector("#gbNoticePanel"), badge=wrap.querySelector("#gbNoticeBadge");
    let lastIds=new Set(); let first=true;
    function esc2(v){return esc(v)}
    function render(items){
      if(!items.length){panel.innerHTML='<div class="muted" style="padding:16px;text-align:center">No notifications yet.</div>';return}
      panel.innerHTML=`<div style="padding:4px 4px 8px;display:flex;justify-content:space-between;align-items:center"><b>Notifications</b><button type="button" class="btn light gb-notice-close" aria-label="Close notifications">✕</button>${("Notification" in window && Notification.permission!=="granted")?'<button type="button" id="gbEnableNotifications" class="btn light" style="font-size:.78rem">Enable device alerts</button>':''}</div>`+items.map(n=>`<button type="button" data-notice-id="${esc2(n.id)}" data-notice-url="${esc2(n.url||"/dashboard.html")}" style="display:block;width:100%;text-align:left;border:0;background:${n.read?'#fff':'#f2f7ff'};padding:12px;border-radius:12px;margin:0 0 6px;cursor:pointer"><b>${esc2(n.title||"Notification")}</b><span style="display:block;color:#425466;font-size:.86rem;margin-top:4px">${esc2(n.message||"")}</span><small style="display:block;color:#7b8794;margin-top:6px">${n.createdAt?new Date(n.createdAt).toLocaleString():""}</small></button>`).join("");
      panel.querySelector('.gb-notice-close')?.addEventListener('click',()=>{panel.hidden=true;});
      panel.querySelector("#gbEnableNotifications")?.addEventListener("click",async e=>{e.stopPropagation();const b=e.currentTarget;b.disabled=true;b.textContent="Enabling…";try{await enableDeviceNotifications();b.textContent="Device alerts enabled ✓";await load()}catch(err){b.disabled=false;b.textContent="Enable device alerts";panel.insertAdjacentHTML("afterbegin",`<div class="error" style="padding:8px">${esc2(err.message)}</div>`)}});
    }
    async function load(){
      try{
        const x=await GB.api("/api/notifications"); const items=x.items||[];
        const unread=Number(x.unread)||0; badge.style.display=unread?"inline-block":"none"; if(unread)badge.textContent=unread>99?"99+":String(unread);
        for(const n of items){
          if(!first && !lastIds.has(String(n.id)) && n.type==="update" && "serviceWorker" in navigator){
            try{const reg=await navigator.serviceWorker.ready; await reg.showNotification(n.title||"Gifted Brainz update",{body:n.message||"A new update is available.",icon:"/assets/icon-192.png",badge:"/assets/icon-192.png",data:{url:n.url||"/login.html"}})}catch{}
          }
        }
        lastIds=new Set(items.map(n=>String(n.id))); first=false; render(items);
        return {items,unread};
      }catch{return null;}
    }
    button.addEventListener("click",async e=>{e.stopPropagation();panel.hidden=!panel.hidden;if(!panel.hidden){
      const result=await load();if(result?.unread){
        try{await GB.api("/api/notifications/read",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({})});
          badge.style.display="none";render(result.items.map(item=>({...item,read:true})));
        }catch{}
      }
    }});
    panel.addEventListener("click",async e=>{const item=e.target.closest("[data-notice-id]");if(!item)return;const id=item.dataset.noticeId,url=item.dataset.noticeUrl||"/dashboard.html";await GB.api("/api/notifications/read",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids:[id]})}).catch(()=>{});if(url.startsWith("/login.html?update=")) sessionStorage.setItem("gbForceUpdateCheck","1");location.href=url});
    load();setInterval(()=>{if(!document.hidden)load()},45000);
  }

  /* ------------------- safe rendering of rich content ------------------- */
  // The server already strips anything unsafe. This is the second line of
  // defence: the markup is rebuilt from an allow-list inside the browser too.
  const ALLOWED = new Set(["B", "STRONG", "I", "EM", "U", "S", "STRIKE", "BR", "P", "DIV",
    "SPAN", "UL", "OL", "LI", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "SUP", "SUB", "CODE", "PRE", "A"]);

  function safeHtml(html) {
    const src = document.createElement("div");
    src.innerHTML = String(html ?? "");
    const out = document.createElement("div");
    walk(src, out);
    return out.innerHTML;
  }

  function walk(from, to) {
    from.childNodes.forEach(node => {
      if (node.nodeType === 3) { to.appendChild(document.createTextNode(node.nodeValue)); return; }
      if (node.nodeType !== 1) return;
      if (!ALLOWED.has(node.tagName)) { walk(node, to); return; }
      const el = document.createElement(node.tagName.toLowerCase());
      if (node.tagName === "A") {
        const href = String(node.getAttribute("href") || "");
        if (!/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(href)) { walk(node, to); return; }
        el.setAttribute("href", href);
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer nofollow");
      }
      walk(node, el);
      to.appendChild(el);
    });
  }

  // Older material was stored as plain text: keep the line breaks and make
  // any link inside it clickable, so nothing published before an update is lost.
  // The text arriving here has already been through mathHtml() per-segment
  // (escaped, with any formulas rendered and spliced back in), so this only
  // handles linkification and newline-to-<br> - it must not escape again.
  function textToHtml(text) {
    const linked = String(text).replace(/((?:(?:https?:\/\/|www\.)[^\s<]+|[a-z0-9.-]+\.(?:com|org|net|ng|edu|gov|co|uk)(?:\/[^\s<]*)?))/gi, url => {
      const clean = url.replace(/[).,;:!?]+$/, "");
      const tail = url.slice(clean.length);
      const href = /^(?:https?:\/\/)/i.test(clean) ? clean : "https://" + clean;
      return `<a href="${href}" target="_blank" rel="noopener noreferrer nofollow">${clean}</a>${tail}`;
    });
    return linked.replace(/\n/g, "<br>");
  }

  function decodeDisplayEntities(value) {
    let out = String(value ?? "");
    for (let pass = 0; pass < 4; pass++) {
      const next = out
        .replace(/&nbsp;|&#160;|&#xA0;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&#(\d+);/g, (_, n) => { const cp=Number(n); return Number.isInteger(cp) ? String.fromCodePoint(cp) : _; })
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => { const cp=parseInt(n,16); return Number.isInteger(cp) ? String.fromCodePoint(cp) : _; });
      if (next === out) break;
      out = next;
    }
    return out;
  }

  /* ------------------------- math and LaTeX display ---------------------- */
  // Rendered with KaTeX (loaded via a <link>/<script> tag in each page's
  // <head>) instead of a hand-rolled bare-macro detector + lazily-loaded
  // MathJax. Explicit $ $, $$ $$, \( \) and \[ \] delimiters are honoured,
  // and so are common shorthands authors type without delimiters - x^2,
  // H_2O, frac(a)(b), sqrt(x), matrix[1,2;3,4], bare \frac{..}{..}/\sqrt{..}
  // commands, and bare equations containing =, <, >, ^, _ or a Greek letter.
  // KaTeX renders synchronously to a string, so the result already has the
  // typeset formula baked in - no follow-up DOM pass is needed. A small HTML
  // fallback renderer covers the rare case where KaTeX fails to load.
  function mathHtml(value) {
    let source = String(value ?? "");
    if (!source.trim()) return "";
    const fallbackMath = (tex, display = false) => {
      let x = esc(String(tex ?? "").trim());
      const symbolMap = { "\\times":"×","\\div":"÷","\\pm":"±","\\leq":"≤","\\geq":"≥","\\neq":"≠","\\approx":"≈","\\cdot":"·","\\infty":"∞","\\pi":"π","\\theta":"θ","\\alpha":"α","\\beta":"β","\\gamma":"γ","\\delta":"δ","\\lambda":"λ","\\mu":"μ","\\sigma":"σ","\\phi":"φ","\\omega":"ω" };
      Object.entries(symbolMap).forEach(([k, v]) => { x = x.replaceAll(k, v); });
      x = x.replace(/\\(?:left|right)\b/g, "");
      x = x.replace(/\\begin\{(?:pmatrix|bmatrix|matrix)\}([\s\S]*?)\\end\{(?:pmatrix|bmatrix|matrix)\}/g, (_, body) =>
        `<span class="gb-matrix">${body.split(/\\\\/).map(r => `<span class="gb-matrix-row">${r.split(/&(?:amp;)?/).map(c => `<span>${c}</span>`).join("")}</span>`).join("")}</span>`);
      x = x.replace(/\\sqrt\s*\{([^{}]*)\}/g, '<span class="gb-sqrt">√<span>$1</span></span>');
      let prev = "";
      for (let n = 0; n < 8 && x !== prev; n++) { prev = x; x = x.replace(/\\(?:d?frac|tfrac)\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '<span class="gb-frac"><span>$1</span><span>$2</span></span>'); }
      x = x.replace(/\^\{([^{}]+)\}/g, "<sup>$1</sup>").replace(/\^([A-Za-z0-9]+)/g, "<sup>$1</sup>").replace(/_\{([^{}]+)\}/g, "<sub>$1</sub>").replace(/_([A-Za-z0-9]+)/g, "<sub>$1</sub>");
      return `<span class="gb-math-fallback${display ? " gb-math-display" : ""}">${x}</span>`;
    };
    const renderOne = (tex, display = false) => {
      const clean = String(tex ?? "").trim();
      if (!clean) return "";
      if (window.katex?.renderToString) {
        try { return window.katex.renderToString(clean, { throwOnError: false, strict: false, displayMode: display, trust: false }); }
        catch (error) { return fallbackMath(clean); }
      }
      return fallbackMath(clean);
    };
    const tokens = [];
    const protect = (tex, display = false) => { const key = `\uE000${tokens.length}\uE001`; tokens.push(renderOne(tex, display)); return key; };
    const braceEnd = (text, start) => {
      if (text[start] !== "{") return -1;
      let depth = 0;
      for (let i = start; i < text.length; i++) { if (text[i] === "{") depth++; else if (text[i] === "}" && --depth === 0) return i; }
      return -1;
    };
    const consumeCommand = (text, start) => {
      const m = text.slice(start).match(/^\\(?:d?frac|tfrac|sqrt|binom|text|mathrm|mathbf|mathit|operatorname|overline|underline|left|right)\b/);
      if (!m) return -1;
      let end = start + m[0].length;
      while (/\s/.test(text[end] || "")) end++;
      if (text[end] === "[") { const close = text.indexOf("]", end + 1); if (close < 0) return -1; end = close + 1; while (/\s/.test(text[end] || "")) end++; }
      const first = braceEnd(text, end); if (first < 0) return -1; end = first + 1;
      if (/^\\(?:d?frac|tfrac|binom)\b/.test(m[0])) { while (/\s/.test(text[end] || "")) end++; const second = braceEnd(text, end); if (second < 0) return -1; end = second + 1; }
      return end;
    };
    // Convert common shorthand used by administrators and imported content.
    source = source
      .replace(/\bfrac\s*\(\s*([^()\n]+?)\s*\)\s*\(\s*([^()\n]+?)\s*\)/gi, "\\frac{$1}{$2}")
      .replace(/\bsqrt\s*\(\s*([^()\n]+?)\s*\)/gi, "\\sqrt{$1}")
      .replace(/\bmatrix\s*\[([^\]\n]+)\]/gi, (_, body) => `\\begin{pmatrix}${body.split(";").map(row => row.split(",").join("&")).join("\\\\")}\\end{pmatrix}`);
    // Explicit delimiters always win.
    source = source.replace(/\\\[([\s\S]*?)\\\]/g, (_, x) => protect(x, true));
    source = source.replace(/\\\(([\s\S]*?)\\\)/g, (_, x) => protect(x, false));
    source = source.replace(/\$\$([\s\S]*?)\$\$/g, (_, x) => protect(x, true));
    source = source.replace(/\$([^$\n]+)\$/g, (_, x) => protect(x, false));
    // Render balanced LaTeX commands even when the author forgot delimiters.
    let rebuilt = "", i = 0;
    while (i < source.length) {
      if (source[i] === "\\") {
        if (source.startsWith("\\begin{", i)) {
          const endTag = source.indexOf("}", i + 7);
          if (endTag > 0) { const env = source.slice(i + 7, endTag); const close = source.indexOf(`\\end{${env}}`, endTag + 1); if (close >= 0) { rebuilt += protect(source.slice(i, close + env.length + 6), false); i = close + env.length + 6; continue; } }
        }
        const e = consumeCommand(source, i);
        if (e > i) { rebuilt += protect(source.slice(i, e), false); i = e; continue; }
        // Standalone Greek/operators such as \theta, \leq, \pi are kept as a small math token.
        const cm = source.slice(i).match(/^\\(?:alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|phi|omega|infty|pm|times|div|leq|geq|neq|approx|cdot|degree|sin|cos|tan|log|ln|exp)\b/);
        if (cm) { rebuilt += protect(cm[0], false); i += cm[0].length; continue; }
      }
      rebuilt += source[i++];
    }
    source = rebuilt;
    // Bare equations and expressions containing powers/indices.
    const bareEquation = /(?<![A-Za-z0-9_])((?:[A-Za-z0-9]+(?:\^\{[^{}]+\}|\^[A-Za-z0-9]+|_\{[^{}]+\}|_[A-Za-z0-9]+)?|\\[A-Za-z]+|[+\-*/=<>≤≥]|\s){3,120})(?=$|[,.!?;:]?\s|\)|\])/g;
    source = source.replace(bareEquation, (whole) => {
      const t = whole.trim();
      const proseWords = t.replace(/\\[A-Za-z]+/g, "").match(/\b[A-Za-z]{3,}\b/g) || [];
      if (/=|<|>|\^|_|\\(?:alpha|beta|gamma|delta|theta|pi|sqrt|frac|sin|cos|tan|log|ln)\b/.test(t) && /[A-Za-z0-9]/.test(t) && proseWords.length === 0) return protect(t, false);
      return whole;
    });
    source = source.replace(/(?<![\w])((?:[A-Za-z]|\d+)(?:\^\{[^{}]+\}|\^[A-Za-z0-9]+|_\{[^{}]+\}|_[A-Za-z0-9]+))(?![\w])/g, x => protect(x, false));
    let html = esc(source);
    tokens.forEach((token, i) => { html = html.replace(`\uE000${i}\uE001`, token); });
    return html;
  }
  // Supplementary DOM-level pass (KaTeX's auto-render extension) for any
  // content that was inserted without going through mathHtml above.
  function renderMath(root = document) {
    const fn = window.renderMathInElement, katex = window.katex;
    if (!fn || !katex || !root) return;
    try {
      fn(root, { delimiters: [{ left: "\\[", right: "\\]", display: true }, { left: "\\(", right: "\\)", display: false }, { left: "$$", right: "$$", display: true }, { left: "$", right: "$", display: false }], throwOnError: false, strict: false });
    } catch (error) { /* content keeps its plain-text form if auto-render fails */ }
  }

  function renderBody(value, format) {
    const raw = decodeDisplayEntities(value);
    if (!raw.trim()) return "";
    // Embedded note media is stored as a safe data-gb-file key. Resolve the
    // authenticated file URL at render time so a note never stores an expiring
    // token inside its HTML. Any raw LaTeX command is placed in math delimiters
    // before sanitisation; this covers older imported questions as well.
    const mediaReady = raw.replace(/<(img|video|audio)\b([^>]*?)data-gb-file=["']([^"']+)["']([^>]*)>/gi, (all, tag, before, key, after) => {
      const src = GB.fileUrl(`/api/files/${encodeURIComponent(key)}`, { inline: true });
      return `<${tag}${before} src="${esc(src)}"${after}>`;
    }).split(/(<[^>]+>)/g).map(part=>part.startsWith("<")&&part.endsWith(">")?part:mathHtml(part)).join("");
    return format === "html" || /<(a|b|i|u|p|div|br|ul|ol|li|strong|em|img|video|audio)\b/i.test(mediaReady)
      ? safeHtml(mediaReady)
      : textToHtml(mediaReady);
  }

  /* ---------------------------- media & files --------------------------- */
  function kindOf(f) {
    if (f.kind) return f.kind;
    const t = String(f.contentType || "").toLowerCase(), n = String(f.fileName || "").toLowerCase();
    if (t.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(n)) return "image";
    if (t.startsWith("video/") || /\.(mp4|webm|ogv|mov|m4v)$/.test(n)) return "video";
    if (t.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac)$/.test(n)) return "audio";
    if (t === "application/pdf" || /\.pdf$/.test(n)) return "pdf";
    if (t.startsWith("text/") || /\.(txt|md|csv|json)$/.test(n)) return "text";
    return "file";
  }

  const ICON_FOR = { image: "🖼️", video: "🎬", audio: "🎧", pdf: "📄", text: "📃", file: "📎" };

  // Images always view inline. Documents (PDFs, notes/text files) view inline
  // only when they are reasonably small - a large file is better downloaded
  // than streamed into a cramped in-page frame. Everything else (Word, Excel,
  // PowerPoint, archives, etc.) is never natively renderable by the browser,
  // so it stays download-only regardless of size.
  const INLINE_VIEW_MAX_BYTES = 5 * 1024 * 1024;
  function canViewInline(f) {
    const kind = kindOf(f);
    if (kind === "image" || kind === "video" || kind === "audio") return true;
    if (kind === "pdf" || kind === "text") return !(Number(f.size) > INLINE_VIEW_MAX_BYTES);
    return false;
  }
  function media(list) {
    if (!Array.isArray(list) || !list.length) return "";
    return `<div class="media-grid">` + list.map(f => {
      const url = GB.fileUrl(f.url, { inline: true });
      const kind = kindOf(f);
      if (kind === "image") return `<figure class="media"><a href="${esc(url)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(url)}" alt="${esc(f.fileName || "Announcement picture")}"></a><figcaption>${esc(f.fileName || "")}</figcaption></figure>`;
      if (kind === "video") return `<figure class="media"><video controls playsinline preload="metadata" src="${esc(url)}" type="${esc(f.contentType||"video/mp4")}"></video><figcaption>${esc(f.fileName || "")}</figcaption><a class="muted" href="${esc(url)}" target="_blank" rel="noopener">Open video separately</a></figure>`;
      if (kind === "audio") return `<figure class="media"><audio controls preload="metadata" src="${esc(url)}"></audio><figcaption>${esc(f.fileName || "")}</figcaption></figure>`;
      if ((kind === "pdf" || kind === "text") && canViewInline(f)) return `<figure class="media doc-media"><iframe class="doc-frame" src="${esc(url)}" title="${esc(f.fileName || "Document")}" loading="lazy"></iframe><figcaption>${esc(f.fileName || "")}</figcaption><span class="doc-media-actions"><a class="muted" href="${esc(url)}" target="_blank" rel="noopener">Open in a new tab</a><button class="btn light" type="button" data-download-file="${esc(f.url)}" data-download-name="${esc(f.fileName || "")}">Download</button></span></figure>`;
      return fileRow(f);
    }).join("") + `</div>`;
  }

  function fileRow(f) {
    const kind = kindOf(f);
    return `<div class="filerow"><span class="fic">${ICON_FOR[kind] || "📎"}</span>
      <span class="fname">${esc(f.fileName || "Attachment")}</span>
      <span class="factions">
        <button class="btn gold" type="button" data-download-file="${esc(f.url)}" data-download-name="${esc(f.fileName || "")}">Download</button>
      </span></div>`;
  }

  function files(list) {
    if (!Array.isArray(list) || !list.length) return "";
    return `<div class="filelist">${list.map(fileRow).join("")}</div>`;
  }

  /* -------------------------- show more / less -------------------------- */
  // Any list longer than the limit collapses, with a Show more / Show less
  // control so a busy subject never crowds the screen.
  const LIMIT = 5;
  // Preserve Show more / Show less state when a page re-renders its list.
  // Materials, for example, refreshes download status periodically; without
  // this state map every refresh would collapse an open list again.
  const moreState = new Map();
  function collapsible(id, cards, limit = LIMIT) {
    if (!cards.length) { moreState.delete(id); return `<p class="muted">Nothing here yet.</p>`; }
    const head = cards.slice(0, limit).join("");
    if (cards.length <= limit) { moreState.delete(id); return `<div class="list">${head}</div>`; }
    const rest = cards.slice(limit).join("");
    const open = moreState.get(id) === true;
    return `<div class="list">${head}<div class="list more" id="${id}" ${open ? "" : "hidden"}>${rest}</div></div>
      <button class="btn light showmore" type="button" data-more="${id}">${open ? "▴ Show less" : `▾ Show more (${cards.length - limit} more)`}</button>`;
  }

  function showDownloadProgress(name, pct=0) {
    let modal=document.getElementById("gbDownloadProgress");
    if(!modal){
      modal=document.createElement("div"); modal.id="gbDownloadProgress"; modal.className="modal";
      modal.innerHTML=`<div class="modal-box"><div class="section-head"><h2>Downloading material</h2><span id="gbDownloadPct">0%</span></div><p id="gbDownloadName" class="muted"></p><div class="progress" aria-label="Download progress"><i id="gbDownloadBar" style="width:0%"></i></div><p id="gbDownloadStatus" class="muted">Starting download…</p></div>`;
      document.body.appendChild(modal);
    }
    modal.hidden=false; document.body.classList.add("noscroll");
    modal.querySelector("#gbDownloadName").textContent=name; updateDownloadProgress(pct);
  }
  function updateDownloadProgress(pct, label) {
    const modal=document.getElementById("gbDownloadProgress"); if(!modal) return;
    const n=Math.max(0,Math.min(100,Math.round(Number(pct)||0)));
    modal.querySelector("#gbDownloadPct").textContent=`${n}%`;
    modal.querySelector("#gbDownloadBar").style.width=`${n}%`;
    if(label) modal.querySelector("#gbDownloadStatus").textContent=label;
  }
  function finishDownloadProgress(ok, message) {
    const modal=document.getElementById("gbDownloadProgress"); if(!modal) return;
    updateDownloadProgress(ok ? 100 : Number(modal.querySelector("#gbDownloadPct").textContent.replace("%","")) || 0, ok ? "Download complete." : message);
    if(ok) setTimeout(()=>{ modal.hidden=true; document.body.classList.remove("noscroll"); }, 700);
  }

  document.addEventListener("click", e => {
    const dl = e.target.closest("[data-download-file]");
    if (dl) {
      e.preventDefault();
      showDownloadProgress(dl.dataset.downloadName || "Download", pct => updateDownloadProgress(pct));
      GB.download(dl.dataset.downloadFile, dl.dataset.downloadName || "", (pct, label) => updateDownloadProgress(pct, label))
        .then(() => finishDownloadProgress(true))
        .catch(err => finishDownloadProgress(false, err?.message || "Download failed."));
      return;
    }
    const b = e.target.closest("[data-more]");
    if (!b) return;
    const box = document.getElementById(b.dataset.more);
    if (!box) return;
    const open = box.hidden;
    box.hidden = !open;
    moreState.set(b.dataset.more, open);
    b.textContent = open ? "▴ Show less" : `▾ Show more (${box.children.length} more)`;
  });

  // All user-facing messages and decisions use Gifted Brainz UI components,
  // rather than browser-native JavaScript dialog boxes.
  function message(text, options={}) {
    const title = String(options.title || "Gifted Brainz Tutorial");
    const label = String(options.buttonLabel || "OK");
    return new Promise(resolve => {
      const modal = document.createElement("div");
      modal.className = "modal gb-app-dialog";
      const tone = options.tone === "error" ? "#b42318" : options.tone === "success" ? "#067647" : "#0d2a5c";
      const mark = options.tone === "error" ? "!" : options.tone === "success" ? "✓" : "i";
      modal.innerHTML = `<div class="modal-box critical-box gb-app-dialog-box" role="dialog" aria-modal="true" aria-labelledby="gbAppDialogTitle" aria-describedby="gbAppDialogMessage">
        <div class="section-head"><h2 id="gbAppDialogTitle">${esc(title)}</h2><span aria-hidden="true" class="gb-app-dialog-mark" style="display:grid;place-items:center;flex:0 0 30px;width:30px;height:30px;border:2px solid ${tone};border-radius:50%;color:${tone};font-weight:900">${mark}</span></div>
        <p id="gbAppDialogMessage" style="white-space:pre-line;overflow-wrap:anywhere">${esc(text)}</p>
        <div class="factions" style="justify-content:flex-end"><button type="button" class="btn primary" data-gb-message-close>${esc(label)}</button></div>
      </div>`;
      document.body.appendChild(modal);
      document.body.classList.add("noscroll");
      const button = modal.querySelector("[data-gb-message-close]");
      const finish = () => {
        modal.remove();
        if (!document.querySelector(".modal")) document.body.classList.remove("noscroll");
        resolve(true);
      };
      button.addEventListener("click", finish);
      modal.addEventListener("click", e => { if (e.target === modal) finish(); });
      modal.addEventListener("keydown", e => { if (e.key === "Escape") { e.preventDefault(); finish(); } });
      setTimeout(() => button.focus(), 0);
    });
  }

  function promptValue(title, label, initialValue="", options={}) {
    return new Promise(resolve => {
      const modal = document.createElement("div");
      modal.className = "modal gb-app-dialog";
      const fieldId = "gbPromptValue";
      modal.innerHTML = `<form class="modal-box critical-box gb-app-dialog-box" role="dialog" aria-modal="true" aria-labelledby="gbPromptTitle">
        <div class="section-head"><h2 id="gbPromptTitle">${esc(title || "Enter a value")}</h2><button type="button" class="btn light" data-gb-prompt-cancel aria-label="Cancel">✕</button></div>
        ${label ? `<label for="${fieldId}" style="display:block;margin:12px 0 6px;font-weight:750">${esc(label)}</label>` : ""}
        <input id="${fieldId}" type="text" inputmode="${options.type === "url" ? "url" : "text"}" value="${esc(initialValue)}" maxlength="${Number(options.maxLength) || 500}" placeholder="${esc(options.placeholder || "")}" autocomplete="off" style="width:100%;box-sizing:border-box">
        ${options.help ? `<p class="muted" style="margin:7px 0 0">${esc(options.help)}</p>` : ""}
        <p class="error" data-gb-prompt-error hidden></p>
        <div class="factions" style="justify-content:flex-end;margin-top:16px"><button type="button" class="btn light" data-gb-prompt-cancel>Cancel</button><button type="submit" class="btn primary">${esc(options.submitLabel || "Save")}</button></div>
      </form>`;
      document.body.appendChild(modal);
      document.body.classList.add("noscroll");
      const form = modal.querySelector("form"), input = modal.querySelector("#" + fieldId), error = modal.querySelector("[data-gb-prompt-error]");
      let finished = false;
      const finish = value => {
        if (finished) return; finished = true;
        modal.remove();
        if (!document.querySelector(".modal")) document.body.classList.remove("noscroll");
        resolve(value);
      };
      modal.querySelectorAll("[data-gb-prompt-cancel]").forEach(b => b.addEventListener("click", () => finish(null)));
      modal.addEventListener("click", e => { if (e.target === modal) finish(null); });
      modal.addEventListener("keydown", e => { if (e.key === "Escape") { e.preventDefault(); finish(null); } });
      form.addEventListener("submit", e => {
        e.preventDefault();
        const value = input.value;
        if (typeof options.validate === "function") {
          const problem = options.validate(value);
          if (problem) { error.textContent = problem; error.hidden = false; input.focus(); return; }
        }
        finish(value);
      });
      setTimeout(() => { input.focus(); input.select(); }, 0);
    });
  }

  function confirmAction(title, message, proceedLabel="Yes, proceed", options={}) {
    const requirePhrase=String(options.requirePhrase||"").trim();
    return new Promise(resolve => {
      const modal=document.createElement("div"); modal.className="modal critical-modal";
      const phraseHtml=requirePhrase?`<div class="field" style="margin-top:12px"><label>Safety confirmation</label><input id="criticalPhrase" type="text" autocomplete="off" spellcheck="false" placeholder="Type ${esc(requirePhrase)} to confirm" aria-describedby="criticalPhraseHelp"><small id="criticalPhraseHelp" class="muted">This extra step helps prevent accidental destructive actions.</small></div>`:"";
      modal.innerHTML=`<div class="modal-box critical-box" role="dialog" aria-modal="true" aria-labelledby="criticalTitle"><div class="section-head"><h2 id="criticalTitle">${esc(title)}</h2><button type="button" class="btn light" data-cancel aria-label="Cancel">✕</button></div><p>${esc(message)}</p>${phraseHtml}<div class="factions" style="justify-content:flex-end"><button class="btn light" type="button" data-cancel>Cancel</button><button class="btn danger" type="button" data-proceed ${requirePhrase?'disabled':''}>${esc(proceedLabel)}</button></div></div>`;
      document.body.appendChild(modal); document.body.classList.add("noscroll");
      const proceed=modal.querySelector("[data-proceed]"), input=modal.querySelector("#criticalPhrase");
      const finish=v=>{modal.remove();document.body.classList.remove("noscroll");resolve(v)};
      if(input){ input.addEventListener("input",()=>{proceed.disabled=input.value.trim()!==requirePhrase}); setTimeout(()=>input.focus(),0); }
      else setTimeout(()=>proceed?.focus(),0);
      modal.addEventListener("click",e=>{
        if(e.target===modal||e.target.closest("[data-cancel]"))finish(false);
        else if(e.target.closest("[data-proceed]") && !proceed.disabled)finish(true);
      });
      modal.addEventListener("keydown",e=>{if(e.key==="Escape"){e.preventDefault();finish(false)}});
    });
  }

  function unsavedGuard() {
    // Intentionally does not use browser-native beforeunload dialogs. Pages
    // that need an unsaved-changes decision should call confirmAction() from
    // their own navigation/save controls so the decision stays in-app.
    let dirty=false;
    const mark=()=>{dirty=true}; const clear=()=>{dirty=false};
    return {mark,clear,isDirty:()=>dirty};
  }

  /* ------------------------- grading (score bands) ---------------------- */
  // One place decides the colour, the word, the remark and the emoji so the
  // dashboard, the Question Bank results page, performance and admin views agree.
  const BANDS = [
    { min: 0,  max: 39,  band: "red",    word: "Needs work", colour: "#b3261e", soft: "#fdeceb", ink: "#8a1b13",
      emoji: "💪", remark: "Don't be discouraged, you just need work" },
    { min: 40, max: 59,  band: "orange", word: "Fair",       colour: "#e08a00", soft: "#fff3e0", ink: "#8a5000",
      emoji: "🙂", remark: "Fair enough. There is room for improvement" },
    { min: 60, max: 79,  band: "green",  word: "Good",       colour: "#067647", soft: "#e7f6ee", ink: "#04502f",
      emoji: "👍", remark: "Nice attempt. You can do better" },
    { min: 80, max: 100, band: "blue",   word: "Excellent",  colour: "#1454b8", soft: "#e8f0fe", ink: "#123a6b",
      emoji: "🌟", remark: "Excellent. Keep it up" }
  ];

  function GRADE(score) {
    const n = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
    const b = BANDS.find(x => n >= x.min && n <= x.max) || BANDS[0];
    return { ...b, score: n, text: `${b.remark} ${b.emoji}` };
  }

  // Circular score meter used on the results screen (matches the design).
  function scoreDonut(percent, size = 168) {
    const g = GRADE(percent);
    const r = 52, c = 2 * Math.PI * r, off = c * (1 - g.score / 100);
    return `<svg class="donut" viewBox="0 0 130 130" width="${size}" height="${size}" role="img" aria-label="Score ${g.score} percent">
      <circle class="track" cx="65" cy="65" r="${r}"></circle>
      <circle class="bar" cx="65" cy="65" r="${r}" stroke="${g.colour}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"></circle>
      <text x="65" y="73" text-anchor="middle" fill="${g.colour}">${g.score}%</text>
    </svg>`;
  }

  function stars(rating, big = false) {
    const n = Math.round(Number(rating) || 0);
    return `<span class="rating-stars${big ? " big" : ""}" aria-label="${n} out of 5 stars">${"★".repeat(Math.min(5, n))}${"☆".repeat(Math.max(0, 5 - n))}</span>`;
  }

  return { NAV, SUBJECTS, SUBJECT_ICONS, EMOJI, mySubjects, esc, mount, safeHtml, textToHtml, mathHtml, renderMath, renderBody, media, files, fileRow, kindOf, collapsible, message, promptValue, confirmAction, unsavedGuard, GRADE, scoreDonut, stars, showDownloadProgress, updateDownloadProgress, finishDownloadProgress, enableDeviceNotifications, syncGrantedDeviceNotifications };
})();
