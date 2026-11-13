/* ------------------------------------------------------------------
   Gifted Brainz Tutorial — API client.

   Why this file is defensive: the portal runs on serverless functions, so
   transient gateway failures and mobile-network drops can happen. Requests
   use a bounded timeout and retry only transient gateway errors. Structured
   API errors (including storage/configuration failures) are surfaced directly
   instead of being mislabeled as a generic server wake-up.
------------------------------------------------------------------- */
window.GB = (() => {
  const tokenKey = "gbToken";
  const token = (url = "") => {
    try {
      // Keep student and administrator sessions separate. Admin routes must use
      // the admin token; student routes must use the student token. Falling back
      // to the other token is intentionally avoided so a stale session cannot
      // masquerade as the wrong role.
      const isAdminRoute = /^\/api\/admin(?:\/|$)/.test(String(url || ""));
      if (isAdminRoute) {
        return localStorage.getItem("gbAdminToken") || localStorage.getItem(tokenKey) || "";
      }
      return localStorage.getItem(tokenKey) || sessionStorage.getItem(tokenKey) || "";
    } catch { return ""; }
  };

  const esc = v => String(v ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const TIMEOUT = 20000;      // default API timeout; upload requests use a longer window
  const RETRIES = 3;          // retry brief gateway/serverless wake-up failures
  const wait = ms => new Promise(r => setTimeout(r, ms));

  class NetworkError extends Error {}

  async function once(url, options = {}) {
    const controller = new AbortController();
    const timeoutMs = Number(options.timeoutMs) > 0 ? Math.min(55000, Number(options.timeoutMs)) : TIMEOUT;
    const fetchOptions = { ...options };
    delete fetchOptions.timeoutMs;
    delete fetchOptions.retryAttempts;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...fetchOptions, signal: controller.signal, cache: "no-store" });
    } catch (e) {
      // Aborts, DNS failures and dropped connections all land here.
      throw new NetworkError(
        e && e.name === "AbortError"
          ? "The server is taking too long to respond. Please try again."
          : "Could not reach the Gifted Brainz server. Check your internet connection and try again."
      );
    } finally { clearTimeout(timer); }
  }

  const requestApi = async (url, options = {}) => {
    const headers = { ...(options.headers || {}) };
    const authToken = token(url);
    if (authToken) headers.Authorization = `Bearer ${authToken}`;

    // Retrying a write that the server may already have processed can create a
    // duplicate account or a duplicate submission, so only reads and
    // idempotent writes are retried. Uploads stay retryable because each
    // chunk is addressed by index and simply overwrites itself.
    const method = String(options.method || "GET").toUpperCase();
    const unsafe = ["/submit", "/answer", "/register", "/feedback", "/api/battle/rooms/"].some(part => String(url).includes(part));
    const requestedAttempts = Number(options.retryAttempts);
    const attempts = Number.isInteger(requestedAttempts) && requestedAttempts > 0 && requestedAttempts <= 5
      ? requestedAttempts
      : (method === "GET" || method === "HEAD" ? RETRIES : (unsafe ? 1 : 2));

    let lastError = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt) await wait(350 * attempt);
      let r;
      try {
        r = await once(url, { ...options, headers });
      } catch (e) { lastError = e; continue; }

      // Distinguish a transient gateway failure from a function that is
      // actually running and returning a structured 503 (for example, a
      // missing production storage configuration). The old code treated every
      // 503 as a generic "server is waking up" message, which hid the real
      // cause and made diagnosis unnecessarily difficult.
      let data = {};
      const type = r.headers.get("content-type") || "";
      if ([502, 504, 522, 524].includes(r.status)) {
        lastError = new NetworkError("The server is temporarily unavailable. Retrying automatically…");
        continue;
      }
      if (r.status === 503 && type.includes("application/json")) {
        try { data = await r.json(); } catch { data = {}; }
        // A structured 503 is an intentional API response (for example a
        // missing production storage configuration), not a cold-start signal.
        // Do not spend three more round trips retrying a deterministic error.
        throw Error(data.error || "The server is temporarily unavailable. Please check diagnostics.");
      }

      if (r.status === 503) {
        throw Error("The server is temporarily unavailable. Open /diagnostics.html for details.");
      }

      if (type.includes("application/json")) {
        try { data = await r.json(); } catch { data = {}; }
      } else {
        // Anything that is not JSON on an /api/ route means the request never
        // reached the API function: the host answered with a web page instead.
        // The usual cause is a deploy that published the static files but not
        // the serverless function (a drag-and-drop deploy does not build
        // functions), in which case /api/* falls through to the 404 page or to
        // the single-page fallback. Reporting that plainly — on a 200 as well
        // as on an error — stops a broken deploy from looking like a wrong
        // password, and stops a fallback page from being mistaken for a
        // successful login.
        const text = await r.text().catch(() => "");
        const looksLikeHtml = text.trim().startsWith("<");
        if (looksLikeHtml || !r.ok) {
          data = {
            error: looksLikeHtml
              ? "The API is not responding on this site: the server returned a web page instead of data. The serverless function was not published with this deploy. Open /diagnostics.html for details."
              : (text || "Request failed."),
            apiMissing: looksLikeHtml
          };
          if (looksLikeHtml) throw Error(data.error);
        }
      }

      if (r.status === 401 && /^\/api\/admin(?:\/|$)/.test(String(url || ""))) {
        try {
          const adminToken = localStorage.getItem("gbAdminToken") || "";
          const legacyToken = localStorage.getItem(tokenKey) || "";
          if (legacyToken && legacyToken !== adminToken) {
            const retryHeaders = { ...headers, Authorization: `Bearer ${legacyToken}` };
            const retry = await once(url, { ...options, headers: retryHeaders });
            if (retry.ok) {
              const retryType = retry.headers.get("content-type") || "";
              if (retryType.includes("application/json")) return await retry.json();
            }
          }
        } catch {}
      }
      if (r.status === 401) {
        try {
          const isAdminRoute = /^\/api\/admin(?:\/|$)/.test(String(url || ""));
          if (isAdminRoute) localStorage.removeItem("gbAdminToken");
          else { localStorage.removeItem(tokenKey); sessionStorage.removeItem(tokenKey); }
          localStorage.removeItem("gbUser"); sessionStorage.removeItem("gbUser");
        } catch {}
        const path = location.pathname;
        // Say why the student is back on the sign-in screen. Without this the
        // bounce looks exactly like "the login page just refreshed".
        if (!path.endsWith("login.html") && !path.endsWith("admin.html") && !path.endsWith("register.html") && path !== "/")
          location = "/login.html?session=expired";
      }
      if (!r.ok) throw Error(data.error || `Request failed (${r.status}).`);
      return data;
    }
    throw lastError || new NetworkError("Could not reach the Gifted Brainz server. Please try again.");
  };

  // Session-scoped GET coalescing: multiple components requesting the same data
  // share one HTTP call. Brief memoisation saves repeated large serverless reads
  // during navigation without caching live chat, scores, or private responses to disk.
  const getInFlight = new Map();
  const getMemo = new Map();
  let memoGeneration = 0;
  const memoTTL = path => {
    if (/^\/api\/subjects\/catalog(?:\?|$)/.test(path)) return 60000;
    if (/^\/api\/(?:videos|materials|cbt-tests|notes)(?:\?|$)/.test(path)) return 12000;
    if (/^\/api\/learning-space(?:\?|$)/.test(path)) return 15000;
    if (/^\/api\/(?:dashboard|progress)(?:\?|$)/.test(path)) return 1800;
    return 0;
  };
  function invalidateReads(){ memoGeneration++; getMemo.clear(); getInFlight.clear(); }
  const api = (url, options = {}) => {
    const method=String(options.method||"GET").toUpperCase();
    if(method!=="GET"&&method!=="HEAD"){
      invalidateReads();
      return requestApi(url, options);
    }
    // A token is part of the key, so cached student data cannot cross sessions.
    const key=method+"|"+token(url)+"|"+String(url);
    const ttl=memoTTL(String(url));
    const cached=ttl?getMemo.get(key):null;
    if(cached&&cached.expires>Date.now())return Promise.resolve(structuredClone(cached.data));
    if(getInFlight.has(key))return getInFlight.get(key).then(data=>structuredClone(data));
    const generation=memoGeneration;
    const ongoing=requestApi(url,options).then(data=>{
      if(ttl&&generation===memoGeneration){
        if(getMemo.size>=24)getMemo.delete(getMemo.keys().next().value);
        getMemo.set(key,{expires:Date.now()+ttl,data:structuredClone(data)});
      }
      return data;
    }).finally(()=>getInFlight.delete(key));
    getInFlight.set(key,ongoing);
    return ongoing.then(data=>structuredClone(data));
  };
  window.addEventListener("storage",e=>{if(["gbToken","gbAdminToken","gbUser"].includes(e.key||""))invalidateReads()});

  // Used by the sign-in screens to say precisely what is wrong.
  const health = async () => {
    try { const r = await once("/api/health", { method: "GET" }); return r.ok; }
    catch { return false; }
  };

  const logout = () => {
    // Ask the server to clear the download cookie; keepalive lets the request
    // survive the navigation that follows.
    try {
      fetch("/api/files/ticket", { method: "DELETE", credentials: "same-origin", keepalive: true }).catch(() => {});
      fetch('/api/auth/logout',{method:'POST',credentials:'same-origin',keepalive:true}).catch(()=>{});
    } catch {}
    invalidateReads();
    try {
      localStorage.removeItem("gbToken");sessionStorage.removeItem("gbToken");
      localStorage.removeItem("gbAdminToken");
      localStorage.removeItem("gbUser");sessionStorage.removeItem("gbUser");
      localStorage.removeItem("gbFileTicketAt");
    } catch {}
    location = "/";
  };

  // Phones frequently report an empty MIME type for camera videos, so the
  // extension is sent along and the server works the real type out.
  const guessType = name => {
    const e = String(name || "").toLowerCase().split(".").pop();
    return ({ mp4: "video/mp4", m4v: "video/x-m4v", mov: "video/quicktime", webm: "video/webm",
      "3gp": "video/3gpp", mkv: "video/x-matroska", avi: "video/x-msvideo",
      mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", aac: "audio/aac",
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
      pdf: "application/pdf" }[e]) || "";
  };


  const upload = async (file, onProgress, uploadBase = "/api/admin/upload") => {
    if (!file) return {};
    const report=(v)=>{ if(onProgress) onProgress(v); };
    report(0);
    try{
      const contentType = file.type || guessType(file.name);
      const CHUNK = 512 * 1024;
      const base = String(uploadBase || "/api/admin/upload").replace(/\/$/, "");
      const init = await api(base + "/init", {
        method: "POST", timeoutMs: 55000, retryAttempts: 3, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, contentType, size: file.size, chunkSize: CHUNK })
      });
      const actualChunk = Math.min(CHUNK, Math.max(64 * 1024, Number(init.chunkSize) || CHUNK));
      let index = 0, sent = 0;
      for (let off = 0; off < file.size; off += actualChunk, index++) {
        let bytes;
        try {
          bytes = new Uint8Array(await file.slice(off, off + actualChunk).arrayBuffer());
        } catch (readErr) {
          // Some browsers can invalidate a File reference after it was selected
          // (especially files exposed through Downloads/cloud providers).
          // Fall back to FileReader, which reacquires the bytes through the
          // browser's file-reading path instead of failing the whole import.
          bytes = await new Promise((resolve, reject) => {
            try {
              const reader = new FileReader();
              reader.onload = () => resolve(new Uint8Array(reader.result));
              reader.onerror = () => reject(reader.error || readErr || new Error("The selected file could not be read."));
              reader.onabort = () => reject(new Error("Reading the selected file was aborted."));
              reader.readAsArrayBuffer(file.slice(off, off + actualChunk));
            } catch (e) { reject(e || readErr); }
          });
        }
        // Makers Node Functions have a 1 MB request-body limit. JSON/base64 is
        // used deliberately here because some mobile/browser gateways can
        // expose a binary fetch body as empty, producing "Chunk data is
        // required." The 512 KiB binary payload remains safely below the limit
        // after base64 expansion and JSON overhead.
        let binary="";
        const step=0x8000;
        for(let i=0;i<bytes.length;i+=step){
          binary += String.fromCharCode(...bytes.subarray(i, Math.min(i+step, bytes.length)));
        }
        const data=btoa(binary);
        await api(base + "/chunk", {
          method: "POST", timeoutMs: 55000, retryAttempts: 4, headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uploadId: init.uploadId, index, data })
        });
        sent += bytes.length;
        report(Math.min(98, Math.round(sent / Math.max(1, file.size) * 98)));
      }
      const done = await api(base + "/complete", {
        method: "POST", timeoutMs: 55000, retryAttempts: 4, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId: init.uploadId, parts: index })
      });
      report(100);
      return { ...done, contentType: done.contentType || contentType, size: file.size };
    }catch(err){
      throw err;
    }
  };
  // Browser navigations (downloads, embedded viewers) cannot send an
  // Authorization header, so the signed token travels as a query parameter.
  /* ----------------------------------------------------------------
     Download tickets.

     The browser loads media itself (<img>, <video>, download anchors) and
     cannot attach an Authorization header, so file requests are authorised by
     a short-lived HttpOnly cookie that the server issues from the current API
     token. The API token itself is never placed in a URL: such URLs are kept
     in browser history, are copied whenever a link is shared, and are commonly
     written to access logs, yet they would grant full account access until
     they expired.
  ---------------------------------------------------------------- */
  const ticketStampKey = "gbFileTicketAt";
  const TICKET_REFRESH_MS = 20 * 60 * 1000;   // the cookie itself lasts 30 minutes
  let ticketInFlight = null;

  const ticketFresh = () => {
    try {
      return Date.now() - Number(localStorage.getItem(ticketStampKey) || 0) < TICKET_REFRESH_MS;
    } catch { return false; }
  };

  const ensureFileTicket = (force = false) => {
    const viewerToken = token() || token("/api/admin");
    if (!viewerToken) return Promise.resolve(false);
    if (!force && ticketFresh()) return Promise.resolve(true);
    if (ticketInFlight) return ticketInFlight;
    ticketInFlight = once("/api/files/ticket", {
      method: "POST",
      headers: { Authorization: `Bearer ${viewerToken}` },
      credentials: "same-origin"
    }).then(r => {
      if (!r.ok) return false;
      try { localStorage.setItem(ticketStampKey, String(Date.now())); } catch {}
      return true;
    }).catch(() => false).finally(() => { ticketInFlight = null; });
    return ticketInFlight;
  };

  const fileUrl = (url, opts = {}) => {
    if (!url) return "";
    // Fire-and-forget: the ticket is normally already valid, and any media
    // element that renders before the first ticket arrives is recovered by the
    // error handler below.
    ensureFileTicket();
    const u = new URL(url, location.origin);
    if (opts.inline) u.searchParams.set("inline", "1");
    return u.pathname + u.search;
  };

  // Re-issue the ticket and reload file media that failed while no valid ticket
  // was present, so a slow first load repairs itself.
  const refreshFileMedia = async () => {
    const ok = await ensureFileTicket(true);
    if (!ok) return;
    const selector = 'img[src*="/api/files/"], video[src*="/api/files/"], source[src*="/api/files/"]';
    for (const el of document.querySelectorAll(selector)) {
      const src = el.getAttribute("src");
      if (!src) continue;
      el.setAttribute("src", src.includes("?") ? `${src}&r=${Date.now()}` : `${src}?r=${Date.now()}`);
    }
  };

  if (token() || token("/api/admin")) {
    // Ticket issuance is a server request. Only start it eagerly on pages
    // that actually display protected media; other screens should not spend
    // a network/database round trip on an unused download cookie.
    if (/^\/(?:materials|admin|learning-centre)\.html$/.test(location.pathname)) ensureFileTicket();
    // Media load failures do not bubble, so listen during the capture phase.
    window.addEventListener("error", event => {
      const el = event && event.target;
      if (!el || !(el instanceof HTMLImageElement || el instanceof HTMLVideoElement)) return;
      if (!String(el.currentSrc || el.src || "").includes("/api/files/")) return;
      if (el.dataset.gbRetried === "1") return;
      el.dataset.gbRetried = "1";
      void refreshFileMedia();
    }, true);
  }

  const DL_DB = "gbMaterialDownloads";
  const DL_STORE = "handles";
  const openDownloadDb = () => new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("Persistent download tracking is not supported in this browser."));
    const req = indexedDB.open(DL_DB, 1);
    req.onupgradeneeded = () => { try { req.result.createObjectStore(DL_STORE); } catch {} };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Unable to open download storage."));
  });
  const putDownloadHandle = async (key, handle) => {
    if (!key || !handle || !window.indexedDB) return false;
    try {
      const db = await openDownloadDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(DL_STORE, "readwrite");
        tx.objectStore(DL_STORE).put(handle, key);
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      });
      db.close();
      return true;
    } catch { return false; }
  };
  const getDownloadHandle = async key => {
    if (!key || !window.indexedDB) return null;
    try {
      const db = await openDownloadDb();
      const handle = await new Promise((resolve, reject) => {
        const tx = db.transaction(DL_STORE, "readonly");
        const req = tx.objectStore(DL_STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return handle;
    } catch { return null; }
  };
  const materialDownloadExists = async key => {
    const handle = await getDownloadHandle(key);
    if (!handle) return false;
    try {
      const perm = handle.queryPermission ? await handle.queryPermission({ mode: "read" }) : "prompt";
      if (perm === "denied") return false;
      await handle.getFile();
      return true;
    } catch { return false; }
  };

  const download = async (url, fileName, onProgress, options = {}) => {
    if (!url) return { saved: false };
    const report = (value, label) => { try { if (typeof onProgress === "function") onProgress(Math.max(0, Math.min(100, Math.round(value))), label || ""); } catch {} };
    report(0, "Starting download…");

    // Ask for the save location while the original click still has user
    // activation. The resulting file handle is retained in IndexedDB only
    // after the complete download succeeds.
    let writable = null;
    let targetHandle = null;
    let persistent = false;
    const persistKey = String(options.persistKey || "");
    const directoryKey = String(options.directoryKey || "");
    if (options.persistent && persistKey && directoryKey && window.showDirectoryPicker) {
      let dir = await getDownloadHandle(directoryKey);
      try { if (dir && dir.queryPermission && await dir.queryPermission({ mode: "readwrite" }) === "denied") dir = null; } catch { dir = null; }
      if (!dir) {
        dir = await window.showDirectoryPicker({ mode: "readwrite" });
        await putDownloadHandle(directoryKey, dir);
      }
      targetHandle = await dir.getFileHandle(fileName || "download", { create: true });
      writable = await targetHandle.createWritable();
      persistent = true;
    } else if (options.persistent && persistKey && window.showSaveFilePicker) {
      const pickerTypes = (() => {
        const ext = extensionForFile(fileName, options.contentType || "application/octet-stream");
        const type = options.contentType && options.contentType !== "application/octet-stream" ? options.contentType : "";
        return type ? [{ description: "Material file", accept: { [type]: [ext] } }] : undefined;
      })();
      targetHandle = await window.showSaveFilePicker({ suggestedName: fileName || "download", types: pickerTypes });
      writable = await targetHandle.createWritable();
      persistent = true;
    }

    const ticketOk = await ensureFileTicket(true);
    if (!ticketOk && !token()) {
      if (writable) { try { await writable.abort(); } catch {} }
      throw new Error("Your session could not be verified. Please sign in again.");
    }
    const src = fileUrl(url, { inline: false });

    let total = 0;
    let type = "application/octet-stream";
    try {
      const authHeaders = extra => ({ ...(token() ? { Authorization: `Bearer ${token()}` } : {}), ...(extra || {}) });
      const head = await fetch(src, { method: "HEAD", credentials: "same-origin", cache: "no-store", headers: authHeaders() });
      if (!head.ok) throw new Error(`File request failed (${head.status}).`);
      total = Number(head.headers.get("content-length") || 0);
      type = head.headers.get("content-type") || options.contentType || type;
      if (!total) {
        const probe = await fetch(src, { credentials: "same-origin", cache: "no-store", headers: authHeaders({ Range: "bytes=0-0" }) });
        if (!probe.ok && probe.status !== 206) throw new Error(`File request failed (${probe.status}).`);
        const cr = probe.headers.get("content-range") || "";
        const match = cr.match(/\/([0-9]+)$/);
        total = match ? Number(match[1]) : 0;
      }
      if (!total) throw new Error("The file size could not be determined.");

      const CHUNK = 4 * 1024 * 1024;
      const parts = persistent ? null : [];
      report(0, "Downloading…");
      for (let start = 0; start < total; start += CHUNK) {
        const end = Math.min(total - 1, start + CHUNK - 1);
        const r = await fetch(src, { credentials: "same-origin", cache: "no-store", headers: authHeaders({ Range: `bytes=${start}-${end}` }) });
        if (!r.ok && r.status !== 206) throw new Error(`File request failed (${r.status}).`);
        if (r.status !== 206 && total > CHUNK) throw new Error("The file server did not honour the range request.");
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (!bytes.byteLength) throw new Error("The server returned an empty file chunk.");
        if (writable) await writable.write(bytes); else parts.push(bytes);
        const received = Math.min(total, start + bytes.byteLength);
        report(received / total * 100, `${Math.round(received / total * 100)}% downloaded`);
      }

      if (writable) {
        await writable.close();
        if (targetHandle && persistKey) await putDownloadHandle(persistKey, targetHandle);
        report(100, "Download complete");
        return { saved: true, persistent: true };
      }

      report(100, "Download complete");
      const blob = new Blob(parts, { type });
      const objectUrl = URL.createObjectURL(blob);
      try {
        const a = document.createElement("a");
        a.href = objectUrl; a.download = fileName || "download"; a.rel = "noopener";
        document.body.appendChild(a); a.click(); a.remove();
      } finally { setTimeout(() => URL.revokeObjectURL(objectUrl), 1000); }
      return { saved: true, persistent: false };
    } catch (e) {
      if (writable) { try { await writable.abort(); } catch {} }
      throw e;
    }
  };

  // Fetch an authenticated stored file as a local Blob URL. Sending the
  // bearer token in the request headers (never in the URL) makes this reliable
  // in mobile browsers and embedded PDF viewers that do not consistently send
  // the short-lived download-ticket cookie. Range requests remain bounded.
  // `maxBytes` is optional and lets material previews enforce the 5 MB rule.
  const fileBlobUrl = async (url, options = {}) => {
    if (!url) throw new Error("The file URL is missing.");
    const ticketOk = await ensureFileTicket(true);
    if (!ticketOk && !token()) throw new Error("Your session could not be verified. Please sign in again.");
    const src = fileUrl(url, { inline: true });
    const parsed = new URL(src, location.origin);
    if (parsed.origin !== location.origin || !parsed.pathname.startsWith("/api/files/"))
      throw new Error("This file cannot be previewed from an external location.");
    const authHeaders = extra => ({ ...(token() ? { Authorization: `Bearer ${token()}` } : {}), ...(extra || {}) });
    const request = async (init = {}) => {
      const response = await fetch(src, { credentials: "same-origin", cache: "no-store", ...init, headers: authHeaders(init.headers) });
      if (response.status === 401) throw new Error("Your session could not be verified while opening this file. Please return to Learning Materials and sign in again if the problem continues.");
      return response;
    };
    const head = await request({ method: "HEAD" });
    if (!head.ok) throw new Error(`The file could not be loaded (${head.status}).`);
    let total = Number(head.headers.get("content-length") || 0);
    const type = head.headers.get("content-type") || options.contentType || "application/octet-stream";
    const CHUNK = 4 * 1024 * 1024;
    const parts = [];
    if (!total) {
      const probe = await request({ headers: { Range: "bytes=0-0" } });
      if (!probe.ok && probe.status !== 206) throw new Error(`The file size could not be checked (${probe.status}).`);
      const cr = probe.headers.get("content-range") || "";
      const m = cr.match(/\/(\d+)$/);
      total = m ? Number(m[1]) : 0;
      if (total && probe.status === 206) parts.push(new Uint8Array(await probe.arrayBuffer()));
      else if (!total) {
        // Do not fall back to downloading an unbounded response when a caller
        // has explicitly requested a preview-size limit.
        if (Number(options.maxBytes) > 0) throw new Error("The file size could not be verified, so this file cannot be previewed safely. Please download it instead.");
        parts.push(new Uint8Array(await probe.arrayBuffer()));
      }
    }
    const maxBytes = Number(options.maxBytes) > 0 ? Number(options.maxBytes) : 0;
    if (maxBytes && total > maxBytes) {
      const limitMb = (maxBytes / (1024 * 1024)).toLocaleString(undefined, { maximumFractionDigits: 1 });
      throw new Error("This file is too large to preview here. Please download it to read the complete material.");
    }
    if (!total) {
      const r = await request();
      if (!r.ok) throw new Error(`The file could not be loaded (${r.status}).`);
      const blob = await r.blob();
      if (maxBytes && blob.size > maxBytes) throw new Error("This file is too large to preview here. Please download it to read the complete material.");
      return URL.createObjectURL(blob);
    }
    let received = parts.length ? parts[0].byteLength : 0;
    for (let start = received; start < total; start += CHUNK) {
      const end = Math.min(total - 1, start + CHUNK - 1);
      const r = await request({ headers: { Range: `bytes=${start}-${end}` } });
      if (!r.ok && r.status !== 206) throw new Error(`The file could not be loaded (${r.status}).`);
      if (r.status !== 206 && total > CHUNK) throw new Error("The file server did not honour the range request.");
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (!bytes.byteLength) throw new Error("The server returned an empty file.");
      parts.push(bytes);
      received += bytes.byteLength;
    }
    return URL.createObjectURL(new Blob(parts, { type }));
  };

  const extensionForFile = (name, type) => {
    const m = String(name || "").match(/(\.[A-Za-z0-9]{1,8})$/);
    if (m) return m[1];
    const map = { "application/pdf": ".pdf", "text/plain": ".txt", "application/zip": ".zip", "application/msword": ".doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx" };
    return map[String(type || "").toLowerCase()] || ".bin";
  };

  const del = url => api(url, { method: "DELETE" });

  return { api, esc, token, logout, upload, fileUrl, fileBlobUrl, download, materialDownloadExists, putDownloadHandle, del, health, ensureFileTicket, refreshFileMedia };
})();
