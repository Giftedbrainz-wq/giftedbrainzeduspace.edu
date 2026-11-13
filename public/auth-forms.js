/* Gifted Brainz standalone authentication handlers.
   Kept separate from the larger portal scripts so an unrelated portal-script
   error cannot leave login/registration forms without a submit handler. */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const path = String(location.pathname || "").replace(/\/+$/, "").toLowerCase();
  const escapeHtml = (value) => {
    if (window.GB && typeof window.GB.esc === "function") return window.GB.esc(value);
    return String(value ?? "").replace(/[&<>\"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
  };
  const markHandled = (event) => {
    if (typeof window.GBMarkAuthEventHandled === "function") window.GBMarkAuthEventHandled(event);
    else {
      try { event.__gbAuthHandled = true; } catch (_) { /* WeakSet marker is preferred. */ }
    }
  };
  const api = (...args) => {
    if (!window.GB || typeof window.GB.api !== "function") {
      return Promise.reject(new Error("The Gifted Brainz connection did not initialise. Refresh the page and try again."));
    }
    return window.GB.api(...args);
  };

  function showStudentStatus(kind, html) {
    const box = $("statusBox");
    if (!box) return;
    box.hidden = false;
    box.style.background = kind === "good" ? "#e7f6ee" : kind === "bad" ? "#fdeceb" : "#fff8e6";
    box.style.color = kind === "good" ? "#04502f" : kind === "bad" ? "#8a1b13" : "#7a5600";
    box.innerHTML = html;
  }

  function initAdminLogin() {
    const form = $("lf");
    if (!form) return;
    form.dataset.gbAuthHandlerReady = "true";
    let submitting = false;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      markHandled(event);
      if (submitting) return;
      submitting = true;
      const button = form.querySelector('button[type="submit"]');
      const originalLabel = button?.textContent || "Log in";
      const message = $("lm");
      if (message) { message.className = ""; message.textContent = "Checking your details…"; }
      if (button) { button.disabled = true; button.textContent = "Signing in…"; }
      let authenticated = false;
      try {
        const result = await api("/api/admin/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: $("username")?.value.trim() || "", password: $("password")?.value || "" })
        });
        if (!result?.token) throw new Error("The server did not return an administrator session. Please try again.");
        localStorage.setItem("gbToken", result.token);
        localStorage.setItem("gbAdminToken", result.token);
        authenticated = true;
        const loginLoaderStarted = window.GBLoginLoader?.show?.() ?? Date.now();

        // The main admin script exposes start() after the document has parsed.
        // If it is unavailable, report the separate console-load issue clearly
        // instead of letting the form appear to refresh or silently do nothing.
        if (typeof window.start !== "function") {
          throw new Error("Your login was accepted, but the admin console did not finish loading. Refresh the page; your login details were submitted successfully.");
        }
        await window.start();
        await window.GBLoginLoader?.hold?.(loginLoaderStarted, 400);
        window.GBLoginLoader?.hide?.();
        if (message) { message.className = "ok"; message.textContent = "Welcome back."; }
      } catch (error) {
        window.GBLoginLoader?.hide?.();
        const detail = error?.message || "Sign-in failed. Please try again.";
        if (message) {
          message.className = "error";
          message.textContent = detail;
        }
        // Once authentication succeeds the login panel is hidden. Put any subsequent
        // console-initialisation error in the visible admin workspace instead of hiding it.
        const panel = $("panel"), panelMessage = $("msg");
        if (authenticated && panel && !panel.hidden && panelMessage) {
          panelMessage.innerHTML = `<div class="notice error" role="alert"><b>Signed in, but the console did not finish loading.</b><p>${escapeHtml(detail)}</p><button class="btn light" type="button" id="retryAdminStart">Retry loading admin sections</button></div>`;
          $("retryAdminStart")?.addEventListener("click", async () => {
            const retry = $("retryAdminStart"); if (retry) { retry.disabled = true; retry.textContent = "Retrying…"; }
            try { if (typeof window.start === "function") await window.start(); }
            catch (retryError) { panelMessage.innerHTML = `<div class="notice error" role="alert"><b>Console loading failed.</b><p>${escapeHtml(retryError?.message || "Please refresh and try again.")}</p></div>`; }
          });
        }
        if (button) { button.disabled = false; button.textContent = originalLabel; }
        submitting = false;
      }
    });
  }

  function initStudentLogin() {
    const form = $("f"), username = $("username"), password = $("password"), message = $("msg");
    if (!form || !username || !password || !message) return;
    form.dataset.gbAuthHandlerReady = "true";

    if (new URLSearchParams(location.search).get("session") === "expired") {
      showStudentStatus("warn", "<b>Your session ended ⏳</b><br>Please sign in again to continue.");
    }

    // Offer silent entry ONLY when a valid remembered token exists. Never save passwords.
    const remember=$('rememberMe');
    try{if(remember)remember.checked=localStorage.getItem('gbRememberMe')!=='0';}catch{}
    if(localStorage.getItem('gbRememberMe')!=='0'){
      const existing=localStorage.getItem('gbToken');
      const check=existing?api('/api/progress',{retryAttempts:1}).then(()=>({token:existing,user:null})):Promise.reject(new Error('Refresh required'));
      check.catch(()=>api('/api/auth/refresh',{method:'POST',credentials:'include'})).then(result=>{
        if(result?.token){localStorage.setItem('gbToken',result.token);if(result.user)localStorage.setItem('gbUser',JSON.stringify(result.user));}
        window.GBLoginLoader?.show?.();location.replace('/dashboard.html');
      }).catch(()=>{try{localStorage.removeItem('gbToken');localStorage.removeItem('gbUser');}catch{}});
    }
    // Registration no longer has an approval or verification stage.
    let submitting = false, redirecting = false;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      markHandled(event);
      if (submitting) return;
      submitting = true;
      const button = form.querySelector('button[type="submit"]');
      const originalLabel = button?.textContent || "Login";
      message.textContent = "";
      message.className = "";
      if (button) { button.disabled = true; button.textContent = "Signing in…"; }
      try {
        const result = await api("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: username.value.trim(), password: password.value, rememberDevice:!!remember?.checked })
        });
        if (!result?.token || !result?.user) throw new Error("The server did not return a student session. Please try again.");
        if(remember?.checked){
          localStorage.setItem('gbRememberMe','1');localStorage.setItem('gbToken',result.token);localStorage.setItem('gbUser',JSON.stringify(result.user));
          sessionStorage.removeItem('gbToken');sessionStorage.removeItem('gbUser');
        }else{
          localStorage.setItem('gbRememberMe','0');localStorage.removeItem('gbToken');localStorage.removeItem('gbUser');
          sessionStorage.setItem('gbToken',result.token);sessionStorage.setItem('gbUser',JSON.stringify(result.user));
        }
        try { localStorage.removeItem("gbPendingUser"); } catch (_) {}
        const updateVersion = new URLSearchParams(location.search).get("update");
        redirecting = true;
        const loginLoaderStarted = window.GBLoginLoader?.show?.() ?? Date.now();
        await window.GBLoginLoader?.hold?.(loginLoaderStarted, 350);
        location.href = updateVersion ? "/update.html?version=" + encodeURIComponent(updateVersion) : "/dashboard.html";
      } catch (error) {
        window.GBLoginLoader?.hide?.();
        const text = String(error?.message || "Sign-in failed. Please try again.");
        if (/suspended/i.test(text)) {
          message.className="error";
          message.innerHTML='<strong>Account suspended</strong><br>'+escapeHtml(text)+'<br><a class="gb-whatsapp-button" href="/api/support/whatsapp?context=suspended" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:10px">🟢 Contact Administrator</a>';
        } else if (/password/i.test(text) || /incorrect/i.test(text) || /credential/i.test(text)) {
          message.className = "error";
          message.innerHTML = escapeHtml(text) + ' — <a href="/help.html#password">forgot your password?</a>';
        } else { message.className = "error"; message.textContent = text; }
      } finally {
        if (!redirecting) {
          submitting = false;
          if (button) { button.disabled = false; button.textContent = originalLabel; }
        }
      }
    });
  }

  function initRegistration() {
    const form = $("f"), name = $("name"), email = $("email"), whatsapp = $("whatsapp"), username = $("username"), password = $("password");
    const message = $("msg"), done = $("done"), button = $("go");
    if (!form || !name || !email || !whatsapp || !username || !password || !message || !done || !button) return;
    form.dataset.gbAuthHandlerReady = "true";
    // A local convenience suggestion, never an assertion about the email owner's identity.
    // Leave user-edited full names untouched and do not call a third-party lookup service.
    let suggestedName = '';
    email.addEventListener('input', () => {
      const local = email.value.trim().split('@')[0] || '';
      const parts = local.replace(/[._-]+/g,' ').trim().split(/\s+/).filter(Boolean);
      const plausible = parts.length >= 2 && parts.every(x => /^[a-zA-Z]{2,}$/.test(x));
      const next = plausible ? parts.map(x=>x[0].toUpperCase()+x.slice(1).toLowerCase()).join(' ') : '';
      if (!name.value.trim() || name.value===suggestedName) { name.value=next; suggestedName=next; }
    });
    const avatars=$("registerAvatars");
    if(avatars)avatars.innerHTML=Array.from({length:24},(_,i)=>{
      const id=`scholar-${String(i+1).padStart(2,"0")}`;
      return `<label class="avatar-choice" title="Avatar ${i+1}"><input type="radio" name="profileAvatar" value="${id}" ${i===0?"checked":""}><img src="/assets/avatars/${id}.png?v=12.6.2" alt="Avatar ${i+1}" loading="lazy"></label>`;
    }).join("");
    let subjectBoxes = Array.from(document.querySelectorAll('input[name="subjects"]'));
    const subjectCount = $("subjectCount");
    const selectedSubjects = () => subjectBoxes.filter((box) => box.checked).map((box) => box.value);
    function refreshSubjects() {
      const count = selectedSubjects().length;
      if (subjectCount) subjectCount.textContent = `${count} of 4 subjects selected`;
      subjectBoxes.filter((box) => !box.checked).forEach((box) => { box.disabled = count >= 4; });
    }
    subjectBoxes.forEach((box) => box.addEventListener("change", refreshSubjects));
    refreshSubjects();
    // New administrator-created subjects belong to the global subject catalogue,
    // not to Battle Arena alone. Registration and other pages use the same names.
    Promise.all([api("/api/subjects/catalog"),api("/api/subjects/icons")]).then(([names,icons])=>{
      const iconMap=Object.fromEntries((icons||[]).map(s=>[s.name,s.emoji]));
      if(!Array.isArray(names))return;
      const boxGrid=form.querySelector(".subject-select-grid");if(!boxGrid)return;
      names.forEach(name=>{
        if(typeof name!=="string"||subjectBoxes.some(box=>box.value===name))return;
        const label=document.createElement("label");label.className="subject-choice";
        const checkbox=document.createElement("input");checkbox.type="checkbox";checkbox.name="subjects";checkbox.value=name;
        const span=document.createElement("span");span.textContent=(iconMap[name]||"📚")+" "+name;
        label.append(checkbox,span);boxGrid.append(label);subjectBoxes.push(checkbox);
        checkbox.addEventListener("change",refreshSubjects);
      });
      refreshSubjects();
    }).catch(()=>{});

    let submitting = false;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      markHandled(event);
      if (submitting) return;
      submitting = true;
      message.textContent = "";
      message.className = "";
      if (password.value.length < 8) {
        message.className = "error";
        message.textContent = "Password must be at least 8 characters.";
        submitting = false;
        return;
      }
      button.disabled = true;
      button.textContent = "Creating account…";
      try {
        const result = await api("/api/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.value, email: email.value, whatsapp: whatsapp.value, username: username.value, password: password.value, selectedSubjects: selectedSubjects(), avatar:document.querySelector('input[name="profileAvatar"]:checked')?.value||"scholar-01" })
        });

        if(!result?.token||!result?.user)throw new Error("Account created, but the session could not be established. Please log in.");
        sessionStorage.setItem('gbToken',result.token);
        sessionStorage.setItem('gbUser',JSON.stringify(result.user));
        localStorage.removeItem('gbToken');localStorage.removeItem('gbUser');
        try{localStorage.removeItem("gbPendingUser")}catch{}
        const started=window.GBLoginLoader?.show?.()??Date.now();
        await window.GBLoginLoader?.hold?.(started,350);
        window.location.assign('/dashboard.html');
      } catch (error) {
        message.className = "error";
        message.textContent = error?.message || "Account creation failed. Please try again.";
      } finally {
        button.disabled = false;
        button.textContent = "Create Account";
        submitting = false;
      }
    });
  }

  if (path.endsWith("/admin.html")) initAdminLogin();
  else if (path.endsWith("/login.html")) initStudentLogin();
  else if (path.endsWith("/register.html")) initRegistration();
})();
