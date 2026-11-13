/* Gifted Brainz Tutorial — API core (EdgeOne Pages Node Function).
 *
 * This module is platform-agnostic apart from one storage adapter: it talks to
 * EdgeOne Pages Blob storage through the small facade below, and it is mounted
 * by node-functions/api/[[default]].js (all /api/* routes) and
 * node-functions/api/index.js (/api itself).
 *
 * Runtime: EdgeOne Pages **Node** Functions. Node built-ins (node:crypto,
 * node:zlib, Buffer, node:fs) are available there; they are NOT available in
 * EdgeOne Edge Functions, which is why this project must stay in
 * node-functions/ and must never be moved to edge-functions/.
 */
import crypto from "node:crypto";
import zlib from "node:zlib";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { fileURLToPath } from "node:url";
import { getStore } from "@edgeone/pages-blob";
import { createStudyChatStore, chatRoom } from "./study-chat-store.js";
import { realtimeConfiguration, signRealtimeToken, realtimeTopic } from "./study-realtime-auth.js";
import { seed } from "./seed.js";
import { normaliseImportedMathMarkup, ommlToLatex, mathmlToLatex } from "./math-extraction.js";
import { decodePdfText } from "./pdf-text-extraction.js";
import { extractPdfImageAssets } from "./pdf-image-extraction.js";

/* ------------------------------------------------------------------
   Request context bridge.

   EdgeOne Pages hands each request a single `context` object rather than
   Netlify's (request, context) pair. Environment variables live on
   `context.env` and the client IP on `context.clientIp`, so the entry point
   calls bindContext() once per request and everything below reads through
   env() / clientIp() instead of touching process.env directly.
------------------------------------------------------------------- */
const REQUEST_CONTEXT = new AsyncLocalStorage();
function makeRequestContext(context) {
  return {
    env: context && context.env && typeof context.env === "object" ? context.env : null,
    clientIp: String(context?.clientIp || context?.request?.eo?.clientIp || "").trim(),
    method: String(context?.request?.method || "GET").toUpperCase()
  };
}
export function bindContext(context) {
  // Kept as a compatibility helper for callers that still bind context before
  // invoking the handler. New route entry points use runWithContext(), which
  // makes the context request-local and safe when 300+ requests share one
  // warm Node process concurrently.
  const requestContext = makeRequestContext(context);
  globalThis.__gbGetStore = getStore;
  return requestContext;
}
export function runWithContext(context, fn) {
  const requestContext = makeRequestContext(context);
  globalThis.__gbGetStore = getStore;
  return REQUEST_CONTEXT.run(requestContext, fn);
}
function requestContext() {
  return REQUEST_CONTEXT.getStore() || null;
}
function env(name) {
  const scoped = requestContext()?.env;
  const fromContext = scoped ? scoped[name] : undefined;
  if (fromContext !== undefined && fromContext !== null && fromContext !== "") return String(fromContext);
  const fromProcess = typeof process !== "undefined" && process.env ? process.env[name] : undefined;
  return fromProcess === undefined || fromProcess === null ? "" : String(fromProcess);
}
function envFlag(name) {
  return /^(1|true|yes|on)$/i.test(env(name));
}

var SUBJECTS = ["Mathematics", "Use of English", "Physics", "Chemistry", "Biology"];
var REQUIRED_REGISTRATION_SUBJECT = "Use of English";
var MAX_SELECTED_SUBJECTS = 4;
const GB_AVATARS = Array.from({length:24},(_,i)=>`scholar-${String(i+1).padStart(2,"0")}`);
function validAvatar(v){return GB_AVATARS.includes(v)?v:(/^custom-[a-f0-9-]{36}$/.test(String(v||""))?v:"scholar-01");}
function subjectEmoji(v){const s=Array.from(cleanString(v,20));return s.length<=8&&s.length>0&&!/[<>"'`\\]/.test(v)?s.join(""):"📚";}

function normaliseSelectedSubjects(value, available=SUBJECTS) {
  const arr = Array.isArray(value) ? value.map(v => cleanString(v, 80)) : [];
  return [...new Set(arr)].filter(Boolean).filter(x => available.includes(x));
}
function validateSelectedSubjects(value, available=SUBJECTS) {
  if(!Array.isArray(value)||value.some(v=>!available.includes(cleanString(v,80))))return {error:"Choose subjects from the available list."};
  const subjects = normaliseSelectedSubjects(value,available);
  if (!subjects.includes(REQUIRED_REGISTRATION_SUBJECT)) return { error: "Use of English is compulsory." };
  if (subjects.length > MAX_SELECTED_SUBJECTS) return { error: "You can select a maximum of 4 subjects, including Use of English." };
  return { subjects };
}
var CONTENT_PACK_VERSION = "2026.08.16-content-7-final";
var CONTENT_PACK = {
  version: CONTENT_PACK_VERSION,
  subjects: SUBJECTS,
  notes: seed.notes || [],
  tests: seed.tests || [],
  questionBank: seed.questionBank || [],
  announcements: seed.announcements || []
};
// EdgeOne Makers Node Functions have a 1 MB request-body limit. Uploads use
// base64 inside JSON, which expands the binary by about 4/3, so keep each
// binary chunk at 512 KiB to leave room for JSON/request overhead.
var MAX_CHUNK = 512 * 1024;
var TOKEN_TTL = 12 * 60 * 60;
function normaliseBuffer(value) {
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (Buffer.isBuffer(value)) return value;
  return Buffer.from(String(value ?? ""), "utf8");
}
function decodeBuffer(buf, type) {
  if (type === "arrayBuffer") return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  if (type === "json") return JSON.parse(buf.toString("utf8"));
  return buf.toString("utf8");
}
var FileStore = class _FileStore {
  constructor(root) {
    this.root = root;
    this.label = "filesystem:" + root;
  }
  static async create() {
    let here = "";
    try {
      here = path.dirname(fileURLToPath(import.meta.url));
    } catch {
      here = "";
    }
    const candidates = [
      env("GB_DATA_DIR"),
      here ? path.join(here, "../../.gifted-brainz-store") : "",
      path.join(process.cwd(), ".gifted-brainz-store"),
      path.join(os.tmpdir(), "gifted-brainz-store")
    ].filter(Boolean);
    for (const dir of candidates) {
      try {
        await fs.mkdir(dir, { recursive: true });
        const probe = path.join(dir, ".write-probe");
        await fs.writeFile(probe, "ok");
        await fs.unlink(probe).catch(() => {
        });
        return new _FileStore(dir);
      } catch {
      }
    }
    throw new Error("No writable directory is available for the data store.");
  }
  file(key) {
    return path.join(this.root, crypto.createHash("sha256").update(String(key)).digest("hex") + ".bin");
  }
  async get(key, opts = {}) {
    try {
      return decodeBuffer(await fs.readFile(this.file(key)), opts.type || "text");
    } catch (error) {
      if (error && (error.code === "ENOENT" || error instanceof SyntaxError)) return null;
      throw error;
    }
  }
  async set(key, value) {
    const target = this.file(key), tmp = target + "." + crypto.randomUUID() + ".tmp";
    await fs.writeFile(tmp, normaliseBuffer(value));
    await fs.rename(tmp, target);
  }
  async setJSON(key, value) {
    return this.set(key, JSON.stringify(value));
  }
  async delete(key) {
    try {
      await fs.unlink(this.file(key));
    } catch {
    }
  }
};
var MemoryStore = class {
  constructor() {
    this.map = /* @__PURE__ */ new Map();
    this.label = "memory";
  }
  async get(key, opts = {}) {
    const buf = this.map.get(String(key));
    if (!buf) return null;
    try {
      return decodeBuffer(buf, opts.type || "text");
    } catch {
      return null;
    }
  }
  async set(key, value) {
    this.map.set(String(key), normaliseBuffer(value));
  }
  async setJSON(key, value) {
    return this.set(key, JSON.stringify(value));
  }
  async delete(key) {
    this.map.delete(String(key));
  }
};
var STORE_NAME = "gifted-brainz";
var CENTRAL_STORE_LABEL = "edgeone-blob";
function isCentralStore(candidate = activeBackend) {
  return candidate?.label === CENTRAL_STORE_LABEL;
}

/* EdgeOne Pages Blob adapter.
 *
 * The portal was written against the Netlify Blobs surface
 * (get/set/setJSON/delete plus conditional writes). EdgeOne Pages Blob offers
 * get/set/setJSON/getWithHeaders/delete/list, so this adapter supplies the two
 * things the app relies on that EdgeOne does not return natively:
 *
 *   1. getWithMetadata() — rebuilt from getWithHeaders()'s etag header.
 *   2. A { modified } result for `onlyIfNew` writes — rebuilt with a
 *      write-stamp + strong-consistency read-back, so lock-style writes keep
 *      real mutual exclusion across function instances.
 *
 * Reads and writes use strong consistency. EdgeOne's default eventual mode can
 * serve a value that is up to a minute stale on another edge node, which for a
 * shared student/results record would recreate exactly the cross-device
 * "saved on one phone, missing on another" problem this portal must avoid.
 */
var EdgeOneBlobStore = class {
  constructor(blob) {
    this.blob = blob;
    this.label = CENTRAL_STORE_LABEL;
  }
  async get(key, opts = {}) {
    const type = opts.type || "text";
    const value = await this.blob.get(String(key), { type, consistency: "strong" });
    return value === undefined ? null : value;
  }
  async getWithMetadata(key, opts = {}) {
    const type = opts.type || "text";
    if (typeof this.blob.getWithHeaders === "function") {
      const record = await this.blob.getWithHeaders(String(key), { type, consistency: "strong" });
      if (!record) return { data: null, etag: null };
      const headers = record.headers || {};
      const etag = headers.etag || headers.ETag || headers["x-etag"] || null;
      let data = record.body;
      if (type === "json" && typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          data = null;
        }
      }
      return { data: data === undefined ? null : data, etag };
    }
    return { data: await this.get(key, opts), etag: null };
  }
  async set(key, value, opts = {}) {
    const k = String(key);
    if (opts.onlyIfNew) {
      const existing = await this.blob.get(k, { consistency: "strong" }).catch(() => null);
      if (existing !== null && existing !== undefined && existing !== "") return { modified: false };
      try {
        await this.blob.set(k, value, { onlyIfNew: true });
      } catch (error) {
        if (/exist|conflict|precondition/i.test(String(error?.message || error))) return { modified: false };
        throw error;
      }
      return { modified: true };
    }
    await this.blob.set(k, value);
    return { modified: true };
  }
  async setJSON(key, value, opts = {}) {
    const k = String(key);
    if (opts.onlyIfNew || opts.onlyIfMatch) {
      // Claim the key with a unique stamp, then read it back with strong
      // consistency. Only the writer whose stamp survived owns the key, which
      // is what turns "last write wins" into a usable lock primitive.
      const stamp = crypto.randomUUID();
      const existing = await this.blob.get(k, { consistency: "strong" }).catch(() => null);
      if (opts.onlyIfNew && existing !== null && existing !== undefined && existing !== "") return { modified: false };
      const payload = value && typeof value === "object" && !Array.isArray(value) ? { ...value, __writeStamp: stamp } : value;
      try {
        await this.blob.set(k, JSON.stringify(payload), opts.onlyIfNew ? { onlyIfNew: true } : {});
      } catch (error) {
        if (/exist|conflict|precondition/i.test(String(error?.message || error))) return { modified: false };
        throw error;
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { modified: true };
      const confirmed = await this.blob.get(k, { type: "json", consistency: "strong" }).catch(() => null);
      return { modified: !!confirmed && confirmed.__writeStamp === stamp };
    }
    await this.blob.set(k, JSON.stringify(value));
    return { modified: true };
  }
  async delete(key) {
    await this.blob.delete(String(key));
  }
};

async function createBlobStore() {
  // No throw-away probe on cold start: getStore() creates the namespace lazily
  // and the first real read validates it, which keeps the login path short.
  const options = { name: STORE_NAME, consistency: "strong" };
  const projectId = env("EDGEONE_PAGES_PROJECT_ID") || env("EO_PAGES_PROJECT_ID");
  const token = env("EDGEONE_PAGES_API_TOKEN") || env("EO_PAGES_API_TOKEN");
  // projectId/token are only needed when the store is reached from outside an
  // EdgeOne Pages function (local scripts, migrations). Inside a deployed
  // function the platform injects the credentials automatically.
  if (projectId && token) {
    options.projectId = projectId;
    options.token = token;
  }
  return new EdgeOneBlobStore(getStore(options));
}
var backendPromise = null;
var activeBackend = null;
var storageStatus = { backend: "starting", persistent: false, notes: [] };
var backendGeneration = 0;
var storageRecoveryPromise = null;
function isExpiredBlobsTokenError(error) {
  const text = String(error?.message || error || "").toLowerCase();
  return /token\s+expired|expired[^\n]*token|failed to decode token|decode token/.test(text);
}
function isRetryableBlobsError(error) {
  if (isExpiredBlobsTokenError(error)) return true;
  const text = String(error?.message || error || "").toLowerCase();
  return /internal error|internal server error|status code 5\d\d|status code 429|\b5\d\d\b|too many requests|network|fetch failed|timed out|timeout|econnreset|econnrefused|socket hang up|eai_again/.test(text);
}
async function refreshBlobBackend(reason = "storage failure") {
  if (storageRecoveryPromise) return storageRecoveryPromise;
  storageRecoveryPromise = (async () => {
    const generation = ++backendGeneration;
    activeBackend = null;
    backendPromise = null;
    storageStatus = { backend: "recovering", persistent: false, notes: [`Reinitialising EdgeOne Blob storage after ${reason}.`] };
    try {
      const blobs = await createBlobStore();
      activeBackend = blobs;
      storageStatus = { backend: CENTRAL_STORE_LABEL, persistent: true, notes: [`Storage client refreshed (generation ${generation}).`] };
      return blobs;
    } catch (error) {
      storageStatus = { backend: "unavailable", persistent: false, notes: [`Storage refresh failed: ${error?.message || error}`] };
      throw error;
    } finally {
      storageRecoveryPromise = null;
    }
  })();
  return storageRecoveryPromise;
}
async function resolveBackend() {
  const notes = [];
  try {
    const blobs = await createBlobStore();
    activeBackend = blobs;
    storageStatus = { backend: CENTRAL_STORE_LABEL, persistent: true, notes };
    return blobs;
  } catch (error2) {
    notes.push("EdgeOne Blob storage unavailable: " + (error2?.message || error2));
  }

  // IMPORTANT: never fall back to the function's local filesystem in a deployed
  // environment. Function instances do not share a filesystem, so doing so
  // would create the exact cross-device/cross-instance split-brain problem this
  // portal must avoid. A deployed request must fail rather than silently create
  // a second data store. The local filesystem store is therefore opt-in and is
  // only ever used when GB_ALLOW_LOCAL_STORE is explicitly enabled for local
  // development (`edgeone pages dev`).
  if (!envFlag("GB_ALLOW_LOCAL_STORE")) {
    const error = new Error("Central persistent storage is unavailable. EdgeOne Pages Blob storage must be reachable; local per-instance storage is disabled to protect cross-device data consistency.");
    error.storageUnavailable = true;
    storageStatus = { backend: "unavailable", persistent: false, notes };
    throw error;
  }

  // Local development only: a shared filesystem is useful when running the
  // function locally. It is deliberately never used as the production source
  // of truth.
  try {
    const disk = await FileStore.create();
    activeBackend = disk;
    storageStatus = { backend: disk.label, persistent: !disk.root.startsWith(os.tmpdir()), notes: [...notes, "Local development filesystem."] };
    return disk;
  } catch (error2) {
    notes.push("Filesystem store unavailable: " + (error2?.message || error2));
  }
  const error = new Error("Persistent storage is unavailable. EdgeOne Pages Blob storage must be reachable before the portal can save data.");
  error.storageUnavailable = true;
  storageStatus = { backend: "unavailable", persistent: false, notes };
  throw error;
}
async function backend() {
  if (!backendPromise) backendPromise = resolveBackend();
  return backendPromise;
}
async function withBackend(run) {
  let current = await backend();
  try {
    return await run(current);
  } catch (error) {
    if (current instanceof MemoryStore) throw error;
    console.error(`Storage backend "${current.label || "unknown"}" failed.`, error);

    // A warm function instance can outlive the short-lived storage context
    // token. Rebuild the client once and retry the operation against a fresh
    // context. Do not fall back to per-instance storage in production.
    if (isCentralStore(current) && isRetryableBlobsError(error)) {
      try {
        current = await refreshBlobBackend(isExpiredBlobsTokenError(error) ? "an expired authentication token" : "a transient Blobs error");
        return await run(current);
      } catch (retryError) {
        console.error("EdgeOne Blob storage recovery attempt failed.", retryError);
        activeBackend = null;
        storageStatus = {
          backend: "unavailable",
          persistent: false,
          notes: [isExpiredBlobsTokenError(retryError) ? "EdgeOne Blob authentication token expired; automatic client refresh did not recover it." : "EdgeOne Blob transient recovery failed; the next request will retry client initialisation."]
        };
        const storageError = new Error(
          isExpiredBlobsTokenError(retryError)
            ? "Persistent storage authentication expired. EdgeOne Blob storage will be retried on the next request; if the error persists, redeploy the project so the function receives fresh storage credentials."
            : "Persistent storage is temporarily unavailable. EdgeOne Blob storage will be retried on the next request."
        );
        storageError.storageUnavailable = true;
        storageError.cause = retryError;
        throw storageError;
      }
    }

    // Local development may use the filesystem, but production must never
    // silently switch to a different store.
    backendPromise = (async () => {
      if (envFlag("GB_ALLOW_LOCAL_STORE") && !(current instanceof FileStore)) {
        try {
          const disk = await FileStore.create();
          activeBackend = disk;
          storageStatus = { backend: disk.label, persistent: false, notes: ["Demoted after a storage failure during local development."] };
          return disk;
        } catch {
        }
      }
      const error2 = new Error("Persistent storage became unavailable. No in-memory or per-instance fallback is allowed in production.");
      error2.storageUnavailable = true;
      activeBackend = null;
      storageStatus = { backend: "unavailable", persistent: false, notes: ["Central storage failure; local fallback disabled."] };
      throw error2;
    })();
    const next = await backend();
    return run(next);
  }
}
var storeFacade = {
  get: (key, opts) => withBackend((s) => s.get(key, opts)),
  getWithMetadata: (key, opts = {}) => withBackend(async (s) => {
    if (typeof s.getWithMetadata === "function") return s.getWithMetadata(key, opts);
    return { data: await s.get(key, opts), etag: null };
  }),
  set: (key, value, opts = {}) => withBackend((s) => s.set(key, value, opts)),
  setJSON: (key, value, opts = {}) => withBackend((s) => s.setJSON(key, value, opts)),
  delete: (key) => withBackend((s) => s.delete(key))
};
function store() {
  return storeFacade;
}
function storageReport() {
  // authSecretConfigured tells the admin whether token signing depends on an
  // explicit AUTH_SECRET (guaranteed identical on every instance) or on a
  // value this app generated and stored itself. The generated path is
  // designed to converge to one value everywhere, but an explicit
  // AUTH_SECRET removes any dependency on that convergence working, so it is
  // worth surfacing as a configuration recommendation rather than hiding it.
  return { ...storageStatus, backend: activeBackend?.label || storageStatus.backend, authSecretConfigured: !!env("AUTH_SECRET") };
}
// Static release floor for server-side live runtime overrides.
 // An older blob runtime must never replace the newer API code shipped in this package.
 // Newer published runtimes remain eligible.
 var CURRENT_API_VERSION = "12.21.0";
var DEFAULT_JAMB_DATE = "2027-03-14T23:00:00.000Z"; // 15 March 2027, 00:00 Lagos time
 function versionNumber(v) {
   const m = String(v || "").match(/^(\d+)\.(\d+)\.(\d+)/);
   return m ? Number(m[1]) * 1000000 + Number(m[2]) * 1000 + Number(m[3]) : 0;
 }
 var runtimeCache = { key: "", handler: null, checkedAt: 0 };
var RUNTIME_CHECK_MS = 5e3;
var RUNTIME_GENERATION = 5;
async function activeRuntimeHandler(appUpdate) {
  const key = String(appUpdate?.runtimeKey || "");
  if (!key) return null;
  if (Number(appUpdate?.runtimeGeneration || 0) < RUNTIME_GENERATION) return null;
  const publishedVersion = String(appUpdate?.assetVersion || appUpdate?.version || "");
  if (publishedVersion && versionNumber(publishedVersion) && versionNumber(publishedVersion) < versionNumber(CURRENT_API_VERSION)) {
    return null;
  }
  const now = Date.now();
  if (runtimeCache.handler && runtimeCache.key === key && now - runtimeCache.checkedAt < RUNTIME_CHECK_MS) return runtimeCache.handler;
  runtimeCache.checkedAt = now;
  try {
    const source = await store().get(key, { type: "text" });
    if (!source) return null;
    const mod = await import("data:text/javascript;base64," + Buffer.from(source, "utf8").toString("base64") + "#" + encodeURIComponent(key));
    if (typeof mod.default !== "function") throw new Error("Published API module has no default handler.");
    runtimeCache = { key, handler: mod.default, checkedAt: now };
    return mod.default;
  } catch (error) {
    console.error("Runtime update could not be loaded:", error);
    runtimeCache = { key: "", handler: null, checkedAt: now };
    return null;
  }
}
function contentTypeForPath(filePath) {
  const ext = String(filePath).toLowerCase().split(".").pop();
  return { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", json: "application/json; charset=utf-8", webmanifest: "application/manifest+json", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", ico: "image/x-icon", mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg" }[ext] || "application/octet-stream";
}
function safeRuntimePath(name) {
  const p = String(name || "").replace(/^\/+/, "");
  if (/\/$/.test(p)) return null;
  if (!p || p.includes("\0") || p.includes("..") || !/^[A-Za-z0-9._\-/() @+%]+$/.test(p)) return null;
  return p;
}
var runtimeManifestFiles = (manifest) => (manifest?.files || []).filter((f) => f && typeof f.path === "string" && !f.path.endsWith("/"));
function stripModuleExports(source) {
  return String(source || "").replace(/^[ \t]*export\s+(default\s+)?(?=(const|let|var|function|async\s+function|class)\b)/gm, "").replace(/^[ \t]*export\s*\{[^}]*\}\s*;?[ \t]*$/gm, "");
}
function relativeImportsOf(source) {
  const out = [];
  const re = /^[ \t]*import\s+([^;"']*?)\s+from\s+["'](\.[^"']*)["'][ \t]*;?[ \t]*$/gm;
  let m;
  while (m = re.exec(String(source || ""))) out.push({ statement: m[0], clause: m[1].trim(), specifier: m[2] });
  return out;
}
function libKeyFor(specifier) {
  const parts = String(specifier || "").replace(/\\/g, "/").split("/").filter((x) => x && x !== "." && x !== "..");
  const at = parts.indexOf("lib");
  return (at >= 0 ? parts.slice(at + 1) : parts).join("/");
}
function inlineLibImports(source, libSources, chain = []) {
  let out = String(source || "");
  const prelude = [];
  for (const imp of relativeImportsOf(out)) {
    const key = libKeyFor(imp.specifier);
    if (!libSources.has(key)) {
      throw new Error(`The update package is incomplete: the API imports "${imp.specifier}", but node-functions/lib/${key} is not in the ZIP.`);
    }
    if (chain.includes(key)) throw new Error(`The update package has a circular import: node-functions/lib/${key}.`);
    if (/\bas\b|\*|^\s*[A-Za-z_$]/.test(imp.clause.replace(/^\{[\s\S]*\}$/, "{}"))) {
      throw new Error(`The update package uses an import style the live update channel cannot inline: "${imp.statement.trim()}". Only plain named imports of node-functions/lib modules are supported \u2014 no default, namespace (*) or renamed (as) imports.`);
    }
    prelude.push(stripModuleExports(inlineLibImports(libSources.get(key), libSources, [...chain, key])).trim());
    out = out.replace(imp.statement, "");
  }
  return prelude.length ? prelude.join("\n") + "\n" + out : out;
}
// The live update channel imports a published API module from a data: URL, so
// that module cannot resolve a bare npm specifier: after the EdgeOne build the
// dependency only exists inside the bundled function. The storage client that
// this function already imported is therefore handed over through globalThis,
// which works in every runtime and needs no filesystem resolution at all.
var STORE_IMPORT_RE = /import\s+\{\s*getStore\s*\}\s+from\s+["'](?:@edgeone\/pages-blob|@netlify\/blobs)["'];?/g;
function rewriteRuntimeApiSource(source, libSources) {
  let out = String(source || "");
  out = out.replace(
    STORE_IMPORT_RE,
    'const getStore = globalThis.__gbGetStore;\nif (typeof getStore !== "function") throw new Error("The published API module could not reach the EdgeOne Pages Blob client.");'
  );
  out = inlineLibImports(out, libSources);
  const leftover = [];
  const specifiers = /(?:\bfrom\s*|\bimport\s*\(\s*)["']([^"']+)["']/g;
  let m;
  while (m = specifiers.exec(out)) {
    const s = m[1];
    if (!/^(node:|file:|data:|https?:)/.test(s)) leftover.push(s);
  }
  if (leftover.length) {
    throw new Error(`The update API still imports ${[...new Set(leftover)].map((s) => `"${s}"`).join(", ")}. The live update channel can only resolve node: built-ins and modules bundled under node-functions/lib, so this package was not published.`);
  }
  return out;
}
async function deleteRuntimePackage(update) {
  if (!update) return;
  try {
    if (update.manifestKey) {
      const manifest = await store().get(update.manifestKey, { type: "json" });
      for (const f of manifest?.files || []) await store().delete(f.key).catch(() => {
      });
      await store().delete(update.manifestKey).catch(() => {
      });
    }
    if (update.runtimeKey) await store().delete(update.runtimeKey).catch(() => {
    });
  } catch {
  }
}
async function publishRuntimePackage(zipBuffer, version) {
  const entries = unzipEntries(zipBuffer);
  const publicFiles = [];
  let apiSource = null;
  const libSources = /* @__PURE__ */ new Map();
  // The canonical EdgeOne layout is node-functions/lib/api-core.js plus
  // node-functions/lib/*.js helpers. The historical Netlify layout
  // (netlify/functions/api.mjs + netlify/lib/*) is still accepted so an older
  // update ZIP can be published without being repackaged first.
  const API_ENTRIES = ["node-functions/lib/api-core.js", "netlify/functions/api.mjs"];
  const LIB_PREFIXES = ["node-functions/lib/", "netlify/lib/"];
  for (const [rawName, data] of Object.entries(entries)) {
    const name = rawName.replace(/\\/g, "/").replace(/^\.\//, "");
    if (API_ENTRIES.includes(name)) {
      // Prefer the EdgeOne entry when a ZIP happens to carry both layouts.
      if (!apiSource || name === API_ENTRIES[0]) apiSource = Buffer.from(data).toString("utf8");
      continue;
    }
    const libPrefix = LIB_PREFIXES.find((prefix) => name.startsWith(prefix));
    if (libPrefix && /\.(mjs|js)$/.test(name)) {
      const libName = name.slice(libPrefix.length);
      if (libName !== "api-core.js") libSources.set(libName, Buffer.from(data).toString("utf8"));
    } else if (name.startsWith("public/") && !name.endsWith("/")) {
      const rel = safeRuntimePath(name.slice(7));
      if (rel) publicFiles.push({ path: rel, data: Buffer.from(data), contentType: contentTypeForPath(rel) });
    }
  }
  if (!publicFiles.some((f) => f.path === "index.html") || !publicFiles.some((f) => f.path === "app.js")) throw new Error("The update package is invalid: public/index.html and public/app.js are required.");
  if (!apiSource) throw new Error("The update package is invalid: node-functions/lib/api-core.js is missing.");
  if (!libSources.has("seed.js") && !libSources.has("seed.mjs")) throw new Error("The update package is invalid: node-functions/lib/seed.js is missing.");
  const rewrittenApi = rewriteRuntimeApiSource(apiSource, libSources);
  const safeVersion = String(version || "latest").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 60) || "latest";
  const prefix = `app-runtime/${safeVersion}`;
  const files = [];
  for (const file of publicFiles) {
    const key = `${prefix}/files/${file.path}`;
    await store().set(key, file.data);
    files.push({ path: file.path, key, contentType: file.contentType, size: file.data.length, sha256: crypto.createHash("sha256").update(file.data).digest("hex") });
  }
  const apiKey = `${prefix}/api-core.js`;
  let check;
  try {
    check = await import("data:text/javascript;base64," + Buffer.from(rewrittenApi, "utf8").toString("base64") + "#validation-" + Date.now());
  } catch (error) {
    throw new Error("The update package was rejected because its API file could not be loaded: " + (error?.message || "unknown error") + ". The live app was left untouched.");
  }
  if (typeof check.default !== "function") throw new Error("The update API could not be validated: node-functions/lib/api-core.js must export a default request handler. The live app was left untouched.");
  await store().set(apiKey, rewrittenApi);
  const manifestKey = `${prefix}/manifest.json`;
  await store().setJSON(manifestKey, { version: safeVersion, files, apiKey, createdAt: (/* @__PURE__ */ new Date()).toISOString() });
  return { runtimeKey: apiKey, manifestKey, assetVersion: safeVersion, files: files.length, runtimeGeneration: RUNTIME_GENERATION };
}
var attempts = /* @__PURE__ */ new Map();
function rateLimit(request, bucket, limit, windowMs) {
  // EdgeOne exposes the caller's address on the request context (bound per
  // request) and, at the edge, in eo-client-ip. x-forwarded-for is the last
  // resort because a proxy in front of the site may append to it.
  const ip = String(requestContext()?.clientIp || "").trim() || request.headers.get("eo-client-ip") || request.headers.get("x-forwarded-for") || "unknown";
  const key = bucket + ":" + String(ip).split(",")[0].trim();
  const now = Date.now();
  const a = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  if (a.length >= limit) {
    // Keep the pruned list so a blocked caller cannot regrow its own bucket.
    attempts.set(key, a);
    return false;
  }
  a.push(now);
  attempts.set(key, a);
  if (attempts.size > 5e3) {
    // Evict only buckets whose entries have all aged out. Clearing the whole
    // map here would have reset every active limit at once, which is exactly
    // what a brute-force attempt would try to trigger.
    for (const [k, times] of attempts) {
      if (!times.some((t) => now - t < windowMs)) attempts.delete(k);
    }
  }
  return true;
}
var clone = (x) => JSON.parse(JSON.stringify(x));
function normalise(d) {
  d.users = Array.isArray(d.users) ? d.users : [];
  d.notes = Array.isArray(d.notes) ? d.notes : [];
  // Keep older metadata intact in storage, but do not create or require
  // any folders or containers for notes, tests or videos.
  d.materialCollections = Array.isArray(d.materialCollections) ? d.materialCollections : [];
  d.tests = Array.isArray(d.tests) ? d.tests : [];
  d.tests = d.tests.map(t => ({ ...t, questions: Array.isArray(t.questions) ? t.questions.map(q => ({ ...q, marks: Number.isFinite(Number(q?.marks)) && Number(q.marks) > 0 ? Number(q.marks) : 1 })) : [] }));
  d.results = Array.isArray(d.results) ? d.results : [];
  d.announcements = Array.isArray(d.announcements) ? d.announcements : [];
  d.questionBank = Array.isArray(d.questionBank) ? d.questionBank : [];
  d.topics = Array.isArray(d.topics) ? d.topics : [];
  d.questionReports = Array.isArray(d.questionReports) ? d.questionReports : [];
  const topicByKey = new Map(d.topics.map(t => [`${String(t.subject||"").toLowerCase()}|${String(t.name||"").trim().toLowerCase()}`, t]));
  for (const q of d.questionBank) {
    q.topic = cleanString(q.topic || "", 200);
    q.topicId = q.topicId || "";
    if (q.q && Array.isArray(q.options) && q.options.length >= MIN_OPTIONS && Number.isInteger(Number(q.answer))) {
      const improved = improveImportedExplanation(q.q, q.options, Number(q.answer), q.explanation || "");
      if (improved) q.explanation = improved.slice(0, 4000);
    }
    if (q.topic && !q.topicId) {
      const key = `${String(q.subject||"").toLowerCase()}|${q.topic.trim().toLowerCase()}`;
      const existing = topicByKey.get(key);
      if (existing) q.topicId = existing.id;
      else {
        const t = { id: crypto.randomUUID(), subject: q.subject, name: q.topic.trim(), slug: q.topic.trim().toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        d.topics.push(t); topicByKey.set(key,t); q.topicId = t.id;
      }
    }
    if (!q.topicId) {
      const key = `${String(q.subject||"").toLowerCase()}|uncategorized / topic not assigned`;
      let t = topicByKey.get(key);
      if (!t) { t={id:crypto.randomUUID(),subject:q.subject,name:"Uncategorized / Topic Not Assigned",slug:"uncategorized-topic-not-assigned",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}; d.topics.push(t); topicByKey.set(key,t); }
      q.topicId=t.id; if(!q.topic) q.topic=t.name;
    }
  }
  d.feedback = Array.isArray(d.feedback) ? d.feedback : [];
  d.notifications = Array.isArray(d.notifications) ? d.notifications : [];
  d.pushSubscriptions = Array.isArray(d.pushSubscriptions) ? d.pushSubscriptions : [];
  d.questionSets = Array.isArray(d.questionSets) ? d.questionSets : []; // Legacy records retained for data compatibility only.
  // Student revision tools are independent of published resources.
  for (const key of ["learningMistakes","learningSaved","learningPlans","learningPartners","learningMessages","learningBlocks","learningReports","learningPartnerGoals","learningLinks","learningEvents","learningAssessments","learningCommunities","learningCommunityMessages"]) {
    d[key] = Array.isArray(d[key]) ? d[key] : [];
  }
  d.progress = Array.isArray(d.progress) ? d.progress : [];
  d.progress = d.progress.filter(x => x && x.id && x.userId && platformSubjects(d).includes(x.subject) && x.topicId && x.completed === true).map(x => ({ id: String(x.id), userId: String(x.userId), subject: String(x.subject), topicId: String(x.topicId), completed: true, updatedAt: String(x.updatedAt || "") }));
  d.practiceHistory = Array.isArray(d.practiceHistory) ? d.practiceHistory : [];
  d.practiceHistory = d.practiceHistory.filter(x => x && x.id && x.userId && x.subject).map(x => ({ ...x, questionIds: Array.isArray(x.questionIds) ? [...new Set(x.questionIds.map(String))] : [], cycle: Number(x.cycle) > 0 ? Number(x.cycle) : 1 }));
  d.cbtTests = Array.isArray(d.cbtTests) ? d.cbtTests : [];
  d.cbtTests = d.cbtTests.filter(x => x && x.id && platformSubjects(d).includes(x.subject)).map(x => ({
    id: String(x.id),
    subject: x.subject,
    title: cleanString(x.title || "", 200),
    topicId: cleanString(x.topicId || "", 100),
    topicName: cleanString(x.topicName || "", 200),
    writeup: richBody(x.writeup || "", 2e4),
    linkUrl: cleanString(x.linkUrl || "", 1000),
    linkLabel: cleanString(x.linkLabel || "", 80) || "Start Assessment",
    performanceUrl: cleanString(x.performanceUrl || "", 1000),
    performanceLabel: cleanString(x.performanceLabel || "", 80) || "Check Performance",
    accessLevel: x.accessLevel === "restricted" ? "restricted" : "public",
    published: !!x.published,
    createdAt: x.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
    updatedAt: x.updatedAt || x.createdAt || (/* @__PURE__ */ new Date()).toISOString()
  }));
  d.videos = Array.isArray(d.videos) ? d.videos : [];
  d.videos = d.videos.filter(x => x && x.id && (platformSubjects(d).includes(x.subject)||x.subject==="All subjects")).map(x => ({
    id: String(x.id),
    subject: x.subject,
    title: cleanString(x.title || "", 200),
    description: richBody(x.description || "", 2e4),
    youtubeUrl: cleanString(x.youtubeUrl || "", 1000),
    published: !!x.published,
    createdAt: x.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
    updatedAt: x.updatedAt || x.createdAt || (/* @__PURE__ */ new Date()).toISOString()
  }));
  // Preserve independently linked YouTube lessons from older records. They
  // become normal Video Lessons instead of disappearing with the old folders.
  for (const legacyGroup of d.materialCollections) {
    for (const link of (Array.isArray(legacyGroup.resources) ? legacyGroup.resources : [])) {
      if (link.type !== "youtube") continue;
      const youtubeUrl=cleanString(link.url||"",1000);
      if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be|m\.youtube\.com)\//i.test(youtubeUrl)) continue;
      const id="legacy-video-"+crypto.createHash("sha256").update(String(link.id||youtubeUrl)).digest("hex").slice(0,22);
      if (d.videos.some(v=>v.id===id||v.youtubeUrl===youtubeUrl)) continue;
      const subject=platformSubjects(d).includes(legacyGroup.subject)?legacyGroup.subject:"All subjects";
      d.videos.push({id,subject,title:cleanString(link.title,200)||"Video lesson",description:"",youtubeUrl,published:true,createdAt:new Date(0).toISOString(),updatedAt:new Date(0).toISOString()});
    }
  }
  // The old public Scholars Connect feed is retired in v12.
  delete d.connectMessages;
  d.battleSubjects = Array.isArray(d.battleSubjects) ? d.battleSubjects : SUBJECTS.map(name => ({ id: crypto.createHash("sha256").update(name).digest("hex").slice(0,16), name }));
  d.battleSubjects = d.battleSubjects.filter(s => s && s.id && s.name).map(s=>({...s,emoji:subjectEmoji(s.emoji||"📚")}));
  d.battleQuestions = Array.isArray(d.battleQuestions) ? d.battleQuestions : [];
  d.battleRooms = Array.isArray(d.battleRooms) ? d.battleRooms : [];
  d.battleTeams = Array.isArray(d.battleTeams) ? d.battleTeams : [];
  d.questionSets = d.questionSets.map(set => ({ ...set, sections: Array.isArray(set.sections) ? set.sections.map(sec => ({ ...sec, questions: Array.isArray(sec.questions) ? sec.questions.map(q => ({ ...q, marks: Number.isFinite(Number(q?.marks)) && Number(q.marks) > 0 ? Number(q.marks) : 1 })) : [] })) : [] }));
  if (typeof d.appUpdate !== "object") d.appUpdate = null;
  if (!d.settings || typeof d.settings !== "object") d.settings = {};
  if (typeof d.settings.tokenVersion !== "number") d.settings.tokenVersion = 1;
  if (!d.settings.leaderboardResetAt) d.settings.leaderboardResetAt = "";
  if (!d.settings.subjectLeaderboardResetAt || typeof d.settings.subjectLeaderboardResetAt !== "object") d.settings.subjectLeaderboardResetAt = {};
  if (!Array.isArray(d.settings.deletedAnnouncementIds)) d.settings.deletedAnnouncementIds = [];
  for (const a of d.announcements) {
    if (!a.format) a.format = "text";
    if (!Array.isArray(a.media)) a.media = [];
    a.bodyFormat = a.format;
    a.attachments = a.media;
    if (!a.createdAt) a.createdAt = a.date || (/* @__PURE__ */ new Date(0)).toISOString();
  }
  for (const u of d.users) {
    // Use least-privilege for legacy accounts: only accounts explicitly marked
    // Activated should see newly restricted materials and CBT tests.
    if (!Number.isFinite(Number(u.tokenVersion)) || Number(u.tokenVersion) < 1) u.tokenVersion = 1;
    if (u.approval === void 0) u.approval = u.approved === false ? "pending" : "approved";
    if (!["pending", "approved", "rejected"].includes(u.approval)) u.approval = "approved";
    if (!["free", "activated"].includes(u.accountType)) u.accountType = "free";
    // Retirement of registration verification: pending accounts become active.
    // Previously rejected accounts stay suspended rather than gaining access silently.
    if(u.approval==="rejected")u.status="suspended";
    u.approval="approved";
    u.approved=true;
    u.avatar=validAvatar(u.avatar);
    u.selectedSubjects = [...new Set((Array.isArray(u.selectedSubjects)?u.selectedSubjects:[]).filter(v=>platformSubjects(d).includes(v)))];
    if (!u.selectedSubjects.includes(REQUIRED_REGISTRATION_SUBJECT)) u.selectedSubjects.unshift(REQUIRED_REGISTRATION_SUBJECT);
    u.selectedSubjects = u.selectedSubjects.slice(0, MAX_SELECTED_SUBJECTS);
  }
  for (const n of d.notes) {
    // Older materials remain public for backwards compatibility. Restricted
    // items are only returned by student routes when the account is activated.
    n.accessLevel = n.accessLevel === "restricted" ? "restricted" : "public";
    if (!Array.isArray(n.attachments)) {
      n.attachments = n.fileKey ? [{ key: n.fileKey, url: n.fileUrl || "/api/files/" + encodeURIComponent(n.fileKey), fileName: n.fileName || "file", contentType: n.contentType || "application/octet-stream" }] : [];
    }
    if (!n.format) n.format = "text";
    n.bodyFormat = n.format;
    if (!n.createdAt) n.createdAt = n.date || (/* @__PURE__ */ new Date(0)).toISOString();
  }
  return d;
}
function mergeContentPack(d) {
  const version = String(CONTENT_PACK.version || "");
  const current = String(d.settings?.contentPackVersion || "");
  if (current === version) return false;
  const upsertManaged = (collection, items) => {
    for (const item of items || []) {
      const idx = collection.findIndex((x) => String(x.id) === String(item.id));
      if (idx >= 0) collection[idx] = clone(item);
      else collection.push(clone(item));
    }
  };
  // Tests and the question bank are a versioned managed content pack. On a content-pack
  // upgrade, replace those managed collections rather than merely appending/upserting.
  // This prevents stale CBT/question records from older releases from surviving beside
  // normalises content-pack collections and ensures every CBT references a
  // question that exists in the current bank on every device.
  d.tests = clone(CONTENT_PACK.tests || []);
  d.questionBank = clone(CONTENT_PACK.questionBank || []);
  upsertManaged(d.notes, CONTENT_PACK.notes);
  const deletedAnnouncements = new Set((d.settings?.deletedAnnouncementIds || []).map(String));
  upsertManaged(d.announcements, (CONTENT_PACK.announcements || []).filter((a) => !deletedAnnouncements.has(String(a.id))));
  d.settings.contentPackVersion = version;
  return true;
}
function applyAdminCredentialReset(d) {
  if (d.settings.adminCredentialsVersion === ADMIN_CREDENTIALS_VERSION) return false;
  delete d.settings.adminPasswordHash;
  delete d.settings.adminPasswordSalt;
  delete d.settings.adminUsername;
  d.settings.adminCredentialsVersion = ADMIN_CREDENTIALS_VERSION;
  d.settings.tokenVersion = (d.settings.tokenVersion || 1) + 1;
  d.settings.adminCredentialsResetAt = (/* @__PURE__ */ new Date()).toISOString();
  return true;
}
var PERSIST_COLLECTIONS = ["topics", "questionReports", "users", "notes", "materialCollections", "tests", "results", "announcements", "questionBank", "feedback", "notifications", "pushSubscriptions", "questionSets", "practiceHistory", "progress", "cbtTests", "videos", "battleSubjects", "battleQuestions", "battleRooms", "battleTeams", "learningMistakes", "learningSaved", "learningPlans", "learningPartners", "learningMessages", "learningBlocks", "learningReports", "learningPartnerGoals", "learningLinks", "learningEvents", "learningAssessments", "learningCommunities", "learningCommunityMessages"];
var jsonEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function ensureVapidKeys(d) {
  const st = d.settings || (d.settings = {});
  if (st.vapidPrivateJwk && st.vapidPublicJwk && st.vapidSubject) return st;
  const pair = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const privateJwk = pair.privateKey.export({ format: "jwk" });
  const publicJwk = pair.publicKey.export({ format: "jwk" });
  st.vapidPrivateJwk = privateJwk;
  st.vapidPublicJwk = publicJwk;
  st.vapidSubject = cleanString(env("GB_VAPID_SUBJECT") || "mailto:admin@example.com", 240) || "mailto:admin@example.com";
  return st;
}
function vapidPublicRaw(jwk) {
  return Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
}
function hkdfExtract(salt, ikm) {
  return crypto.createHmac("sha256", salt).update(ikm).digest();
}
function hkdfExpand(prk, info, length) {
  const out = [];
  let previous = Buffer.alloc(0);
  let counter = 1;
  while (Buffer.concat(out).length < length) {
    previous = crypto.createHmac("sha256", prk).update(Buffer.concat([previous, Buffer.from(info), Buffer.from([counter++])])).digest();
    out.push(previous);
  }
  return Buffer.concat(out).subarray(0, length);
}
function pointJwk(raw) {
  if (!Buffer.isBuffer(raw) || raw.length !== 65 || raw[0] !== 4) throw new Error("The push subscription public key is invalid.");
  return { kty: "EC", crv: "P-256", x: raw.subarray(1, 33).toString("base64url"), y: raw.subarray(33, 65).toString("base64url") };
}
function signVapid(st, audience) {
  const header = { typ: "JWT", alg: "ES256" };
  const payload = { aud: audience, exp: Math.floor(Date.now() / 1e3) + 12 * 60 * 60, sub: st.vapidSubject };
  const input = Buffer.from(JSON.stringify(header)).toString("base64url") + "." + Buffer.from(JSON.stringify(payload)).toString("base64url");
  const key = crypto.createPrivateKey({ key: st.vapidPrivateJwk, format: "jwk" });
  const sig = crypto.sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" });
  return input + "." + sig.toString("base64url");
}
function encryptPush(subscription, payload) {
  const p = subscription?.keys || {};
  const clientRaw = Buffer.from(String(p.p256dh || ""), "base64url");
  const auth2 = Buffer.from(String(p.auth || ""), "base64url");
  if (clientRaw.length !== 65 || auth2.length < 16) throw new Error("The push subscription keys are invalid.");
  const clientPublic = crypto.createPublicKey({ key: pointJwk(clientRaw), format: "jwk" });
  const eph = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const ephJwk = eph.publicKey.export({ format: "jwk" });
  const ephRaw = vapidPublicRaw(ephJwk);
  const shared = crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: clientPublic });
  const ikm = hkdfExpand(hkdfExtract(auth2, shared), Buffer.concat([Buffer.from("WebPush: info\0"), clientRaw, ephRaw]), 32);
  const salt = crypto.randomBytes(16);
  const prk = hkdfExtract(salt, ikm);
  const cek = hkdfExpand(prk, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdfExpand(prk, Buffer.from("Content-Encoding: nonce\0"), 12);
  const plaintext = Buffer.concat([Buffer.from(JSON.stringify(payload), "utf8"), Buffer.from([2])]);
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(ephRaw.length, 20);
  return { body: Buffer.concat([header, ephRaw, encrypted]), publicRaw: ephRaw };
}
async function sendWebPush(st, subscription, payload) {
  const endpoint = String(subscription?.endpoint || "");
  if (!/^https?:\/\//i.test(endpoint)) throw new Error("Invalid push endpoint.");
  const audience = new URL(endpoint).origin;
  const { body } = encryptPush(subscription, payload);
  const jwt = signVapid(st, audience);
  const publicRaw = vapidPublicRaw(st.vapidPublicJwk);
  const response = await fetch(endpoint, { method: "POST", headers: { "TTL": "86400", "Content-Type": "application/octet-stream", "Content-Encoding": "aes128gcm", "Authorization": `vapid t=${jwt}, k=${publicRaw.toString("base64url")}` }, body });
  if (!response.ok) {
    const err = new Error(`Push endpoint returned ${response.status}.`);
    err.status = response.status;
    throw err;
  }
  return true;
}
async function sendWebPushes(d, items) {
  if (!d.pushSubscriptions.length || !items.length) return false;
  const st = ensureVapidKeys(d);
  const byUser = new Map(items.map((x) => [x.userId, x]));
  let removed = false;
  const results = await Promise.allSettled(d.pushSubscriptions.map(async (sub) => {
    const item = byUser.get(sub.userId);
    if (!item) return;
    try {
      await sendWebPush(st, sub, { title: item.title, body: item.message || "", url: item.url || "/dashboard.html", type: item.type || "notification", version: item.version || "" });
    } catch (err) {
      if (err?.status === 404 || err?.status === 410) {
        const i = d.pushSubscriptions.findIndex((x) => x.id === sub.id);
        if (i >= 0) {
          d.pushSubscriptions.splice(i, 1);
          removed = true;
        }
      }
    }
  }));
  void results;
  return removed;
}
function attachPersistBase(d) {
  try {
    Object.defineProperty(d, "__persistBase", { value: clone(d), writable: true, configurable: true, enumerable: false });
  } catch {
  }
  return d;
}
function mergeChangedCollection(baseList, nextList, latestList) {
  const idOf = (item) => String(item?.id || "");
  const base = new Map((Array.isArray(baseList) ? baseList : []).map((x) => [idOf(x), x]));
  const next = new Map((Array.isArray(nextList) ? nextList : []).map((x) => [idOf(x), x]));
  const latest = new Map((Array.isArray(latestList) ? latestList : []).map((x) => [idOf(x), x]));
  const order = [...Array.isArray(latestList) ? latestList : []];
  const pos = new Map(order.map((x, i) => [idOf(x), i]));
  for (const [id, value] of next) {
    if (!id) continue;
    const b = base.get(id), l = latest.get(id);
    const changed = !b || !jsonEqual(value, b);
    if (!changed) continue;
    if (!l) {
      pos.set(id, order.length);
      order.push(value);
      latest.set(id, value);
    } else {
      const i = pos.get(id);
      if (Number.isInteger(i)) order[i] = value;
      latest.set(id, value);
    }
  }
  for (const [id, b] of base) {
    if (!next.has(id)) {
      const l = latest.get(id);
      if (l && jsonEqual(l, b)) {
        const i = pos.get(id);
        if (Number.isInteger(i)) {
          order.splice(i, 1);
          pos.delete(id);
          for (let n = i; n < order.length; n++) pos.set(idOf(order[n]), n);
        }
        latest.delete(id);
      }
    }
  }
  return order;
}
/* Merge independent students' edits to the SAME match/team record.
 * The general collection merge handles different record IDs, but for one
 * active room two leaders may submit answers simultaneously. A shallow
 * replacement would silently lose the first submitted answer/chat. */
const safeBattleCopy=v=>v===undefined?undefined:clone(v);
function mergeBattleArray(base,next,latest,key){
  if(!Array.isArray(next))return safeBattleCopy(next);
  if(!Array.isArray(latest))return safeBattleCopy(next);
  const listKeys=new Set(["members","pending","ready","messages","suggestions","replies"]);
  if(!listKeys.has(key))return safeBattleCopy(next);
  const identity=v=>typeof v==="object"&&v!==null?String(v.id??v.userId??JSON.stringify(v)):String(v);
  const original=Array.isArray(base)?base:[];
  const prev=new Set(original.map(identity));
  const wanted=new Map(next.map(v=>[identity(v),v]));
  const result=latest.filter(v=>!prev.has(identity(v))||wanted.has(identity(v))).map(v=>safeBattleCopy(wanted.get(identity(v))??v));
  const seen=new Set(result.map(identity));
  for(const value of next){const id=identity(value);if(!seen.has(id)){result.push(safeBattleCopy(value));seen.add(id);}}
  return result;
}
function mergeBattleNested(base,next,latest,key=""){
  if(jsonEqual(base,next))return safeBattleCopy(latest);
  if(jsonEqual(base,latest))return safeBattleCopy(next);
  if(Array.isArray(next))return mergeBattleArray(base,next,latest,key);
  if(next&&typeof next==="object"&&!Array.isArray(next)&&latest&&typeof latest==="object"&&!Array.isArray(latest)){
    const result=safeBattleCopy(latest);
    const b=base&&typeof base==="object"&&!Array.isArray(base)?base:{};
    for(const child of new Set([...Object.keys(b),...Object.keys(next)])){
      if(!Object.prototype.hasOwnProperty.call(next,child)){delete result[child];continue;}
      result[child]=mergeBattleNested(b[child],next[child],latest[child],child);
    }
    return result;
  }
  return safeBattleCopy(next);
}
function mergeBattleRecords(baseList,nextList,latestList){
  const merged=mergeChangedCollection(baseList,nextList,latestList);
  const b=new Map((baseList||[]).map(v=>[v.id,v]));
  const n=new Map((nextList||[]).map(v=>[v.id,v]));
  const l=new Map((latestList||[]).map(v=>[v.id,v]));
  return merged.map(v=>{
    if(!b.has(v.id)||!n.has(v.id)||!l.has(v.id))return v;
    if(jsonEqual(b.get(v.id),n.get(v.id)))return v;
    return mergeBattleNested(b.get(v.id),n.get(v.id),l.get(v.id));
  });
}
function mergeConcurrent(base, next, latest) {
  const out = clone(latest || next || {});
  for (const key of PERSIST_COLLECTIONS) {
    out[key] = key==="battleRooms"||key==="battleTeams"||key==="announcements" ? mergeBattleRecords(base?.[key],next?.[key],latest?.[key]) : mergeChangedCollection(base?.[key], next?.[key], latest?.[key]);
  }
  // A leader's explicit team nullification must win even if another member
  // concurrently changes the team record. Otherwise an in-flight request
  // could resurrect a dissolved team in the shared data store.
  const initialTeamIds=new Set((base?.battleTeams||[]).map(t=>t.id));
  const nextTeamIds=new Set((next?.battleTeams||[]).map(t=>t.id));
  const dissolvedTeamIds=new Set([...initialTeamIds].filter(id=>!nextTeamIds.has(id)));
  if(dissolvedTeamIds.size)out.battleTeams=out.battleTeams.filter(t=>!dissolvedTeamIds.has(t.id));
  const bs = base?.settings || {}, ns = next?.settings || {}, ls = latest?.settings || {};
  out.settings = { ...ls };
  const keys = /* @__PURE__ */ new Set([...Object.keys(bs), ...Object.keys(ns)]);
  for (const key of keys) {
    const nextHas = Object.prototype.hasOwnProperty.call(ns, key);
    const baseHas = Object.prototype.hasOwnProperty.call(bs, key);
    if (nextHas !== baseHas || !jsonEqual(ns[key], bs[key])) {
      if (nextHas) out.settings[key] = clone(ns[key]);
      else delete out.settings[key];
    }
  }
  if (next?.appUpdate && !jsonEqual(next.appUpdate, base?.appUpdate) || !next?.appUpdate && base?.appUpdate) out.appUpdate = clone(next.appUpdate);
  if (next?.appUpdate == null && base?.appUpdate == null) out.appUpdate = latest?.appUpdate ?? null;
  return out;
}
var loadInFlight = null;
var DATA_CACHE = null;
var DATA_CACHE_AT = 0;
var DATA_CACHE_TTL_MS = 300;
var SAVE_LOCK = { chain: Promise.resolve() };

async function loadFresh() {
  let d = await store().get("data", { type: "json" });
  if (!d) {
    const backup = await store().get("data.backup", { type: "json" }).catch(() => null);
    if (backup) {
      d = backup;
      await store().setJSON("data", backup).catch(() => {
      });
    }
  }
  if (d) {
    let normal = normalise(d);
    let contentChanged = mergeContentPack(normal);
    // A content-pack upgrade replaces the managed question bank, so run the
    // migration pass again over the new questions to guarantee topic IDs exist.
    if (contentChanged) normal = normalise(normal);
    const topicMigrationChanged = normal.settings.topicMigrationVersion !== 1;
    if (topicMigrationChanged) normal.settings.topicMigrationVersion = 1;
    const explanationMigrationChanged = normal.settings.explanationMigrationVersion !== 1;
    if (explanationMigrationChanged) normal.settings.explanationMigrationVersion = 1;
    const adminChanged = applyAdminCredentialReset(normal);
    if (contentChanged || adminChanged || topicMigrationChanged || explanationMigrationChanged) await store().setJSON("data", normal);
    if (typeof normal._revision !== "number") normal._revision = 1;
    return normal;
  }
  const fresh = normalise(clone(seed));
  fresh.settings.contentPackVersion = CONTENT_PACK.version;
  fresh.settings.adminCredentialsVersion = ADMIN_CREDENTIALS_VERSION;
  fresh.settings.topicMigrationVersion = 1;
  fresh.settings.explanationMigrationVersion = 1;
  fresh._revision = 1;
  await store().setJSON("data", fresh);
  return fresh;
}

async function load(options = {}) {
  // GET/HEAD traffic is overwhelmingly read-only. A very short per-instance
  // cache removes repeated >1 MB Blob reads when a classroom of students loads
  // the dashboard/test pages together. Writes and explicit fresh reads always
  // bypass the cache. The 300 ms TTL keeps the window small while materially
  // reducing shared-storage pressure during concurrency spikes.
  const method = requestContext()?.method || "GET";
  const readRequest = method === "GET" || method === "HEAD";
  const now = Date.now();
  if (readRequest && !options.fresh && DATA_CACHE && now - DATA_CACHE_AT < DATA_CACHE_TTL_MS) {
    return attachPersistBase(clone(DATA_CACHE));
  }
  // Collapse simultaneous cold-start/request bursts into one storage read.
  if (!loadInFlight) {
    loadInFlight = loadFresh().finally(() => {
      loadInFlight = null;
    });
  }
  const base = await loadInFlight;
  DATA_CACHE = clone(base);
  DATA_CACHE_AT = Date.now();
  return attachPersistBase(clone(base));
}

async function saveLocked(d) {
  SAVE_LOCK.chain = SAVE_LOCK.chain.then(async () => {
    const writerId = crypto.randomUUID();
    for (let attempt = 0; attempt < 5; attempt++) {
      const latestRaw = await store().get("data", { type: "json" }).catch(() => null);
      const latest = latestRaw ? normalise(latestRaw) : null;
      const base = d?.__persistBase || latest || {};
      let out = latest && Number(latest._revision || 0) !== Number(base._revision || 0) ? mergeConcurrent(base, d, latest) : clone(d);
      delete out.__persistBase;
      out._revision = (Number(latest?._revision) || Number(base._revision) || 0) + 1;
      out._saveId = writerId;
      out.savedAt = new Date().toISOString();
      // The main record is over a megabyte, so mirroring it on every single
      // save would double the write cost of ordinary actions. Refresh the
      // rollback copy periodically instead; it only needs to be recent enough
      // to recover from a corrupt write, not identical to the previous save.
      if (latestRaw && shouldRefreshBackup()) await store().setJSON("data.backup", latestRaw);
      await store().setJSON("data", out);
      const confirmed = await store().get("data", { type: "json" }).catch(() => null);
      if (confirmed && confirmed._saveId === writerId) {
        delete out._saveId;
        try {
          for (const key of Object.keys(d)) delete d[key];
          Object.assign(d, clone(out));
        } catch {
        }
        attachPersistBase(d);
        DATA_CACHE = clone(out);
        DATA_CACHE_AT = Date.now();
        return d;
      }
    }
    throw new Error("The central data store was updated by another administrator at the same time. Please save your change again so it can be merged safely.");
  });
  return SAVE_LOCK.chain;
}

var backupCounter = 0;
function shouldRefreshBackup() {
  backupCounter = (backupCounter + 1) % 25;
  return backupCounter === 1;
}

async function save(d) {
  // EdgeOne Pages Blob storage has no compare-and-swap primitive (no
  // onlyIfMatch/ETag write), so the ETag-based saveAtomic() path cannot be used
  // here. saveLocked() achieves the same safety differently: it serialises
  // writes inside the instance, merges against the latest stored revision, and
  // then reads the record back to confirm that this writer's save is the one
  // that landed, retrying the merge if another instance won the race.
  return saveLocked(d);
}


async function deleteFile(key) {
  if (!key) return;
  try {
    const meta = await store().get(`${key}.meta`, { type: "json" });
    if (meta && Number.isInteger(meta.parts)) {
      for (let i = 0; i < meta.parts; i++) await store().delete(`${key}.part.${i}`).catch(() => {
      });
    }
    await store().delete(`${key}.meta`).catch(() => {
    });
    await store().delete(key).catch(() => {
    });
  } catch {
  }
}
// Read on demand rather than at module load: on EdgeOne the variables arrive on
// the per-request context, which does not exist yet while the module evaluates.
function envAdminEmail() {
  return env("ADMIN_EMAIL").trim();
}
function envAdminUsername() {
  return env("ADMIN_USERNAME").trim();
}
function envAdminPassword() {
  return env("ADMIN_PASSWORD");
}
var DEFAULT_ADMIN_USERNAME = "GiftedBrainzTutorial001";
var DEFAULT_ADMIN_PASSWORD_SALT = "GiftedBrainz-admin-v2";
var DEFAULT_ADMIN_PASSWORD_HASH = "25190f6aabcfa10dc923c5f30557d34809e10bd5218eb923509ebe107de43e0c";
var ADMIN_CREDENTIALS_VERSION = 2;
var secretPromise = null;
// Local-development fallback only. This value is derived from non-secret
// project metadata, so anyone who knows the project id/domain could reproduce
// it and forge a signed token. It is therefore never used for a deployed site:
// see secret() below, which refuses to fall back to it unless the operator has
// explicitly opted into local storage mode.
function derivedSecret() {
  const material = [
    env("EDGEONE_PAGES_PROJECT_ID") || env("EO_PAGES_PROJECT_ID") || "",
    env("EDGEONE_PAGES_PROJECT_NAME") || "",
    env("EDGEONE_PAGES_URL") || env("URL") || "",
    "gifted-brainz-auth-fallback-v1"
  ].join("|");
  return crypto.createHash("sha256").update(material).digest("base64url");
}
function secret() {
  const configured = env("AUTH_SECRET");
  if (configured) return Promise.resolve(configured);
  if (!secretPromise) {
    secretPromise = (async () => {
      // A signing secret must be unpredictable and identical on every instance.
      // Two function instances can cold-start at the same moment, so the secret
      // is created exactly once in shared storage with a conditional write: the
      // instance that wins keeps its value, and every other instance re-reads
      // the winning value instead of inventing a second one (which would make
      // tokens issued by one instance fail on another).
      await backend();
      if (storageReport().persistent) {
        const existing = await store().get("auth-secret", { type: "text" });
        if (existing) return existing;
        const candidate = crypto.randomBytes(32).toString("base64url");
        await store().set("auth-secret", candidate, { onlyIfNew: true }).catch(() => null);
        // Never trust a local "I won the write" belief on its own: some storage
        // backends do not make onlyIfNew perfectly atomic, so two instances could
        // both believe they won and each sign with a different candidate. A final
        // strongly-consistent read makes whatever is actually durable in storage
        // the single source of truth every instance converges on, regardless of
        // which candidate (if any) this particular instance generated.
        const stored = await store().get("auth-secret", { type: "text" });
        if (stored) return stored;
        throw new Error("Could not initialise the authentication secret. Set an AUTH_SECRET environment variable in the EdgeOne Pages project and try again.");
      }
      // Only reachable in local development, where the operator has explicitly
      // enabled the per-instance filesystem store. Never on a deployed site:
      // this fallback is derived from public project metadata, so treating it as
      // a signing key would let anyone mint a valid token.
      if (envFlag("GB_ALLOW_LOCAL_STORE")) return derivedSecret();
      throw new Error("Authentication is not configured: persistent storage is unavailable and no AUTH_SECRET environment variable is set.");
    })();
    // Do not cache a failed initialisation; a later request should retry it.
    secretPromise.catch(() => {
      secretPromise = null;
    });
  }
  return secretPromise;
}
var b64url = (x) => Buffer.from(x).toString("base64url");
async function sign(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", await secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}
async function issue(userId, role, version = 1) {
  return sign({ sub: userId, role, v: version, exp: Math.floor(Date.now() / 1e3) + TOKEN_TTL });
}
async function verifyToken(raw, role) {
  const [body, sig] = String(raw || "").split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", await secret()).update(body).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!p.exp || p.exp < Math.floor(Date.now() / 1e3)) return null;
    if (role && p.role !== role) return null;
    return p;
  } catch {
    return null;
  }
}
function bearer(request) {
  return (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
}
// Download tickets are a separate role, so a ticket can never be replayed
// against any other API route (every other route requires "student"/"admin").
var DOWNLOAD_ROLE = "download";
var DOWNLOAD_COOKIE = "gb_dl";
var DOWNLOAD_TICKET_TTL = 30 * 60;
function cookieValue(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.split("=");
    if (rawKey.trim() === name) return decodeURIComponent(rest.join("=").trim());
  }
  return "";
}
async function issueDownloadTicket(subject, forRole, version) {
  return sign({ sub: subject, role: DOWNLOAD_ROLE, for: forRole, v: version, exp: Math.floor(Date.now() / 1e3) + DOWNLOAD_TICKET_TTL });
}
function downloadCookieHeader(value, maxAge) {
  // HttpOnly keeps the ticket out of page scripts, SameSite=Strict stops it
  // being sent from other sites, and the narrow path means it is only ever
  // attached to file downloads.
  return `${DOWNLOAD_COOKIE}=${encodeURIComponent(value)}; Path=/api/files; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}
/* Authorise a request.
 *
 * A signature/expiry check alone is not enough for student routes: a token
 * stays cryptographically valid for its full 12-hour lifetime, so a student who
 * was suspended, rejected, deleted, or had their password reset would otherwise
 * keep full access until it expired. Student tokens therefore also have to
 * match the account's current state and token version.
 */
var auth = async (request, role, loadedData = null) => {
  const payload = await verifyToken(bearer(request), role);
  if (!payload || role !== "student") return payload;
  // Reuse a request's already-loaded snapshot. Arena writes previously fetched
  // the multi-megabyte data record in bootstrap, auth AND the route itself.
  let d = loadedData;
  if (!d) {
    try { d = await load(); } catch { return null; }
  }
  return studentTokenValid(d, payload) ? payload : null;
};
function studentTokenValid(d, payload) {
  if (!payload) return false;
  const user = d?.users?.find((u) => u.id === payload.sub);
  if (!isRankedStudent(user)) return false;
  return Number(payload.v || 1) === Number(user.tokenVersion || 1);
}
// Invalidate every token already issued to this student. Called whenever an
// administrator changes the account in a way that must end existing sessions.
function revokeStudentTokens(user) {
  if (!user) return;
  user.tokenVersion = Number(user.tokenVersion || 1) + 1;
}
// Registration reserves the normalised username and email so two simultaneous
// sign-ups cannot claim the same identity. Those reservations must be released
// when the account is deleted, otherwise the details could never be reused.
async function releaseUserUniqueKeys(user) {
  if (!user) return;
  const keys = [];
  if (user.username) keys.push(`unique/username/${encodeURIComponent(String(user.username).toLowerCase())}`);
  if (user.email) keys.push(`unique/email/${encodeURIComponent(String(user.email).toLowerCase())}`);
  for (const key of keys) {
    try {
      const claim = await store().get(key, { type: "json" });
      // Only clear a reservation that still belongs to the removed account.
      if (!claim || claim.userId === user.id) await store().delete(key);
    } catch {
    }
  }
}
async function adminAuth(request, d) {
  const p = await verifyToken(bearer(request), "admin");
  if (!p) return null;
  if ((p.v || 1) !== (d.settings.tokenVersion || 1)) return null;
  return p;
}
function passwordHash(password, salt = crypto.randomBytes(16).toString("hex")) {
  return { salt, hash: crypto.scryptSync(String(password), salt, 32).toString("hex") };
}
function hashMatches(password, salt, expected) {
  if (!salt || !expected) return false;
  const h = crypto.scryptSync(String(password), salt, 32).toString("hex");
  const a = Buffer.from(h), b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
function verifyPassword(password, u) {
  if (!u.passwordHash) return false;
  return hashMatches(password, u.passwordSalt || "gifted-brainz-salt", u.passwordHash);
}
function constantEquals(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}
function adminEmail(d) {
  return (d.settings.adminEmail || envAdminEmail()).trim();
}
function adminUsername(d) {
  return String(d.settings.adminUsername || envAdminUsername() || DEFAULT_ADMIN_USERNAME).trim();
}
function adminConfigured(d) {
  return !!adminUsername(d) && (!!d.settings.adminPasswordHash || !!envAdminPassword() || !!DEFAULT_ADMIN_PASSWORD_HASH);
}
function adminPasswordOk(d, password) {
  if (d.settings.adminPasswordHash) {
    return hashMatches(password, d.settings.adminPasswordSalt, d.settings.adminPasswordHash);
  }
  const envPassword = envAdminPassword();
  if (envPassword) return constantEquals(password, envPassword);
  return hashMatches(password, DEFAULT_ADMIN_PASSWORD_SALT, DEFAULT_ADMIN_PASSWORD_HASH);
}
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      ...extra
    }
  });
}
/* ------------------------------------------------------------------
   Request body reading.

   EdgeOne Pages Node Functions do not always expose a spec-complete Request:
   depending on how the gateway forwards a call, `request.json()` can reject
   even though the client sent perfectly valid JSON (the body may arrive as an
   already-parsed object, as text, or as raw bytes, and the stream can only be
   consumed once). The old helper called `request.json()` and relabelled every
   failure as "Invalid JSON.", which is what made material uploads and question
   bank practice fail with a server error on a body that was never malformed.

   readRawBody() tries each shape in turn and caches the result per request, so
   no route can double-consume the stream.
------------------------------------------------------------------- */
var bodyCache = /* @__PURE__ */ new WeakMap();

function preParsedBody(request) {
  for (const key of ["parsedBody", "bodyJson", "jsonBody", "_body", "body"]) {
    const value = request?.[key];
    if (value && typeof value === "object" && !ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer) && typeof value.getReader !== "function")
      return value;
  }
  return null;
}

async function readRawBody(request) {
  if (bodyCache.has(request)) return bodyCache.get(request);
  let bytes = Buffer.alloc(0);
  const attempts = [
    async () => {
      if (typeof request.arrayBuffer !== "function") return null;
      return Buffer.from(await request.arrayBuffer());
    },
    async () => {
      if (typeof request.text !== "function") return null;
      return Buffer.from(await request.text(), "utf8");
    },
    async () => {
      const b = request?.body;
      if (!b || typeof b.getReader !== "function") return null;
      const reader = b.getReader();
      const chunks = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks);
    }
  ];
  for (const attempt of attempts) {
    try {
      const result = await attempt();
      if (result && result.length) { bytes = result; break; }
      if (result && !bytes.length) bytes = result;
    } catch {
      // Try the next shape: a rejected reader here does not mean bad input.
    }
  }
  bodyCache.set(request, bytes);
  return bytes;
}

function stripBom(text) {
  return text.charCodeAt(0) === 65279 ? text.slice(1) : text;
}

async function readJSON(request) {
  const preParsed = preParsedBody(request);
  if (preParsed) return preParsed;

  const bytes = await readRawBody(request);
  const text = stripBom(bytes.toString("utf8")).trim();
  // An empty body on a POST that only carries headers is not an error; the
  // route's own validation decides whether the missing fields matter.
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : { value: parsed };
  } catch (error) {
    const err = new Error(
      `The request body was not valid JSON (content-type "${request.headers?.get?.("content-type") || "unknown"}", ${bytes.length} bytes). ${error.message}`
    );
    err.badRequest = true;
    throw err;
  }
}
var publicUser = (u) => ({ id: u.id, name: u.name, username: u.username, email: u.email, whatsapp: u.whatsapp || "", status: u.status || "active", approval: u.approval || "approved", approved: (u.approval || "approved") === "approved", accountType: ["free", "activated"].includes(u.accountType) ? u.accountType : "free", avatar:validAvatar(u.avatar), selectedSubjects: studentSubjects(u) });
var cleanString = (v, max = 5e3) => String(v ?? "").trim().slice(0, max);
var ALLOWED_TAGS = /* @__PURE__ */ new Set([
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "strike",
  "br",
  "p",
  "div",
  "span",
  "ul",
  "ol",
  "li",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "sup",
  "sub",
  "code",
  "pre",
  "a",
  "img",
  "video",
  "audio"
]);
var SELF_CLOSING = /* @__PURE__ */ new Set(["br", "img"]);
function sanitizeHtml(input, max = 4e4) {
  const raw = String(input ?? "").slice(0, max);
  let out = "";
  let i = 0;
  const open = [];
  while (i < raw.length) {
    const lt = raw.indexOf("<", i);
    if (lt === -1) {
      out += escapeText(raw.slice(i));
      break;
    }
    out += escapeText(raw.slice(i, lt));
    const gt = raw.indexOf(">", lt);
    if (gt === -1) {
      out += escapeText(raw.slice(lt));
      break;
    }
    const tag = raw.slice(lt + 1, gt);
    i = gt + 1;
    if (/^!--/.test(tag)) continue;
    const closing = tag.startsWith("/");
    const name = (closing ? tag.slice(1) : tag).trim().split(/[\s/>]/)[0].toLowerCase();
    if (!ALLOWED_TAGS.has(name)) {
      if (!closing && /^(script|style|iframe|object|embed)$/.test(name)) {
        const end = raw.toLowerCase().indexOf(`</${name}`, i);
        i = end === -1 ? raw.length : raw.indexOf(">", end) + 1 || raw.length;
      }
      continue;
    }
    if (closing) {
      const idx = open.lastIndexOf(name);
      if (idx === -1) continue;
      while (open.length > idx) out += `</${open.pop()}>`;
      continue;
    }
    if (SELF_CLOSING.has(name)) {
      out += `<${name}>`;
      continue;
    }
    out += `<${name}${safeAttributes(name, tag)}>`;
    open.push(name);
  }
  while (open.length) out += `</${open.pop()}>`;
  return out;
}
function escapeText(t) {
  return String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}
function safeAttributes(name, tag) {
  if (name === "a") {
    const m = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const href = (m && (m[2] ?? m[3] ?? m[4]) || "").trim();
    const url = safeUrl(href);
    if (!url) return "";
    return ` href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer nofollow"`;
  }
  if (["img", "video", "audio"].includes(name)) {
    const key = /data-gb-file\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const fileKey = (key && (key[2] ?? key[3] ?? key[4]) || "").trim();
    if (!/^[a-zA-Z0-9._:-]{1,220}$/.test(fileKey)) return "";
    const alt = /alt\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const title = /title\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const label = (alt && (alt[2] ?? alt[3] ?? alt[4]) || "").slice(0, 300);
    const ttl = (title && (title[2] ?? title[3] ?? title[4]) || "").slice(0, 300);
    const playback = name === "video" ? ' controls playsinline preload="metadata"' : name === "audio" ? ' controls preload="metadata"' : ' loading="lazy"';
    return ` data-gb-file="${escapeAttr(fileKey)}"${label ? ` alt="${escapeAttr(label)}"` : ""}${ttl ? ` title="${escapeAttr(ttl)}"` : ""}${playback}`;
  }
  return "";
}

function escapeAttr(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function safeUrl(href) {
  const v = String(href || "").trim();
  if (!v) return "";
  if (/^(https?:\/\/|mailto:|tel:)/i.test(v)) return v.slice(0, 2e3);
  if (/^(\/|#)/.test(v)) return v.slice(0, 2e3);
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(v)) return "https://" + v.slice(0, 2e3);
  return "";
}
function linkifyHtml(html) {
  return html.replace(
    /(<a\b[^>]*>.*?<\/a>)|((?:https?:\/\/|www\.)[^\s<>"']+)/gi,
    (whole, anchor, url) => {
      if (anchor) return anchor;
      const clean = url.replace(/[).,;:!?]+$/, "");
      const trailing = url.slice(clean.length);
      const href = /^www\./i.test(clean) ? "https://" + clean : clean;
      return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer nofollow">${escapeText(clean)}</a>${escapeText(trailing)}`;
    }
  );
}
function richBody(value, max = 4e4) {
  return linkifyHtml(sanitizeHtml(value, max));
}
function plainToRichParagraphs(value, max = 2e4) {
  const text = String(value ?? "").slice(0, max);
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paras = esc.split(/\n{2,}/).map((p) => p.split("\n").join("<br>")).filter((p) => p.trim().length);
  return paras.map((p) => `<p>${p}</p>`).join("");
}
function stripHtml(value) {
  return String(value ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/\s+/g, " ").trim();
}
function shuffleCopy(list) {
  const a = Array.isArray(list) ? list.slice() : [];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function romanNumeralStructure(q) {
  const text = stripHtml(q?.q || "");
  const order = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12, XIII: 13, XIV: 14, XV: 15, XVI: 16, XVII: 17, XVIII: 18, XIX: 19, XX: 20 };
  const marks = [...text.matchAll(/\b(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI|XVII|XVIII|XIX|XX)[.)]\s+/g)];
  if (marks.length < 2 || marks[0][1] !== "I") return false;
  const stemBeforeList = text.slice(0, marks[0].index).trim();
  if (stemBeforeList && !/:\s*$/.test(stemBeforeList) && !/\b(?:following|statements?|combination|correct|true|false|choose|select|which|identify|consider|below|items|answer|given|list|valid|all)\b/i.test(stemBeforeList)) return false;
  let previous = order.I, consecutive = 1;
  for (let i = 1; i < marks.length; i++) {
    const next = order[marks[i][1]];
    if (next !== previous + 1) break;
    consecutive++; previous = next;
  }
  return consecutive >= 2;
}
// Questions used to be locked to exactly four or five options. Several
// subjects set questions with more choices than that, so the option count is
// now flexible between MIN_OPTIONS and MAX_OPTIONS (A, B, C... up to the
// MAX_OPTIONS-th letter) rather than a fixed four-option shape.
var MIN_OPTIONS = 2;
var MAX_OPTIONS = 8;
var OPTION_LETTERS = "ABCDEFGH";
function validQuestion(q) {
  const text = stripHtml(q?.q || "");
  const options = Array.isArray(q?.options) ? q.options : [];
  return !!text && options.length >= MIN_OPTIONS && options.length <= MAX_OPTIONS && options.every(o => stripHtml(o || "").length > 0) && Number.isInteger(Number(q?.answer)) && Number(q.answer) >= 0 && Number(q.answer) < options.length;
}
function questionMarks(q) {
  const n = Number(q?.marks);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
function validateQuestionForSubject(q, subject) {
  if (!validQuestion(q)) return `Question text, between ${MIN_OPTIONS} and ${MAX_OPTIONS} non-empty options and a valid correct answer are required.`;
  if (q?.marks !== undefined && (!Number.isFinite(Number(q.marks)) || Number(q.marks) <= 0)) return "Each CBT question must carry a positive marks value.";
  if (q.roman && !romanNumeralStructure(q)) return "A Roman-numeral question must contain at least two consecutive statements, beginning with I.";
  if (q.passageId && !stripHtml(q.passage || "").length) return "Every passage question must include its shared passage text.";
  return "";
}
function questionKey(q) {
  return stripHtml(q?.q || "").replace(/\s+/g, " ").trim().toLowerCase();
}
function questionImageKeys(q) {
  const keys = [...(Array.isArray(q?.images) ? q.images : []), ...(q?.image ? [q.image] : [])]
    .map(x => String(x?.key || x?.fileKey || "")).filter(Boolean);
  return [...new Set(keys)];
}
function validateQuestionSet(questions, subject) {
  if (!Array.isArray(questions) || !questions.length) return "A CBT must contain at least one question.";
  for (const q of questions) {
    const error = validateQuestionForSubject(q, subject);
    if (error) return error;
  }
  return "";
}

function studentSubjects(user) {
  const selected = [...new Set((Array.isArray(user?.selectedSubjects)?user.selectedSubjects:[]).filter(v=>typeof v==="string"&&v.length<=80))];
  return selected.length ? selected : [REQUIRED_REGISTRATION_SUBJECT];
}
function isActivatedAccount(user) { return String(user?.accountType || "free") === "activated"; }
function canAccessLevel(user, accessLevel) { return accessLevel !== "restricted" || isActivatedAccount(user); }
// Library spaces are server-enforced. Public browsing must never enumerate premium resources.
// An activated student may explicitly open the premium space; a Free student cannot.
function spaceAccessLevel(url, user) {
  const requested = String(url.searchParams.get("space") || "public").toLowerCase();
  if (requested === "premium") return isActivatedAccount(user) ? "restricted" : null;
  return "public";
}
function matchesSpace(resource, space) {
  return (resource?.accessLevel === "restricted" ? "restricted" : "public") === space;
}

// The following metadata projection protects direct legacy lookups. Student
// catalogue endpoints additionally filter out premium records altogether.
function materialCatalogueItem(note, user) {
  const locked = !canAccessLevel(user, note.accessLevel);
  if (!locked) return { ...note, locked: false };
  return {
    id: note.id, subject: note.subject, title: note.title,
    topic: note.topic, topicId:note.topicId||"", topicName:note.topicName||"",
    summary: note.summary || "", accessLevel: "restricted", locked: true,
    createdAt: note.createdAt, updatedAt: note.updatedAt,
    // Only publish the count, not the filenames or attachment keys.
    attachmentCount: (note.attachments || []).length
  };
}

function assertSubjectAllowed(user, subject) {
  const clean = cleanString(subject || "", 80);
  const allowed = studentSubjects(user);
  if (!allowed.includes(clean)) return { ok: false, status: 403, error: `You are not registered for ${clean}.` };
  if (!allowed.includes(clean)) return { ok: false, status: 403, error: `You are not registered for ${clean}.` };
  return { ok: true, subject: clean, subjects: allowed };
}
function assertUserSubject(user, subject) {
  const result = assertSubjectAllowed(user, subject);
  return result.ok ? null : json({ error: result.error }, result.status);
}
function normaliseQuestion(q) {
  const passage = q.passage ? richBody(q.passage, 12e3) : "";
  const options = Array.isArray(q.options) ? q.options.slice(0, MAX_OPTIONS).map((o) => richBody(o, 1e3)) : [];
  const imageInputs = [...(Array.isArray(q.images) ? q.images : []), ...(q.image ? [q.image] : [])]
    .filter(f => f && (f.key || f.fileKey));
  const seenImageKeys = new Set();
  const images = normaliseAttachments(imageInputs).filter(f => { if (seenImageKeys.has(f.key)) return false; seenImageKeys.add(f.key); return true; }).slice(0, 8);
  const legacyImage = q.image && (q.image.key || q.image.fileKey) ? normaliseAttachments([q.image])[0] : null;
  const image = legacyImage || images[0] || null;
  return {
    id: cleanString(q.id, 100) || crypto.randomUUID(),
    type: q.type === "passage" ? "passage" : "mcq",
    subject: cleanString(q.subject, 80),
    topicId: cleanString(q.topicId, 100),
    topic: cleanString(q.topic, 200),
    passageId: cleanString(q.passageId, 120),
    passage,
    q: richBody(q.q, 6e3),
    options,
    answer: Number(q.answer),
    explanation: richBody(q.explanation || "", 4e3),
    image,
    ...(images.length ? { images } : {}),
    source: cleanString(q.source, 500),
    needsReview: !!q.needsReview,
    roman: !!q.roman,
    marks: questionMarks(q),
    createdAt: q.createdAt || (/* @__PURE__ */ new Date()).toISOString()
  };
}
function publicQuestion(q, includeAnswer = false) {
  const inputs = [...(Array.isArray(q.images) ? q.images : []), ...(q.image ? [q.image] : [])].filter(f => f && (f.key || f.fileKey || f.url));
  const seen = new Set();
  const images = inputs.map(f => f.key || f.fileKey ? normaliseAttachments([f])[0] : f).filter(f => { const k = String(f?.key || f?.url || ""); if (!k || seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);
  const image = (q.image && (q.image.key || q.image.fileKey) ? normaliseAttachments([q.image])[0] : q.image) || images[0] || null;
  const out = { id: q.id, type: q.type || "mcq", passageId: q.passageId || "", passage: q.passage || "", q: q.q, options: q.options, image, images: images.length ? images : (image ? [image] : []), marks: questionMarks(q) };
  if (includeAnswer) {
    out.answer = Number(q.answer);
    out.explanation = q.explanation || "";
  }
  if (q.roman) out.roman = true;
  return out;
}
function buildReviewFromPresented(items, answers) {
  return items.map((item, i) => {
    const chosen = Number.isInteger(answers?.[i]) ? answers[i] : null;
    const q = item.q;
    const answer = Number.isInteger(item.answerIndex) ? item.answerIndex : Number(q.answer);
    return { number: i + 1, q: q.q, passage: q.passage || "", image: q.image || (Array.isArray(q.images) ? q.images[0] : null) || null, images: Array.isArray(q.images) ? q.images : (q.image ? [q.image] : []), options: q.options, answer, chosen, correct: chosen === answer, explanation: q.explanation || "" };
  });
}
function unzipEntries(buffer) {
  const b = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (b.readUInt32LE(i) === 101010256) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("The document archive could not be read.");
  const count = b.readUInt16LE(eocd + 10), cdSize = b.readUInt32LE(eocd + 12), cdOffset = b.readUInt32LE(eocd + 16);
  const out = {};
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (b.readUInt32LE(p) !== 33639248) break;
    const method = b.readUInt16LE(p + 10), csize = b.readUInt32LE(p + 20), usize = b.readUInt32LE(p + 24), nameLen = b.readUInt16LE(p + 28), extraLen = b.readUInt16LE(p + 30), commentLen = b.readUInt16LE(p + 32), off = b.readUInt32LE(p + 42);
    const name = b.slice(p + 46, p + 46 + nameLen).toString("utf8");
    const localNameLen = b.readUInt16LE(off + 26), localExtraLen = b.readUInt16LE(off + 28), start = off + 30 + localNameLen + localExtraLen;
    const raw = b.slice(start, start + csize);
    let data = raw;
    if (method === 8) {
      data = zlib.inflateRawSync(raw, { maxOutputLength: 16 * 1024 * 1024 });
    } else if (method !== 0) throw new Error("This Word document uses an unsupported compression method.");
    if (data.length > 16 * 1024 * 1024) throw new Error("The Word document is too large to extract safely.");
    if (usize && data.length !== usize) throw new Error("The document archive is incomplete.");
    out[name] = data;
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
function decodeTextEntities(value) {
  // Decode HTML/numeric entities repeatedly because imported documents may
  // contain double-encoded entities such as &amp;gt; or &amp;amp;.  Stop when a
  // pass makes no further change so we never loop indefinitely.
  let out = String(value ?? "");
  for (let pass = 0; pass < 4; pass++) {
    const next = out
      .replace(/&nbsp;|&#160;|&#xA0;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return _; } })
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return _; } })
      .replace(/\u00a0/g, " ");
    if (next === out) break;
    out = next;
  }
  return out;
}
function compactImportedText(value) {
  return normaliseImportedMathMarkup(String(value ?? ""))
    .replace(/\s+/g, " ")
    .replace(/\s*<br\s*\/?>\s*/gi, "<br>")
    .replace(/\s+(?=<\/?(?:sup|sub)>)/gi, "")
    .replace(/(?<=<\/(?:sup|sub)>)\s+/gi, " ")
    .trim();
}

function cleanImportedQuestionText(value, opts = {}) {
  let out = decodeTextEntities(value);
  const kind = String(opts.kind || "content");

  // Remove publisher/document artefacts that frequently leak out of PDFs/Word files.
  out = out
    .replace(/(?:https?:\/\/|www\.)\S+/gi, " ")
    .replace(/^\s*(?:download\s+.*|www\.[^\n]*)$/gim, " ")
    .replace(/\b(?:jamb\s+past\s+questions?|jamb|(?:biology|chemistry|physics|mathematics|use\s+of\s+english))\s+\d{4}\b/gi, " ")
    .replace(/^\s*\d{1,3}\s*\/\s*\d{1,3}\s*$/gm, " ")
    .replace(/^\s*(?:page|pg\.)\s*\d{1,4}\s*$/gim, " ")
    .replace(/^\s*(?:fig(?:ure)?\s*\.?\s*\d{1,3}|fig\.)\s*$/gim, " ");

  // “Fig. 2”, “Figure 2”, etc. are usually source labels rather than part of
  // the question. Preserve the semantic reference without leaking the label.
  // In passages, keep the wording natural; elsewhere remove the label.
  out = out.replace(/\b(?:fig(?:ure)?\s*\.?\s*\d{1,3})\b/gi, kind === "passage" ? "the diagram" : "");
  out = out.replace(/\b(?:see|refer\s+to|study)\s+(?:the\s+)?(?:fig(?:ure)?\s*\.?\s*\d{1,3})\b/gi, "$1 the diagram");
  out = out.replace(/\s*\(\s*(?:fig(?:ure)?\s*\.?\s*\d{1,3})\s*\)\s*/gi, " ");

  // Remove repeated source instructions already represented by the structured
  // passage/group fields.
  out = out
    .replace(/^\s*(?:use|study|refer\s+to|read|consider)\s+(?:this|the|fig(?:ure)?\.?)?.{0,220}?\bquestions?\s+\d{1,3}\s*(?:to|[-–—])\s*\d{1,3}[^\n]*$/gim, " ")
    .replace(/^\s*(?:question|questions)\s+\d{1,3}\s*(?:to|[-–—])\s*\d{1,3}\s*(?:are|is)?\s*(?:based\s+on|from)\s*(?:the)?\s*$/gim, " ");

  // Normalize stray OCR punctuation/spacing without touching mathematical
  // operators such as > when they are genuine content.
  out = out
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return out;
}

function xmlToText(xml) {
  return decodeTextEntities(
    String(xml)
      .replace(/<w:tab[^>]*\/>/g, "\t")
      .replace(/<w:br[^>]*\/>/g, "\n")
      .replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (m) => m.replace(/<[^>]+>/g, " ") + "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function xmlToTextWithImages(xml, imageByRid) {
  const source = String(xml);
  const paragraphs = [...source.matchAll(/<w:p\b[\s\S]*?<\/w:p>/gi)].map(m => m[0]);
  const rendered = paragraphs.map((pXml) => {
    let p = pXml;
    // Word's equation editor stores formulas as Office Math Markup Language (OMML),
    // not ordinary w:t text runs. Convert equation structures to loss-minimising
    // LaTeX before the general run parser strips the surrounding XML.
    p = p.replace(/<m:oMathPara\b[\s\S]*?<\/m:oMathPara>/gi, m => ` \\(${ommlToLatex(m)}\\) `);
    p = p.replace(/<m:oMath\b[\s\S]*?<\/m:oMath>/gi, m => ` \\(${ommlToLatex(m)}\\) `);
    // Also handle documents using a namespace prefix other than the usual "m".
    p = p.replace(/<([A-Za-z_][\w.-]*):oMathPara\b[\s\S]*?<\/\1:oMathPara>/gi, m => ` \\(${ommlToLatex(m)}\\) `);
    p = p.replace(/<([A-Za-z_][\w.-]*):oMath\b[\s\S]*?<\/\1:oMath>/gi, m => ` \\(${ommlToLatex(m)}\\) `);
    // Replace drawings with their image markers first so they survive run parsing.
    p = p.replace(/<w:drawing[\s\S]*?<\/w:drawing>/gi, (m) => {
      const rid = /r:embed\s*=\s*["']([^"']+)["']/i.exec(m)?.[1] || /r:id\s*=\s*["']([^"']+)["']/i.exec(m)?.[1] || "";
      return rid && imageByRid.has(rid) ? ` [[GBIMG:${rid}]] ` : " ";
    }).replace(/<w:pict[\s\S]*?<\/w:pict>/gi, (m) => {
      const rid = /r:id\s*=\s*["']([^"']+)["']/i.exec(m)?.[1] || "";
      return rid && imageByRid.has(rid) ? ` [[GBIMG:${rid}]] ` : " ";
    });
    // Convert each Word run into text while preserving actual superscript/subscript.
    p = p.replace(/<w:r\b[\s\S]*?<\/w:r>/gi, (runXml) => {
      const text = [...runXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi)].map(m => m[1]).join("")
        + [...runXml.matchAll(/<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>/gi)].map(m => m[1]).join("");
      const breaks = (runXml.match(/<w:br\b[^>]*\/>/gi) || []).length;
      const tabs = (runXml.match(/<w:tab\b[^>]*\/>/gi) || []).length;
      if (!text && !breaks && !tabs) return "";
      const val = text + "\n".repeat(breaks) + "\t".repeat(tabs);
      const vert = /<w:vertAlign\b[^>]*w:val\s*=\s*["'](superscript|subscript)["']/i.exec(runXml)?.[1]?.toLowerCase();
      if (vert === "superscript") return `<sup>${val}</sup>`;
      if (vert === "subscript") return `<sub>${val}</sub>`;
      return val;
    });
    // Handle any text that sits outside a run, then strip the remaining XML.
    p = p.replace(/<w:tab\b[^>]*\/>/gi, "\t").replace(/<w:br\b[^>]*\/>/gi, "\n").replace(/<[^>]+>/g, "");
    return p;
  }).join("\n");
  return decodeTextEntities(rendered)
    .replace(/\r/g, "")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function relationshipTargetMap(relsXml) {
  const out = new Map();
  for (const m of String(relsXml || "").matchAll(/<Relationship\b[^>]*?Id\s*=\s*["']([^"']+)["'][^>]*?Target\s*=\s*["']([^"']+)["'][^>]*?\/?>(?:<\/Relationship>)?/gi)) {
    const target = String(m[2]).replace(/^\.?\//, "");
    out.set(m[1], target.startsWith("word/") ? target : `word/${target}`);
  }
  return out;
}
function extractDocxParts(buffer) {
  const z = unzipEntries(buffer);
  const doc = z["word/document.xml"];
  if (!doc) throw new Error("No Word document body was found.");
  const rels = relationshipTargetMap(z["word/_rels/document.xml.rels"]?.toString("utf8") || "");
  const assets = new Map();
  const imageByRid = new Map();
  for (const [rid, target] of rels.entries()) {
    if (!/^word\/media\//i.test(target)) continue;
    const data = z[target];
    if (!data || !data.length) continue;
    const fileName = target.split("/").pop() || `image-${assets.size + 1}.bin`;
    const contentType = guessContentType(fileName);
    const marker = `[[GBIMG:${rid}]]`;
    const asset = { marker, rid, fileName, contentType, data: Buffer.from(data) };
    assets.set(marker, asset);
    imageByRid.set(rid, asset);
  }
  const text = xmlToTextWithImages(doc.toString("utf8"), imageByRid);
  return { text, assets };
}

async function extractDocumentParts(buffer, fileName, contentType) {
  const n = String(fileName || "").toLowerCase(), t = String(contentType || "").toLowerCase();
  if (/\.docx$/.test(n) || t.includes("wordprocessingml.document")) return extractDocxParts(buffer);
  if (/\.doc$/.test(n) || t.includes("msword")) return { text: buffer.toString("latin1").replace(/[^\x20-\x7E\r\n\t]/g, " ").replace(/\s+/g, " ").trim(), assets: new Map() };
  if (/\.pdf$/.test(n) || t.includes("application/pdf")) return { text: decodePdfText(buffer), assets: extractPdfImageAssets(buffer) };
  let sourceText = buffer.toString("utf8");
  // HTML exports can embed MathML even when the surrounding document is not a DOCX.
  // Preserve those formula trees as TeX before removing ordinary markup.
  sourceText = sourceText.replace(/<((?:[A-Za-z_][\w.-]*:)?math)\b[\s\S]*?<\/\1>/gi, m => ` \\(${mathmlToLatex(m)}\\) `);
  return {
    text: sourceText.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim(),
    assets: new Map()
  };
}
async function extractDocumentText(buffer, fileName, contentType) {
  return (await extractDocumentParts(buffer, fileName, contentType)).text;
}
function parseExtractedQuestions(text, assets = new Map(), subject = "") {
  const clean = cleanImportedQuestionText(text).replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n");
  const diagnostics = {
    characters: clean.length, numbered: 0, skipped: 0, skippedReasons: [], answerKeyFound: false,
    explanationsFound: 0, moreThanFourOptions: 0, passageGroups: 0, imagesFound: assets.size, imagesAttached: 0,
    comprehensionGroups: 0, clozeGroups: 0, numberingGapsResynced: 0
  };
  const answerMap = new Map();
  const reasonMap = new Map();
  const lines = clean.split(/\n/);
  const lineOffsets = [];
  let cursor = 0;
  for (const line of lines) { lineOffsets.push(cursor); cursor += line.length + 1; }
  // Do not invent a generic instruction for imported groups. When the source contains
  // an instruction, preserve that wording; otherwise leave the shared context unlabelled.
  const extractSourceInstruction = (rawPreamble, kind) => {
    const src = String(rawPreamble || "").replace(/\r/g, "").trim();
    if (!src) return "";
    const patterns = [
      /^\s*(?:read\s+(?:the\s+following\s+)?passage(?:s)?(?:\s+carefully)?[^\n]*?)(?:[.!?]|$)/im,
      /^\s*(?:answer\s+questions?\s+\d{1,3}\s*(?:to|[-–—])\s*\d{1,3}[^\n]*?)(?:[.!?]|$)/im,
      /^\s*(?:for\s+questions?\s+\d{1,3}\s*(?:to|[-–—])\s*\d{1,3}[^\n]*?)(?:[.!?]|$)/im,
      /^\s*(?:use\s+(?:the\s+)?(?:passage|information|diagram|figure|chart|graph|illustration|map|picture)[^\n]*?)(?:[.!?]|$)/im,
      /^\s*(?:read\s+(?:the\s+following\s+)?passage[^\n]*?answer\s+questions?[^\n]*?)(?:[.!?]|$)/im,
      /^\s*(?:the\s+following\s+(?:passage|diagram|figure|chart|graph|table|map)\b[^\n]*?)(?:[.!?]|$)/im,
      /^\s*(?:complete\s+the\s+passage[^\n]*?)(?:[.!?]|$)/im
    ];
    for (const re of patterns) {
      const m = src.match(re);
      if (m && m[0].trim()) return m[0].trim();
    }
    return "";
  };
  const cueKind = (value) => {
    const s = String(value || "");
    if (/\b(?:fig(?:ure)?\.?|diagram|chart|graph|illustration|map|photograph|picture)\b/i.test(s)) return "diagram";
    if (/\b(?:cloze|fill(?:\s+in)?\s+the\s+(?:blank|gap)|gaps?)\b/i.test(s)) return "cloze";
    if (/\b(?:passage|read\s+each|read\s+the\s+following|read\s+the\s+passage|comprehension)\b/i.test(s)) return "passage";
    return "information";
  };
  const isSectionHeader = (line, kind) => {
    const s = String(line || "").trim();
    if (kind === "answers") return /^(?:answer\s*key|answers|correct\s*answers)\s*[:\-]?$/i.test(s);
    return /^(?:reasons|explanations|rationales)\s*[:\-]?$/i.test(s);
  };
  const isPassageHeader = (line) => {
    const s = String(line || "").trim();
    return /^(?:comprehension(?:\s+passage)?|cloze(?:\s+(?:test|passage))?|passage\s+(?:[ivxlcdm]+|\d+)|passage\s+one|passage\s+two|passage\s+three|passage\s+four|passage\s+five)$/i.test(s)
      || /^(?:read\s+(?:the\s+following\s+)?passage|read\s+each\s+passage\s+carefully|read\s+the\s+passage\s+below|the\s+following\s+passage)/i.test(s);
  };
  const isEnglishComprehensionCue = (line) => {
    const s = String(line || "").trim();
    return /^(?:read\s+(?:the\s+following\s+)?passage|read\s+each\s+passage\s+carefully|read\s+the\s+passage\s+below|the\s+following\s+passage|for\s+questions?\s*\d{1,3}\s*(?:to|[-–—])\s*\d{1,3}|answer\s+questions?\s*\d{1,3}\s*(?:to|[-–—])\s*\d{1,3}\s+(?:on|from)\s+the\s+passage)/i.test(s)
      || /\b(?:comprehension|passage)\b/i.test(s) && /^\s*(?:section|part|read|answer|questions?)/i.test(s);
  };
  const findSection = (re) => { const idx = lines.findIndex(line => re.test(String(line || "").trim())); return idx >= 0 ? lines.slice(idx + 1).join("\n") : ""; };
  const answerSection = findSection(/^(?:answer\s*key|answers|correct\s*answers)\s*[:\-]?$/i);
  const reasonSection = findSection(/^(?:reasons|explanations|rationales)\s*[:\-]?$/i);
  if (answerSection) for (const m of answerSection.matchAll(new RegExp(`(?:^|\\n|[\\s,;])([0-9]{1,3})[.)\\-:]?\\s*([A-${OPTION_LETTERS[MAX_OPTIONS - 1]}])\\b`, "gi"))) answerMap.set(Number(m[1]), OPTION_LETTERS.indexOf(m[2].toUpperCase()));
  if (reasonSection) {
    const rl = reasonSection.split(/\n/); let current = null, buffer = [];
    const flush = () => { if (current !== null) { const r = buffer.join(" ").trim(); if (r) reasonMap.set(current, r); } buffer = []; };
    for (const line of rl) { const m = /^\s*(\d{1,3})[.)\-:]\s*(.*)$/.exec(line); if (m) { flush(); current = Number(m[1]); if (m[2]) buffer.push(m[2]); } else if (current !== null && line.trim()) buffer.push(line.trim()); }
    flush();
  }
  diagnostics.answerKeyFound = answerMap.size > 0;
  let questionText = clean;
  const sectionIndex = lines.findIndex(line => isSectionHeader(line, "answers") || isSectionHeader(line, "reasons"));
  if (sectionIndex >= 0) questionText = lines.slice(0, sectionIndex).join("\n").trim();
  // English comprehension questions are often embedded in long unnumbered prose passages.
  // Only accept question numbers that start a new line. This prevents dates, percentages,
  // years, list numbers, and other numerals inside a passage from being mistaken for questions.
  const starts = [...questionText.matchAll(/(?:^|\n)[ \t]*(?:Question\s*|Q\.?\s*|No\.?\s*)?\(?(\d{1,3})\)?[.)\-:\]](?=\s)/gi)];
  const candidates = [];
  let expected = 1, lastAccepted = 0;
  // A single extraction hiccup (a merged or dropped number, a stray OCR glyph)
  // used to break the whole chain: once "n" stopped matching "expected" exactly,
  // every later question was silently dropped too, since expected never moved
  // again. Tolerate a small forward gap (a handful of skipped numbers) and
  // resynchronise instead, so one bad number only costs that one question.
  const MAX_FORWARD_GAP = 4;
  for (let i = 0; i < starts.length; i++) {
    const m = starts[i], n = Number(m[1]);
    const index = m.index + (m[0].length - m[0].trimStart().length);
    const preceding = questionText.slice(Math.max(0, index - 220), index);
    const reset = n === 1 && (expected !== 1) && /(?:passage|comprehension|read the following|read each passage|read the passage below|section\s*\d*)/i.test(preceding);
    const resynced = !reset && lastAccepted > 0 && n > lastAccepted && n <= lastAccepted + MAX_FORWARD_GAP;
    if (n === expected || (expected === 1 && n > 0) || reset || resynced) {
      if (resynced) diagnostics.numberingGapsResynced += n - lastAccepted - 1;
      candidates.push({ m, n, index });
      expected = n + 1;
      lastAccepted = n;
    }
  }
  const passageHeaderOffsets = [];
  for (const h of lines.map((line, i) => ({ line: String(line || "").trim(), i }))) {
    if (isPassageHeader(h.line)) passageHeaderOffsets.push(lineOffsets[h.i]);
  }
  const chunks = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const nextQuestion = i + 1 < candidates.length ? candidates[i + 1].index : questionText.length;
    const nextHeader = passageHeaderOffsets.find(pos => pos > c.index && pos < nextQuestion);
    const end = nextHeader ?? nextQuestion;
    const chunk = questionText.slice(c.index, end).trim(); if (chunk.length > 10) chunks.push({ text: chunk, number: c.n, start: c.index, end });
  }
  diagnostics.numbered = chunks.length;
  const qStarts = new Map(chunks.map(c => [c.number, c.start]));
  const groupDefs = [];
  const makeGroup = (from, to, rawPreamble, kind, markers = []) => {
    if (to < from || from == null) return;
    const sourceInstruction = extractSourceInstruction(rawPreamble, kind);
    const prose = String(rawPreamble || "")
      .replace(/^[ \t]*(?:use|study|refer\s+to|read|consider|in\s+questions?)[^\n]*(?:questions?|q(?:uestions?)?\.?)[ \t]*\d{1,3}\s*(?:to|[-–—])[ \t]*\d{1,3}[^\n]*$/gim, "")
      .replace(/^[ \t]*(?:comprehension(?:\s+passage)?|cloze(?:\s+(?:test|passage))?|passage\s+(?:[ivxlcdm]+|\d+)|passage\s+(?:one|two|three|four|five))[ \t]*$/gim, "")
      .replace(/^[ \t]*read each passage carefully and answer the questions that follow it\.?[ \t]*$/gim, "")
      .replace(/^[ \t]*read the (?:following )?passage(?:s)?[^\n]*$/gim, "")
      .replace(/^[ \t]*answer questions?[^\n]*$/gim, "")
      .replace(/^[ \t]*for questions?[^\n]*$/gim, "")
      .replace(/^[ \t]*in questions?\s*\d{1,3}\s*(?:to|[-–—])\s*\d{1,3}[^\n]*$/gim, "")
      .replace(/\[\[GBIMG:[^\]]+\]\]/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    const cleanedProse = prose ? compactImportedText(cleanImportedQuestionText(prose, { kind })) : "";
    const passage = sourceInstruction
      ? (cleanedProse ? `${sourceInstruction}\n\n${cleanedProse}` : sourceInstruction)
      : cleanedProse;
    const id = `AUTO-GROUP-${from}-${to}-${crypto.createHash("sha1").update(`${kind}\n${rawPreamble}`).digest("hex").slice(0, 8)}`;
    groupDefs.push({ id, from, to, passage, kind, markers: markers.filter(x => assets.has(x)) });
  };
  // Detect linked blocks such as “Use Fig. 1 to answer questions 2–4”.
  const groupRe = /(.{0,300}?(?:use|study|refer\s+to|read|consider|in)\b[\s\S]{0,220}?)(?:questions?|q(?:uestions?)?\.?)[ \t]*(\d{1,3})\s*(?:to|[-–—])\s*(\d{1,3})/gi;
  for (const m of questionText.matchAll(groupRe)) {
    const from = Number(m[2]), to = Number(m[3]); if (to <= from) continue;
    const first = qStarts.get(from); if (first === undefined) continue;
    let prevEnd = 0; for (const c of chunks) if (c.number < from) prevEnd = Math.max(prevEnd, c.end);
    const preamble = questionText.slice(prevEnd, first).trim();
    if (!preamble) continue;
    const markers = [...preamble.matchAll(/\[\[GBIMG:[^\]]+\]\]/g)].map(x => x[0]);
    makeGroup(from, to, preamble, cueKind(preamble), markers);
  }
  // Detect standard comprehension/cloze/passage headings even when the source gives no range.
  const headerIndexes = lines.map((line, i) => ({ line: String(line || "").trim(), i })).filter(x => isPassageHeader(x.line));
  for (let h = 0; h < headerIndexes.length; h++) {
    const header = headerIndexes[h];
    const nextHeaderLine = headerIndexes[h + 1]?.i ?? lines.length;
    const startOffset = lineOffsets[header.i];
    const endOffset = nextHeaderLine < lineOffsets.length ? lineOffsets[nextHeaderLine] : questionText.length;
    const block = questionText.slice(startOffset, Math.min(endOffset, questionText.length)).trim();
    const nums = chunks.filter(c => c.start >= startOffset && c.start < Math.min(endOffset, questionText.length)).map(c => c.number);
    if (!nums.length) continue;
    const firstQuestion = Math.min(...nums), lastQuestion = Math.max(...nums);
    const firstChunk = chunks.find(c => c.number === firstQuestion);
    const preamble = firstChunk ? questionText.slice(startOffset, firstChunk.start).trim() : block;
    const markers = [...preamble.matchAll(/\[\[GBIMG:[^\]]+\]\]/g)].map(x => x[0]);
    const kind = /\bcloze\b|fill(?:\s+in)?\s+the\s+(?:blank|gap)/i.test(block) ? "cloze" : "passage";
    makeGroup(firstQuestion, lastQuestion, preamble, kind, markers);
    if (kind === "cloze") diagnostics.clozeGroups += 1; else diagnostics.comprehensionGroups += 1;
  }
  // Detect a passage-style instruction without an explicit range, especially in English.
  const instructionLines = lines.map((line, i) => ({ line: String(line || "").trim(), i }))
    .filter(x => isEnglishComprehensionCue(x.line));
  for (let k = 0; k < instructionLines.length; k++) {
    const item = instructionLines[k];
    const nextLine = instructionLines[k + 1]?.i ?? lines.length;
    const endOffset = nextLine < lineOffsets.length ? lineOffsets[nextLine] : questionText.length;
    const nums = chunks.filter(c => c.start >= lineOffsets[item.i] && c.start < endOffset).map(c => c.number);
    if (!nums.length) continue;
    const firstQuestion = Math.min(...nums), lastQuestion = Math.max(...nums);
    const firstChunk = chunks.find(c => c.number === firstQuestion);
    const block = questionText.slice(lineOffsets[item.i], endOffset).trim();
    const preamble = firstChunk ? questionText.slice(lineOffsets[item.i], firstChunk.start).trim() : block;
    makeGroup(firstQuestion, lastQuestion, preamble, cueKind(block), [...preamble.matchAll(/\[\[GBIMG:[^\]]+\]\]/g)].map(x => x[0]));
  }
  // English fallback: if no explicit "Passage/Comprehension" heading exists, treat the
  // prose immediately preceding a run of numbered questions as the shared passage.
  // This is deliberately conservative: it activates only for English and only when the
  // preamble contains normal prose and no option markers.
  if (/^(?:English|Use\s+of\s+English)\b/i.test(String(subject || "")) && chunks.length && groupDefs.length === 0) {
    const firstChunk = chunks[0];
    const preceding = questionText.slice(0, firstChunk.start).trim();
    if (preceding && preceding.length >= 120 && !new RegExp(`(?:^|\\n)[ \\t]*[A-${OPTION_LETTERS[MAX_OPTIONS - 1]}][.)](?=\\s)`, "i").test(preceding)) {
      const firstNum = chunks[0].number;
      const lastNum = chunks[chunks.length - 1].number;
      const looksLikePassage = /[.!?][ \t]*(?:[A-Z][a-z]|["“])/m.test(preceding) || preceding.split(/\s+/).length >= 45;
      if (looksLikePassage) makeGroup(firstNum, lastNum, preceding, "passage", []);
    }
  }

  // De-duplicate overlapping group definitions, preferring the richer/earlier definition.
  const uniqueGroups = [];
  for (const g of groupDefs) {
    const existing = uniqueGroups.find(x => x.from === g.from && x.to === g.to);
    if (!existing || g.passage.length > existing.passage.length) {
      if (existing) uniqueGroups.splice(uniqueGroups.indexOf(existing), 1);
      uniqueGroups.push(g);
    }
  }
  // Associate PDF assets in document order with shared groups when the PDF parser cannot retain inline positions.
  const reservedAssetMarkers = new Set();
  if (assets.size) {
    const assetMarkers = [...assets.keys()]; let assetIndex = 0;
    for (const g of uniqueGroups) {
      if (!g.markers.length) {
        while(assetIndex<assetMarkers.length && reservedAssetMarkers.has(assetMarkers[assetIndex]))assetIndex++;
        if(assetIndex<assetMarkers.length)g.markers=[assetMarkers[assetIndex++]];
      }
      for(const marker of g.markers)reservedAssetMarkers.add(marker);
    }
  }
  let looseAssetIndex=0;
  diagnostics.passageGroups = uniqueGroups.length;
  diagnostics.imagesUnassociated = Math.max(0, assets.size - reservedAssetMarkers.size);
  const findGroup = (n) => uniqueGroups
    .filter(g => n >= g.from && n <= g.to)
    .sort((a, b) => (a.to - a.from) - (b.to - b.from))[0] || null;
  const note = (number, reason) => { diagnostics.skipped++; if (diagnostics.skippedReasons.length < 20) diagnostics.skippedReasons.push({ number: number || "?", reason }); };
  const out = [];
  for (const c of chunks) {
    const chunk = c.text, qNumber = c.number;
    const inlineReasonMatch = /(?:^|\n|\s)(?:reason|explanation|rationale)\s*[:\-]\s*([\s\S]+)$/i.exec(chunk);
    let explanation = compactImportedText(cleanImportedQuestionText(inlineReasonMatch?.[1] || reasonMap.get(qNumber) || "")).trim(); if (explanation) diagnostics.explanationsFound++;
    const bodyWithoutReason = inlineReasonMatch ? chunk.slice(0, inlineReasonMatch.index).trim() : chunk;
    const letterClass = `A-${OPTION_LETTERS[MAX_OPTIONS - 1]}`;
    const ans = new RegExp(`\\b(?:answer|ans|correct(?: answer)?)\\s*[:.\\-]?\\s*([${letterClass}])\\b`, "i").exec(bodyWithoutReason);
    const answerLineRe = new RegExp(`^\\s*(?:answer|ans|correct(?: answer)?)\\s*[:.\\-]?\\s*[${letterClass}]\\b[^\\n]*$`, "gim");
    const answerTailRe = new RegExp(`(?:\\n|\\s)(?:answer|ans|correct(?: answer)?)\\s*[:.\\-]?\\s*[${letterClass}]\\b[^\\n]*$`, "i");
    const body = bodyWithoutReason.replace(answerLineRe, "").replace(answerTailRe, "").trim();
    // Options can run from A up to whatever letter the source paper actually
    // uses (some subjects set five, six, even more choices). Every detected
    // option is now kept, up to MAX_OPTIONS, instead of folding anything
    // past D into option D - that used to silently merge two different
    // answer choices into one and could make the stored answer wrong.
    const om = [...body.matchAll(new RegExp(`(?:^|\\n|\\s)([${letterClass}])[.)\\-:](?=\\s)`, "gi"))];
    if (om.length < MIN_OPTIONS) { note(qNumber, `only ${om.length} option marker${om.length === 1 ? "" : "s"} were found (at least ${MIN_OPTIONS} are required)`); continue; }
    if (om.length > MAX_OPTIONS) note(qNumber, `more than ${MAX_OPTIONS} option markers were found; only the first ${MAX_OPTIONS} (A–${OPTION_LETTERS[MAX_OPTIONS - 1]}) were kept`);
    if (om.length > 4) diagnostics.moreThanFourOptions++;
    const limit = Math.min(om.length, MAX_OPTIONS);
    let qText = compactImportedText(cleanImportedQuestionText(body.slice(0, om[0].index).trim().replace(/^(?:Question\s*)?\d{1,3}[.)\-:]\s*/i, "")));
    const markerMatches = [...new Set([...body.matchAll(/\[\[GBIMG:[^\]]+\]\]/g)].map(x => x[0]).filter(x => assets.has(x)))];
    const group = findGroup(qNumber);
    const groupMarkers = [...new Set((group?.markers || []).filter(marker => assets.has(marker)))];
    let imageRefs = markerMatches.length ? markerMatches : groupMarkers;
    let imageRef = imageRefs[0] || null;
    // PDFs often preserve pictures as independent image XObjects without inline
    // text anchors. Best-effort ordered matching keeps diagrams available on
    // later questions too, rather than silently attaching only the first image.
    if (!imageRef && assets.size && !group) {
      // PDF image XObjects are often stored separately from the text stream, so
      // there is no inline image marker to follow. Prefer questions that clearly
      // refer to a figure or visual instead of blindly attaching page artwork to
      // the first questions in the document.
      const visualReference = /\b(?:diagram|figure|fig\.?|graph|chart|map|illustration|photograph|picture|shown\s+(?:above|below|in)|labelled|labeled|structure\s+shown|apparatus|circuit|specimen|organ(?:ism|elle)?|cell\s+shown|ray\s+diagram|experimental\s+setup|drawing\s+above|image\s+below)\b/i.test(bodyWithoutReason);
      if (visualReference) {
        const markers=[...assets.keys()];
        while(looseAssetIndex<markers.length && reservedAssetMarkers.has(markers[looseAssetIndex]))looseAssetIndex++;
        if(looseAssetIndex<markers.length){imageRef=markers[looseAssetIndex++];imageRefs=[imageRef];}
      }
    }
    if (imageRefs.length) { qText = qText.replace(/\[\[GBIMG:[^\]]+\]\]/g, " ").replace(/\s{2,}/g, " ").trim(); diagnostics.imagesAttached += imageRefs.length; }
    const isRoman = romanNumeralStructure({ q: qText });
    const options = [];
    for (let j = 0; j < limit; j++) {
      const st = om[j].index + om[j][0].length; const en = j + 1 < limit ? om[j + 1].index : body.length;
      options.push(compactImportedText(cleanImportedQuestionText(body.slice(st, en).replace(/\[\[GBIMG:[^\]]+\]\]/g, " ").trim())));
    }
    const sourceAnswer = ans ? OPTION_LETTERS.indexOf(ans[1].toUpperCase()) : (answerMap.get(qNumber) ?? -1);
    const answerIndex = sourceAnswer >= 0 && sourceAnswer < options.length ? sourceAnswer : 0;
    if (!qText) { note(qNumber, "the question text was empty"); continue; }
    if (options.some(x => !x)) { note(qNumber, `one of the ${options.length} options came through blank`); continue; }
    explanation = improveImportedExplanation(qText, options, answerIndex, explanation);
     const passage = group?.passage || "";
    const needsReview = sourceAnswer < 0 || sourceAnswer >= options.length;
    const importedType = group?.kind === "cloze" ? "cloze" : group?.kind === "passage" ? "passage" : "mcq";
    out.push({ q: qText, options, answer: answerIndex, explanation, needsReview, roman: isRoman, source: "Imported document", number: qNumber || null, type: importedType, passageId: group?.id || "", passage, imageRef, imageRefs });
  }
  return { questions: out, report: diagnostics, assets };
}


function stripRawHtmlTags(value) {
  return String(value ?? "")
    .replace(/(<\/?(?:sup|sub)>)/gi, "$1")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?(?:p|div|span|strong|em|b|i|u|table|tr|td|th|ol|ul|li)[^>]*>/gi, " ")
    .replace(/\s+/g, " ").trim();
}
function explanationLooksMechanicalOrMeta(value) {
  const s=stripRawHtmlTags(value).toLowerCase();
  if(!s)return true;
  return /(source|printed|displayed expression|source key|retain|reproduced as it appears|source item|typeset|extraction|document|inconsistent|consult the original)/i.test(s)
    || /^(convert|place|write|choose|select)\b/.test(s) && s.length<120;
}
function generatedStudentFriendlyExplanation(question, options, answerIndex) {
  const q=stripRawHtmlTags(question);
  const answer=Array.isArray(options)&&Number.isInteger(answerIndex)?stripRawHtmlTags(options[answerIndex]||""):"";
  const m=q.match(/(?:convert|change|express)\s+(\d+)\s*(?:₁₀|_10)\s+(?:to|into)\s+(?:base\s*)?(\d+)/i);
  if(m){
    const value=Number(m[1]), base=Number(m[2]);
    if(Number.isInteger(value)&&base>=2&&base<=36){
      const parts=[]; let n=value, place=0;
      if(n===0)parts.push("0");
      while(n>0){const rem=n%base;if(rem)parts.unshift(`${rem}×${base}<sup>${place}</sup>`);n=Math.floor(n/base);place++;}
      const result=value.toString(base).toUpperCase();
      return `To convert ${value}<sub>10</sub> to base ${base}, express ${value} as powers of ${base}: ${parts.join(" + ")}. The coefficients of these powers give ${result}<sub>${base}</sub>. Therefore, the correct answer is ${answer ? `<b>${answer}</b>.` : "the option showing this value."}`;
    }
  }
  const bin=q.match(/(?:convert|change|evaluate)\s+([01]{2,})\s*(?:₂|_2)\s*(?:to|into)\s+(?:decimal|base\s*10)/i);
  if(bin){
    const v=bin[1]; let total=0; const terms=[];
    [...v].forEach((digit,i)=>{const p=v.length-1-i;if(digit==="1"){terms.push(`2<sup>${p}</sup>`);total+=2**p;}});
    return `Expand the binary number using powers of 2: ${v}<sub>2</sub> = ${terms.join(" + ")} = ${total}<sub>10</sub>. Therefore, the correct answer is ${answer ? `<b>${answer}</b>.` : "the option with this value."}`;
  }
  return answer
    ? `Apply the rule tested in the question step by step, simplify the result, and compare it with the four options. The result is <b>${answer}</b>.`
    : "Apply the rule tested in the question step by step and compare the result with the four options.";
}
function improveImportedExplanation(question, options, answerIndex, existing) {
  const cleaned=compactImportedText(stripRawHtmlTags(existing));
  return explanationLooksMechanicalOrMeta(cleaned) ? generatedStudentFriendlyExplanation(question,options,answerIndex,cleaned) : cleaned;
}
function extractionReport(report, questions) {
  const needsReview = questions.filter((q) => q.needsReview).length;
  const clean = questions.length - needsReview;
  let quality = "good";
  if (!questions.length) quality = "failed";
  else if (report.skipped > questions.length * 0.25 || needsReview > questions.length * 0.5) quality = "partial";
  else if (report.skipped || needsReview || report.numberingGapsResynced) quality = "fair";
  const bits = [];
  bits.push(`${questions.length} question${questions.length === 1 ? "" : "s"} extracted from ${report.numbered} numbered block${report.numbered === 1 ? "" : "s"}.`);
  bits.push(clean ? `${clean} came through with a confirmed correct answer.` : "None of them carried a confirmed correct answer.");
  if (needsReview) bits.push(`${needsReview} need${needsReview === 1 ? "s" : ""} you to set the correct answer by hand.`);
  if (report.skipped) bits.push(`${report.skipped} block${report.skipped === 1 ? " was" : "s were"} skipped because they did not look like complete multiple-choice questions.`);
  if (report.numberingGapsResynced) bits.push(`The numbering had gaps (about ${report.numberingGapsResynced} question number${report.numberingGapsResynced === 1 ? "" : "s"} skipped in the source); double-check nothing was missed around those points.`);
  bits.push(report.answerKeyFound ? "An answer key was detected in the document." : "No answer key was detected in the document.");
  if (report.explanationsFound) bits.push(`${report.explanationsFound} question${report.explanationsFound === 1 ? " has" : "s have"} an explanation/reason detected and attached.`);
  else bits.push("No explanation/reason was detected in the document.");
  if (report.moreThanFourOptions) bits.push(`${report.moreThanFourOptions} question${report.moreThanFourOptions === 1 ? " was" : "s were"} kept with more than four options.`);
  if (report.comprehensionGroups) bits.push(`${report.comprehensionGroups} comprehension passage group${report.comprehensionGroups === 1 ? " was" : "s were"} detected.`);
  if (report.clozeGroups) bits.push(`${report.clozeGroups} cloze passage group${report.clozeGroups === 1 ? " was" : "s were"} detected.`);
  return {
    quality,
    needsReview,
    clean,
    skipped: report.skipped,
    numbered: report.numbered,
    answerKeyFound: report.answerKeyFound,
    skippedReasons: report.skippedReasons,
    summary: bits.join(" "),
    verdict: quality === "good" ? "Extracted properly \u2705" : quality === "fair" ? "Extracted, with a few items to check \u26A0\uFE0F" : quality === "partial" ? "Only partly extracted \u2014 please review \u26A0\uFE0F" : "Extraction failed \u274C"
  };
}
async function persistImportedImageAssets(questions, assets, sourceTag = "import") {
  const stored = new Map();
  const getStoredMeta = async marker => {
    const asset=assets.get(marker);if(!asset)return null;
    if(stored.has(marker))return stored.get(marker);
    const safeName=String(asset.fileName||"image.png").replace(/[^a-zA-Z0-9._() \-]/g,"_")||"image.png";
    const key=`uploads/import-${Date.now()}-${crypto.randomBytes(8).toString("hex")}-${safeName}`;
    await store().set(key,asset.data);
    await store().setJSON(`${key}.meta`,{fileName:safeName,contentType:asset.contentType||guessContentType(safeName)||"application/octet-stream",size:asset.data.length,importedFrom:sourceTag});
    const meta={key,fileName:safeName,contentType:asset.contentType||guessContentType(safeName)||"application/octet-stream",size:asset.data.length};
    stored.set(marker,meta);return meta;
  };
  for(const q of questions){
    const markers=[...new Set([...(Array.isArray(q.imageRefs)?q.imageRefs:[]),...(q.imageRef?[q.imageRef]:[])])];
    const images=[];
    for(const marker of markers){const meta=await getStoredMeta(marker);if(meta&&!images.some(x=>x.key===meta.key))images.push(meta);}
    if(images.length){q.images=images;q.image=images[0];}
    delete q.imageRef;delete q.imageRefs;
  }
  return questions;
}
async function readStoredFile(key, maxBytes = 15 * 1024 * 1024) {
  const safe = String(key || "");
  if (!/^uploads\/[A-Za-z0-9._()\- ]+$/.test(safe)) throw new Error("Invalid uploaded file.");

  // Object-storage backends can be briefly eventually-consistent immediately
  // after upload completion. Retry the metadata/part reads before declaring
  // the reference unreadable.
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const meta = await store().get(`${safe}.meta`, { type: "json" });
      if (!meta) throw new Error("Uploaded file not found.");
      if (Number(meta.size) > maxBytes) throw new Error("The document is too large to extract. Keep it below 15 MB.");
      if (Number.isInteger(meta.parts)) {
        let bufs = [];
        for (let i = 0; i < meta.parts; i++) {
          const x2 = await store().get(`${safe}.part.${i}`, { type: "arrayBuffer" });
          if (!x2) throw new Error(`The uploaded document is incomplete (chunk ${i + 1} of ${meta.parts} is not yet available).`);
          bufs.push(Buffer.from(x2));
        }
        return Buffer.concat(bufs);
      }
      const x = await store().get(safe, { type: "arrayBuffer" });
      if (!x) throw new Error("Uploaded file not found.");
      return Buffer.from(x);
    } catch (e) {
      lastError = e;
      if (attempt < 3) await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
    }
  }
  throw new Error(lastError?.message || "The uploaded file could not be read. Please upload it again.");
}
async function makePresentedSession(prefix, userId, sourceId, questions, shuffleQuestions = true, shuffleOptions = true, mode = "practice", duration = 0) {
  const groups = [];
  const map = /* @__PURE__ */ new Map();
  for (const q of questions) {
    const key = q.passageId || q.id;
    if (!map.has(key)) {
      const g = { key, items: [] };
      map.set(key, g);
      groups.push(g);
    }
    map.get(key).items.push(q);
  }
  const orderedGroups = shuffleQuestions ? shuffleCopy(groups) : groups;
  const ordered = orderedGroups.flatMap((g) => g.items);
  const presented = [];
  for (const q of ordered) {
    const order = shuffleOptions ? shuffleCopy((Array.isArray(q.options)?q.options:[]).map((_,i)=>i)) : (Array.isArray(q.options)?q.options:[]).map((_,i)=>i);
    const answerIndex = order.indexOf(q.answer);
    const pq = { ...q, options: order.map((i) => q.options[i]), answer: answerIndex };
    presented.push({ q: pq, answerIndex, optionOrder: order });
  }
  const sessionId = crypto.randomUUID();
  const sessionRecord = { id: sessionId, userId, sourceId, mode, duration, created: Date.now(), items: presented.map((x) => ({ id: x.q.id, answerIndex: x.answerIndex, optionOrder: x.optionOrder })) };
  await store().setJSON(`${prefix}-${sessionId}`, sessionRecord);
  // Confirm that a newly created session can be read back before returning it
  // to the student. This prevents a session from looking valid in the browser
  // when the persistence layer has not actually made its record available.
  const confirmed = await getSession(prefix, sessionId, { retries: 3, delayMs: 120 });
  if (!confirmed || confirmed.id !== sessionId || confirmed.userId !== userId || !Array.isArray(confirmed.items) || confirmed.items.length !== presented.length) {
    throw new Error("Your practice session could not be saved securely. Please try starting it again; no answers have been submitted.");
  }
  return { sessionId, presented };
}
async function getSession(prefix, id, options = {}) {
  const safeId = String(id || "").replace(/[^a-zA-Z0-9-]/g, "");
  const key = `${prefix}-${safeId}`;
  const retries = Math.max(0, Math.min(5, Number(options.retries) || 0));
  const delayMs = Math.max(25, Math.min(500, Number(options.delayMs) || 100));
  for (let attempt = 0; attempt <= retries; attempt++) {
    const session = await store().get(key, { type: "json" });
    if (session) return session;
    if (attempt < retries) await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return null;
}
function sessionExpired(session, graceSeconds = 60) {
  if (!session || typeof session !== "object") return true;
  let created = Number(session.created);
  // Legacy records may have an ISO timestamp instead of an epoch number.
  if (!Number.isFinite(created) || created <= 0) created = Date.parse(session.createdAt || session.startedAt || session.created || "");
  // Missing timestamps are treated as unavailable/corrupt by the submit route,
  // not as an elapsed timer on an otherwise valid session.
  if (!Number.isFinite(created) || created <= 0) return true;
  const duration = Number(session.duration) || 0;
  if (duration <= 0) return false;
  return Date.now() > created + duration * 60 * 1e3 + graceSeconds * 1e3;
}
function mediaKind(contentType, fileName) {
  const t = String(contentType || "").toLowerCase();
  const n = String(fileName || "").toLowerCase();
  if (t.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(n)) return "image";
  if (t.startsWith("video/") || /\.(mp4|webm|ogv|mov|m4v)$/.test(n)) return "video";
  if (t.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac)$/.test(n)) return "audio";
  if (t === "application/pdf" || /\.pdf$/.test(n)) return "pdf";
  if (t.startsWith("text/") || /\.(txt|md|csv|json)$/.test(n)) return "text";
  return "file";
}
var EXT_TYPES = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mov: "video/quicktime",
  "3gp": "video/3gpp",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip"
};
function guessContentType(fileName) {
  const ext = String(fileName || "").toLowerCase().split(".").pop();
  return EXT_TYPES[ext] || "";
}
function normaliseAttachments(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 20).filter((f) => f && (f.fileKey || f.key)).map((f) => {
    const key = String(f.fileKey || f.key);
    const fileName = cleanString(f.fileName || f.name, 180) || "file";
    let contentType = cleanString(f.contentType || f.type, 160);
    if (!contentType || contentType === "application/octet-stream") contentType = guessContentType(fileName) || "application/octet-stream";
    return { key, url: "/api/files/" + encodeURIComponent(key), fileName, contentType, kind: mediaKind(contentType, fileName), size: Number(f.size) || 0 };
  });
}
function normalisePath(pathname) {
  // EdgeOne routes /api/* straight to this function, so the incoming path is
  // already the API path. The legacy Netlify function prefix is still stripped
  // so that a cached client or bookmarked URL keeps working after the move.
  let p = pathname.replace(/^\/\.netlify\/functions\/api/, "").replace(/^\/\.edgeone\/functions\/api/, "");
  if (!p.startsWith("/")) p = "/" + p;
  if (!p.startsWith("/api")) p = "/api" + (p === "/" ? "" : p);
  if (p.length > 4 && p.endsWith("/")) p = p.slice(0, -1);
  return p || "/api";
}
// Routing is declared by the function's file path on EdgeOne Pages
// (node-functions/api/[[default]].js), so no exported route config is needed.

// Only active, approved students may hold a valid session token.
function isRankedStudent(u) {
  return !!u && u.status === "active";
}


function topicKey(subject,name){ return `${String(subject||"").trim().toLowerCase()}|${String(name||"").trim().replace(/\s+/g," ").toLowerCase()}`; }
function topicFor(d, topicId, subject=""){ const wanted=String(subject||"").trim().replace(/\s+/g," ").toLowerCase(); return d.topics.find(t => String(t.id)===String(topicId) && (!subject || !t.subject || String(t.subject).trim().replace(/\s+/g," ").toLowerCase()===wanted)); }
function publicTopic(t,d){ return { id:t.id, subject:t.subject, name:t.name, slug:t.slug||"", count:d.questionBank.filter(q=>q.topicId===t.id).length }; }
function eligibleTopicQuestions(d, subject, topicIds){
  const ids=new Set((Array.isArray(topicIds)?topicIds:[]).map(String));
  return d.questionBank.filter(q=>q && q.subject===subject && ["mcq","passage","cloze"].includes(q.type||"mcq") && Array.isArray(q.options) && q.options.length>=MIN_OPTIONS && Number.isInteger(Number(q.answer)) && Number(q.answer)>=0 && Number(q.answer)<q.options.length && ids.has(String(q.topicId||"")));
}
function selectUniqueQuestions(pool,count){
  const seen=new Set(), unique=[];
  for(const q of Array.isArray(pool)?pool:[]){
    const id=String(q?.id||"");
    const key=id||JSON.stringify([q?.q,q?.options]);
    if(seen.has(key)) continue;
    seen.add(key); unique.push(q);
  }
  const copy=shuffleCopy(unique);
  return copy.slice(0, Math.min(Math.max(1, Number(count)||1), copy.length));
}
/* Brainz Battle Arena v12 — authenticated team match rooms.
   Matches are stored in the same persistent collection as the existing app.
   All answer keys, scoring and deadlines remain server-side. */
const BATTLE_FORMATS = {"1v1":[1,1],"1v2":[1,2],"1v3":[1,3],"2v2":[2,2],"2v3":[2,3],"3v3":[3,3]};
const BATTLE_LOGOS = ["lion","eagle","wolf","lightning","fire","shield","dragon","crown","diamond","phoenix","tiger","falcon","owl","rocket","galaxy","star","meteor","titan","knight","compass","atom","mountain","trophy","panther"];
const BATTLE_ROOM_TTL = 15 * 60 * 1000;
const BATTLE_TEAM_IDLE_TTL = 15 * 60 * 1000;
const BATTLE_QUESTION_SECONDS = 30;
const battleNow = () => Date.now();
const battleShort = v => cleanString(v, 100);
const battleMember = (room, id) => ["A","B"].find(side => room.teams[side].members.includes(id));
const battlePublicUser = (d, id) => { const u=d.users.find(x=>x.id===id);return {id,name:cleanString(u?.name||u?.username||"Student",100)}; };
const platformSubjects = d => [...new Set([...SUBJECTS,...(d.battleSubjects||[]).map(v=>v.name), ...["topics","notes","cbtTests","videos","questionBank"].flatMap(k=>(d[k]||[]).map(v=>v.subject))].filter(v=>typeof v==="string"&&v.trim()&&v!=="All subjects"))];

const sharedTopic = (d,subject,topicId) => d.topics.find(t=>t.id===String(topicId||"")&&t.subject===subject&&!/uncategorized|topic not assigned/i.test(t.name));
const battleValidQuestion = q => !!q && typeof q.q === "string" && q.q.trim().length > 2 && Array.isArray(q.options) && q.options.length >= 2 && q.options.length <= 6 && q.options.every(o => String(o||"").trim()) && Number.isInteger(Number(q.answer)) && Number(q.answer)>=0 && Number(q.answer)<q.options.length && !q.needsReview;
function battleQuestionInput(raw, subjects) {
  const q = String(raw.q || raw.question || "").trim();
  const subject = cleanString(raw.subject, 80);
  const topic = cleanString(raw.topic || "General", 150) || "General";
  const options = (Array.isArray(raw.options) ? raw.options : []).map(v=>String(v??"").trim());
  const answer = Number(raw.answer);
  if (!subjects.includes(subject)) throw new Error("Choose a valid Battle Arena subject.");
  if (!q || q.length > 10000 || options.length < 2 || options.length > 6 || options.some(v=>!v||v.length>5000) || !Number.isInteger(answer) || answer<0 || answer>=options.length) throw new Error("A question needs text, 2–6 options and a valid correct-answer index.");
  // Images already extracted by Gifted Brainz arrive with uploaded-file metadata.
  // Keep only keys created by our server; do not trust arbitrary URLs in imports.
  const fromMedia=[...(Array.isArray(raw.images)?raw.images:[]),...(raw.image?[raw.image]:[])];
  const keys=fromMedia.map(x=>String(x?.key||x?.fileKey||""))
    .filter(x=>/^uploads\/[A-Za-z0-9._()\- ]+\.(?:png|jpe?g|webp|gif)$/i.test(x));
  // Preserve verified server-generated diagram keys when editing an imported
  // question. URL-decoding is intentional; user-supplied external image URLs
  // are never permitted in Battle Arena question data.
  for(const ref of [...(Array.isArray(raw.imageRefs)?raw.imageRefs:[]),...(raw.imageRef?[raw.imageRef]:[])]){
    const uri=String(ref||"");if(!uri.startsWith("/api/files/"))continue;
    let key="";try{key=decodeURIComponent(uri.slice("/api/files/".length).split("?")[0]);}catch{continue;}
    if(/^uploads\/[A-Za-z0-9._()\- ]+\.(?:png|jpe?g|webp|gif)$/i.test(key))keys.push(key);
  }
  const refs=[...new Set(keys)].slice(0,8).map(key=>"/api/files/"+encodeURIComponent(key));
  return {q,subject,topic,options,answer,explanation:String(raw.explanation||"").slice(0,5000),passage:String(raw.passage||"").slice(0,8000),imageRef:refs[0]||"",imageRefs:refs,difficulty:["easy","medium","hard"].includes(raw.difficulty)?raw.difficulty:"medium",needsReview:false};
}
function battleSafeRoom(d, room, viewerId, isAdmin=false) {
  const side=battleMember(room,viewerId);
  const team = name => {const x=room.teams[name];return {name:x.name,logo:x.logo,leader:x.leader,members:x.members.map(id=>battlePublicUser(d,id)),ready:x.ready.filter(id=>x.members.includes(id)),capacity:room.sizes[name],pending: (isAdmin || side===name && x.leader===viewerId || !x.leader && side==="A" && room.teams.A.leader===viewerId) ? x.pending.map(id=>battlePublicUser(d,id)) : [],score:x.score};};
  const publicRoom={id:room.id,code:room.code,title:room.title,format:room.format,subject:room.subject,topic:room.topic,difficulty:room.difficulty||"mixed",speedBonus:!!room.speedBonus,questionCount:room.questionCount,status:room.status,createdAt:room.createdAt,expiresAt:room.expiresAt,canRematch:room.status==="finished"&&room.createdBy===viewerId,challengeStatus:room.challengeStatus||"accepted",teams:{A:team("A"),B:team("B")},myTeam:side||null,leader:!!side&&room.teams[side].leader===viewerId,round:room.round||0,total:room.questions.length,deadline:room.deadline||null,serverTime:battleNow(),winner:room.winner||null,history:[]};
  if (side || isAdmin) {
    if(side)publicRoom.chat=(room.messages||[]).filter(x=>x.side===side).slice(-70).map(x=>({id:x.id,studentName:battlePublicUser(d,x.userId).name,text:x.text,createdAt:x.createdAt,mine:x.userId===viewerId}));
    if (room.status==="active" && room.questions[room.round]) {
      const q=room.questions[room.round];
      publicRoom.current={q:q.q,options:q.options,passage:q.passage||"",imageRef:q.imageRef||"",imageRefs:q.imageRefs||[],number:room.round+1};
      publicRoom.myAnswer=room.answers?.[room.round]?.[side]?.answer ?? null;
      publicRoom.suggestions=(room.suggestions?.[room.round]?.[side]||[]).map(v=>({name:battlePublicUser(d,v.userId).name,answer:v.answer}));
    }
    if (room.status==="finished" || isAdmin) publicRoom.history=room.questions.map((q,i)=>({id:q.id,q:q.q,options:q.options,answer:q.answer,explanation:q.explanation||"",passage:q.passage||"",imageRefs:q.imageRefs||[],teamA:room.answers?.[i]?.A||null,teamB:room.answers?.[i]?.B||null}));
  }
  return publicRoom;
}
// After save() merges concurrent writers, the request's old `room` reference
// may not be the final persisted room. Return the confirmed merged state.
const battleConfirmedRoom = (d, room, viewerId) => battleSafeRoom(d, d.battleRooms.find(v=>v.id===room.id)||room, viewerId);
function battleTick(room, now=battleNow()) {
  if (room.status==="waiting" && now>room.expiresAt){room.status="expired";return true;}
  if (room.status!=="active")return false;
  let dirty=false;
  while(room.status==="active" && now>=room.deadline){
    room.round++;
    if (room.round>=room.questions.length) {
      room.status="finished";room.finishedAt=new Date(now).toISOString();
      room.winner=room.teams.A.score===room.teams.B.score?"draw":room.teams.A.score>room.teams.B.score?"A":"B";
      room.deadline=null;
    } else room.deadline+=BATTLE_QUESTION_SECONDS*1000;
    dirty=true;
  }
  return dirty;
}
const battleFailure = (message,status=400) => json({error:message},status);
function battleRoomValidation(d, room, a, membership=true) {
  if (!room) return battleFailure("Match not found.",404);
  if (!d.users.some(u=>u.id===a.sub&&isRankedStudent(u)))return battleFailure("Approved student account required.",403);
  if (membership&&!battleMember(room,a.sub))return battleFailure("You are not a player in this match.",403);
  return null;
}
function battleNameClean(name,fallback) {return cleanString(name||fallback,50).replace(/[<>]/g,"").trim()||fallback;}

// Opportunistic clean-up: no platform cron job is required. Match history is
// retained so completed results, reviews and leaderboards are never deleted.
// Active matches protect both participating teams from inactivity removal.
function battlePruneInactive(d, now=Date.now()){
  let changed=false;
  for(const r of d.battleRooms){
    if(r.status==="waiting" && now>Number(r.expiresAt || (Date.parse(r.createdAt)||now)+BATTLE_ROOM_TTL)){
      r.status="expired";r.challengeStatus="expired";r.expiredAt=new Date(now).toISOString();changed=true;
    }
  }
  const busy=new Set(d.battleRooms.filter(r=>r.status==="active").flatMap(r=>[r.sourceTeamId,r.challengedTeamId]).filter(Boolean));
  const retained=d.battleTeams.filter(t=>{
    const last=Number(t.lastActivityAt)||Date.parse(t.createdAt)||0;
    const hasLeader=t.members?.includes(t.leader);
    return busy.has(t.id) || (hasLeader && last && now-last<BATTLE_TEAM_IDLE_TTL);
  });
  if(retained.length!==d.battleTeams.length){d.battleTeams=retained;changed=true;}
  return changed;
}
function battleTouchTeam(t){if(t)t.lastActivityAt=Date.now();}
function battleTouchLobby(r,d){if(r?.status==="waiting"){r.expiresAt=Date.now()+BATTLE_ROOM_TTL;if(d){battleTouchTeam(d.battleTeams.find(t=>t.id===r.sourceTeamId));battleTouchTeam(d.battleTeams.find(t=>t.id===r.challengedTeamId));}}}

// Team IDs identify a shareable team, NOT the physical device or its owner.
// Avoid fingerprinting devices; students can use a different phone after logging in.
const battleTeamCode = d => {let code;do{code="BT-"+crypto.randomBytes(5).toString("hex").toUpperCase();}while(d.battleTeams.some(t=>t.code===code));return code;};
const battleTeamView = (d,t,viewerId) => ({id:t.id,code:t.code,name:t.name,logo:t.logo,leader:t.leader,members:t.members.map(id=>battlePublicUser(d,id)),pending:t.leader===viewerId?t.pending.map(id=>battlePublicUser(d,id)):[],mine:t.members.includes(viewerId),isLeader:t.leader===viewerId,leaderOnline:Number(d.users.find(u=>u.id===t.leader)?.lastSeenAt||0)>Date.now()-90000,inactiveAt:Number(t.lastActivityAt||Date.parse(t.createdAt))+BATTLE_TEAM_IDLE_TTL});
async function battleTeamsHandler(request,d,a,p,m,url){
  if(m==="GET"&&p==="/api/battle/teams"){
    const mine=d.battleTeams.filter(t=>t.members.includes(a.sub));
    const invitations=d.battleRooms.filter(r=>r.status==="waiting"&&r.challengeStatus==="pending"&&mine.some(t=>t.id===r.challengedTeamId&&t.leader===a.sub))
      .map(r=>({roomId:r.id,title:r.title,subject:r.subject,format:r.format,challenger:r.teams.A.name,challengerLogo:r.teams.A.logo,opponent:r.teams.B.name,createdAt:r.createdAt}));
    return json({teams:mine.map(t=>battleTeamView(d,t,a.sub)),invitations});
  }
  if(m==="GET"&&p==="/api/battle/teams/explore"){
    if(!rateLimit(request,"battle-explore:"+a.sub,35,60000))return battleFailure("Too many team requests.",429);
    const q=cleanString(url.searchParams.get("q")||"",60).toLowerCase();
    const busy=new Set(d.battleRooms.filter(r=>r.status==="active"||(r.status==="waiting"&&Date.now()<Number(r.expiresAt||0))).flatMap(r=>[r.sourceTeamId,r.challengedTeamId]).filter(Boolean));
    const teams=d.battleTeams.filter(t=>!busy.has(t.id) && t.members.includes(t.leader) && Number(d.users.find(u=>u.id===t.leader)?.lastSeenAt||0)>Date.now()-90000 && (!q||t.name.toLowerCase().includes(q)||t.code.toLowerCase().includes(q)))
      .map(t=>({id:t.id,name:t.name,code:t.code,logo:t.logo,size:t.members.length,capacity:3,leaderOnline:Number(d.users.find(u=>u.id===t.leader)?.lastSeenAt||0)>Date.now()-90000,mine:t.members.includes(a.sub),isLeader:t.leader===a.sub}))
      .sort((x,y)=>Number(y.leaderOnline)-Number(x.leaderOnline)||x.name.localeCompare(y.name));
    return json({teams:teams.slice(0,80)});
  }
  if(m==="GET"&&p==="/api/battle/teams/lookup"){
    if(!rateLimit(request,"team-lookup:"+a.sub,40,60000))return battleFailure("Too many team searches.",429);
    const code=cleanString(url.searchParams.get("code"),20).toUpperCase();
    const t=d.battleTeams.find(t=>t.code===code);
    if(!t)return battleFailure("Team ID not found.",404);
    return json({id:t.id,code:t.code,name:t.name,logo:t.logo,size:t.members.length,capacity:3,alreadyMember:t.members.includes(a.sub)});
  }
  if(m==="POST"&&p==="/api/battle/teams"){
    if(!rateLimit(request,"team-create:"+a.sub,10,3600000))return battleFailure("Team creation limit reached.",429);
    const x=await readJSON(request),name=battleNameClean(x.name,"My Team"),logo=BATTLE_LOGOS.includes(x.logo)?x.logo:"lion";
    if(d.battleTeams.filter(t=>t.leader===a.sub).length>=8)return battleFailure("You can lead up to eight teams.",409);
    const t={id:crypto.randomUUID(),code:battleTeamCode(d),name,logo,leader:a.sub,members:[a.sub],pending:[],createdAt:new Date().toISOString(),lastActivityAt:Date.now()};
    d.battleTeams.push(t);await save(d);return json(battleTeamView(d,t,a.sub),201);
  }
  const match=p.match(/^\/api\/battle\/teams\/([^/]+)\/(request|approve|decline|transfer|leave|nullify)$/);
  if(!match||m!=="POST")return battleFailure("Team action not found.",404);
  const t=d.battleTeams.find(t=>t.id===match[1]);if(!t)return battleFailure("Team does not exist.",404);
  const action=match[2],x=await readJSON(request),id=String(x.userId||"");
  if(action==="nullify"){
    if(t.leader!==a.sub)return battleFailure("Only the team leader may nullify this team.",403);
    // Cancel unfinished challenges but retain historical room records and scores.
    for(const r of d.battleRooms){
      if(["waiting","active"].includes(r.status)&&[r.sourceTeamId,r.challengedTeamId].includes(t.id)){
        r.status="cancelled";r.challengeStatus="cancelled";r.cancelReason="Team nullified by leader";r.cancelledAt=new Date().toISOString();
      }
    }
    d.battleTeams=d.battleTeams.filter(v=>v.id!==t.id);
    await save(d);return json({ok:true,message:"Team nullified. Its Team ID is no longer valid."});
  }
  const locked=d.battleRooms.some(r=>(r.status==="active"||(r.status==="waiting"&&Date.now()<Number(r.expiresAt)))&&[r.sourceTeamId,r.challengedTeamId].includes(t.id)&&["accepted","pending"].includes(r.challengeStatus));
  if(action==="request"){
    if(t.members.includes(a.sub))return battleFailure("You already belong to this team.",409);
    if(t.members.length>=3)return battleFailure("This team is full.",409);
    if(!t.pending.includes(a.sub))t.pending.push(a.sub);battleTouchTeam(t);
    await save(d);return json({ok:true,message:"Request sent to the team leader."});
  }
  if(action==="approve"||action==="decline"){
    if(t.leader!==a.sub)return battleFailure("Only the leader can approve members.",403);
    if(!t.pending.includes(id))return battleFailure("Join request not found.",404);
    if(action==="approve"){
      if(locked)return battleFailure("Team membership is locked during a pending or active challenge.",409);
      if(t.members.length>=3)return battleFailure("Team is full.",409);
      if(!d.users.some(u=>u.id===id&&isRankedStudent(u)))return battleFailure("Student is no longer approved.",403);
      if(!t.members.includes(id))t.members.push(id);
    }
    t.pending=t.pending.filter(v=>v!==id);battleTouchTeam(t);await save(d);return json({ok:true});
  }
  if(!t.members.includes(a.sub))return battleFailure("You are not a member of this team.",403);
  if(locked)return battleFailure("Team membership is locked during a challenge.",409);
  if(action==="transfer"){
    if(t.leader!==a.sub||!t.members.includes(id))return battleFailure("Only the leader can choose a teammate as leader.",403);
    t.leader=id;battleTouchTeam(t);await save(d);return json({ok:true});
  }
  if(action==="leave"){
    if(t.leader===a.sub&&t.members.length>1)t.leader=t.members.find(id=>id!==a.sub);
    t.members=t.members.filter(v=>v!==a.sub);t.pending=t.pending.filter(v=>v!==a.sub);
    if(!t.members.length)d.battleTeams=d.battleTeams.filter(v=>v.id!==t.id);else battleTouchTeam(t);
    await save(d);return json({ok:true});
  }
  return battleFailure("Team action not supported.",405);
}

async function battleStudentHandler(request,d,a,p,m,url) {
  if (!d.users.some(u=>u.id===a.sub&&isRankedStudent(u)))return battleFailure("Approved student account required.",403);
  if(battlePruneInactive(d))await save(d);
  if(p.startsWith("/api/battle/teams"))return battleTeamsHandler(request,d,a,p,m,url);
  if(m==="GET" && p==="/api/battle/catalog") return json({subjects:d.battleSubjects.map(s=>s.name),topics:[],logos:BATTLE_LOGOS,formats:BATTLE_FORMATS});
  if(m==="GET" && p==="/api/battle/mine"){
    const offset=Math.max(0,Math.min(10000,Number(url.searchParams.get('offset'))||0)),limit=Math.max(1,Math.min(50,Number(url.searchParams.get('limit'))||25));
    return json(d.battleRooms.filter(r=>!["cancelled","expired"].includes(r.status)&&(r.teams.A.members.includes(a.sub)||r.teams.B.members.includes(a.sub)))
      .sort((x,y)=>String(y.createdAt).localeCompare(String(x.createdAt))).slice(offset,offset+limit).map(r=>{
       const side=r.teams.A.members.includes(a.sub)?'A':'B',them=side==='A'?'B':'A';
       return {id:r.id,code:r.code,title:r.title,format:r.format,status:r.status,subject:r.subject,
         scoreA:r.teams.A.score,scoreB:r.teams.B.score,createdAt:r.createdAt,
         ownTeam:r.teams[side].name,opponent:r.teams[them].name,
         outcome:r.status==='finished'?(r.winner===side?'Won':r.winner===them?'Lost':'Draw'):'In progress'};
      }));
  }
  if(m==="GET" && p==="/api/battle/leaderboard"){
    const scores=new Map();
    for(const r of d.battleRooms.filter(x=>x.status==="finished"&&(url.searchParams.get("mode")==="all"||x.sizes.A===x.sizes.B)))for(const side of ["A","B"]){const t=r.teams[side],id=t.name.toLowerCase()+"|"+t.logo;const row=scores.get(id)||{team:t.name,logo:t.logo,wins:0,played:0,points:0};row.played++;row.points+=t.score;if(r.winner===side)row.wins++;scores.set(id,row);}
    return json([...scores.values()].sort((x,y)=>y.wins-x.wins||y.points-x.points).slice(0,50));
  }
  if(m==="POST" && p==="/api/battle/create") {
    if(!rateLimit(request,"battle-create:"+a.sub,15,60*60*1000))return battleFailure("Too many rooms created. Try again later.",429);
    const x=await readJSON(request), sizes=BATTLE_FORMATS[String(x.format||"")];
    const own=d.battleTeams.find(t=>t.id===x.teamId),opponent=d.battleTeams.find(t=>t.code===String(x.opponentCode||"").trim().toUpperCase());
    if(!own||own.leader!==a.sub)return battleFailure("Create a team first. Only the team leader can challenge opponents.",403);
    if(!opponent||own.id===opponent.id)return battleFailure("Enter a different opponent team's valid Team ID.",404);
    if(own.members.length!==sizes?.[0])return battleFailure(`Your team needs exactly ${sizes?.[0]||0} player(s) for this format.`,409);
    if(opponent.members.length!==sizes?.[1])return battleFailure(`The opponent team must have exactly ${sizes?.[1]||0} player(s) for this format.`,409);
    if(own.members.some(id=>opponent.members.includes(id)))return battleFailure("A student cannot compete on both sides.",409);
    if(d.battleRooms.some(r=>["waiting","active"].includes(r.status)&&[own.id,opponent.id].some(id=>[r.sourceTeamId,r.challengedTeamId].includes(id))))return battleFailure("One of the teams is already in an unfinished challenge.",409);
    const subject=cleanString(x.subject,80),topic="All topics";
    const difficulty=["easy","medium","hard"].includes(x.difficulty)?x.difficulty:"mixed";
    const count=Number(x.questionCount||10);
    if(!sizes)return battleFailure("Choose a supported match format.");
    if(!d.battleSubjects.some(s=>s.name===subject))return battleFailure("Choose an available subject.");
    if(!Number.isInteger(count)||count<5||count>30)return battleFailure("Select 5 to 30 questions.");
    const pool=d.battleQuestions.filter(q=>q.subject===subject&&(difficulty==="mixed"||q.difficulty===difficulty)&&battleValidQuestion(q));
    if(pool.length<count)return battleFailure(`This subject has ${pool.length} approved questions. Add at least ${count} before creating a match.`,409);
    // All members answer identical server-stored question snapshots.
    const questions=selectUniqueQuestions(pool,count).map(q=>({id:q.id,q:q.q,options:q.options,answer:q.answer,explanation:q.explanation,passage:q.passage||"",imageRef:q.imageRef||"",imageRefs:q.imageRefs||[]}));
    let code;do{code="GB-"+crypto.randomInt(100000,1000000);}while(d.battleRooms.some(r=>r.code===code&&["waiting","active"].includes(r.status)));
    const id=crypto.randomUUID(),now=battleNow();
    const room={id,code,createdBy:a.sub,sourceTeamId:own.id,challengedTeamId:opponent.id,challengeStatus:"pending",title:battleNameClean(x.title,"Brainz Battle"),format:x.format,subject,topic,difficulty,speedBonus:!!d.settings.battleSpeedBonus,questionCount:count,sizes:{A:sizes[0],B:sizes[1]},createdAt:new Date(now).toISOString(),expiresAt:now+BATTLE_ROOM_TTL,status:"waiting",round:0,deadline:null,winner:null,questions,answers:{},suggestions:{},messages:[],teams:{A:{name:own.name,logo:own.logo,leader:own.leader,members:[...own.members],pending:[],ready:[],score:0},B:{name:opponent.name,logo:opponent.logo,leader:opponent.leader,members:[],pending:[],ready:[],score:0}}};
    d.battleRooms.push(room);battleTouchTeam(own);battleTouchTeam(opponent);await save(d);return json(battleConfirmedRoom(d,room,a.sub),201);
  }
  if(m==="GET"&&p==="/api/battle/lookup"){
    if(!rateLimit(request,"battle-lookup:"+a.sub,60,60000))return battleFailure("Too many match searches. Try again shortly.",429);
    const code=cleanString(url.searchParams.get("code"),20).toUpperCase();
    const room=d.battleRooms.find(r=>r.code===code);
    if(!room)return battleFailure("Match code not found.",404);
    if(["expired","cancelled"].includes(room.status))return battleFailure("This match room has closed.",410);
    const changed=battleTick(room);if(changed)await save(d);
    if(battleMember(room,a.sub))return json({kind:"room",room:battleConfirmedRoom(d,room,a.sub)});
    if(room.sourceTeamId){
      const t=d.battleTeams.find(t=>t.id===room.sourceTeamId);
      if(!t)return battleFailure("The inviting team no longer exists.",404);
      return json({kind:"team",team:{id:t.id,name:t.name,logo:t.logo,size:t.members.length,capacity:3},message:"This code belongs to the inviting team only. The opponent must accept a challenge sent to its Team ID."});
    }
    return battleFailure("This match cannot be joined using a shared room code.",403);
  }
  const match=p.match(/^\/api\/battle\/rooms\/([^/]+)(?:\/(.*))?$/);
  if(!match)return battleFailure("Battle Arena endpoint not found.",404);
  const room=d.battleRooms.find(r=>r.id===match[1]);
  if(!room)return battleFailure("Match not found.",404);
  if(["expired","cancelled"].includes(room.status))return battleFailure("This match room has closed.",410);
  const changed=battleTick(room);if(changed)await save(d);
  const action=match[2]||"";
  if(!action&&m==="GET") {if(!battleMember(room,a.sub))return battleFailure("Join this room before viewing the match.",403);return json(battleConfirmedRoom(d,room,a.sub));}
  if(m==="GET" && action==="chat"){
    const side=battleMember(room,a.sub);
    if(!side)return battleFailure("Team membership required.",403);
    return json(room.messages.filter(x=>x.side===side).slice(-100).map(x=>({id:x.id,studentName:battlePublicUser(d,x.userId).name,text:x.text,createdAt:x.createdAt,mine:x.userId===a.sub})));
  }
  if(m!=="POST")return battleFailure("Method not supported.",405);
  const x=await readJSON(request);
  if(action==="respond"){
    if(room.status!=="waiting"||room.challengeStatus!=="pending")return battleFailure("This challenge is no longer awaiting acceptance.",409);
    const invited=d.battleTeams.find(t=>t.id===room.challengedTeamId);
    if(!invited||invited.leader!==a.sub)return battleFailure("Only the challenged team leader can respond.",403);
    if(x.accept===true){
      if(invited.members.length!==room.sizes.B)return battleFailure("Your team size no longer matches this competition.",409);
      if(invited.members.some(id=>room.teams.A.members.includes(id)))return battleFailure("A student cannot compete on both teams.",409);
      room.teams.B={name:invited.name,logo:invited.logo,leader:invited.leader,members:[...invited.members],pending:[],ready:[],score:0};
      room.challengeStatus="accepted";
    }else{room.challengeStatus="declined";room.status="cancelled";}
    battleTouchLobby(room,d);await save(d);return json({ok:true,accepted:x.accept===true,roomId:room.id,...(x.accept===true?{room:battleConfirmedRoom(d,room,a.sub)}:{})});
  }
  const side=battleMember(room,a.sub);
  if(action==="request"){
    const target=x.team;
    if(room.status!=="waiting")return battleFailure("Joining is closed.",409);
    if(room.sourceTeamId)return battleFailure("Join the named team using its Team ID and leader approval; opponent teams are invited separately.",403);
    if(!["A","B"].includes(target))return battleFailure("Choose Team A or Team B.");
    if(side)return battleFailure("You already belong to this match.",409);
    const t=room.teams[target];if(t.members.length>=room.sizes[target])return battleFailure("That team is full.",409);
    for(const t0 of Object.values(room.teams))t0.pending=t0.pending.filter(id=>id!==a.sub);
    t.pending.push(a.sub);battleTouchLobby(room,d);await save(d);return json({ok:true,message:"Join request sent. Awaiting team leader approval."});
  }
  if(action==="approve"||action==="decline"){
    const target=x.team,t=room.teams[target];
    if(room.status!=="waiting"||!["A","B"].includes(target)||!t)return battleFailure("This request cannot be processed.",409);
    const isLeader=t.leader===a.sub||(!t.leader&&target==="B"&&room.teams.A.leader===a.sub);
    if(!isLeader)return battleFailure("Only the team leader may approve members.",403);
    const id=String(x.userId||""),idx=t.pending.indexOf(id);
    if(idx<0)return battleFailure("Join request not found.",404);
    t.pending.splice(idx,1);
    if(action==="approve"){
      if(t.members.length>=room.sizes[target])return battleFailure("That team is full.",409);
      if(battleMember(room,id))return battleFailure("This player already joined a team.",409);
      if(!d.users.some(u=>u.id===id&&isRankedStudent(u)))return battleFailure("This account is no longer approved.",403);
      t.members.push(id);if(!t.leader)t.leader=id;
    }
    battleTouchLobby(room,d);await save(d);return json({ok:true,room:battleConfirmedRoom(d,room,a.sub)});
  }
  if(!side)return battleFailure("You are not a member of this room.",403);
  const team=room.teams[side];
  if(action==="team"){
    if(room.status!=="waiting"||team.leader!==a.sub)return battleFailure("Only a leader can edit the team before the match starts.",403);
    if(x.name!==undefined)team.name=battleNameClean(x.name,team.name);
    if(x.logo!==undefined){if(!BATTLE_LOGOS.includes(x.logo))return battleFailure("Choose a logo from the team badge gallery.");team.logo=x.logo;}
    battleTouchLobby(room,d);await save(d);return json({ok:true,room:battleConfirmedRoom(d,room,a.sub)});
  }
  if(action==="transfer"){
    if(room.status!=="waiting"||team.leader!==a.sub||!team.members.includes(String(x.userId||"")))return battleFailure("Only the leader can transfer leadership to a teammate before the match.",403);
    team.leader=x.userId;battleTouchLobby(room,d);await save(d);return json({ok:true,room:battleConfirmedRoom(d,room,a.sub)});
  }
  if(action==="remove"){
    if(room.status!=="waiting"||team.leader!==a.sub||!team.members.includes(String(x.userId||""))||x.userId===a.sub)return battleFailure("Only the leader can remove another teammate before the match.",403);
    team.members=team.members.filter(id=>id!==x.userId);team.ready=team.ready.filter(id=>id!==x.userId);battleTouchLobby(room,d);await save(d);return json({ok:true,room:battleConfirmedRoom(d,room,a.sub)});
  }
  if(action==="leave"){
    if(room.status!=="waiting")return battleFailure("You cannot leave an active match. Reconnect to continue.",409);
    if(team.leader===a.sub&&team.members.length>1)team.leader=team.members.find(id=>id!==a.sub);
    else if(team.leader===a.sub)team.leader=null;
    team.members=team.members.filter(id=>id!==a.sub);team.ready=team.ready.filter(id=>id!==a.sub);
    if(!room.teams.A.members.length&&!room.teams.B.members.length)room.status="cancelled";
    battleTouchLobby(room,d);await save(d);return json({ok:true,room:battleConfirmedRoom(d,room,a.sub)});
  }
  if(action==="ready"){
    if(room.status!=="waiting")return battleFailure("The lobby is closed.",409);
    team.ready=team.ready.filter(id=>id!==a.sub);if(x.ready!==false)team.ready.push(a.sub);battleTouchLobby(room,d);await save(d);return json({ok:true,room:battleConfirmedRoom(d,room,a.sub)});
  }
  if(action==="start"){
    if(room.status!=="waiting"||room.teams.A.leader!==a.sub)return battleFailure("Only the match creator/Team A leader can start the ready lobby.",403);
    if(room.challengeStatus&&room.challengeStatus!=="accepted")return battleFailure("The opponent leader must accept the challenge first.",409);
    if(!["A","B"].every(s=>{const t=room.teams[s];return t.leader&&t.members.length===room.sizes[s]&&t.members.every(id=>t.ready.includes(id));}))return battleFailure("Both teams must be full and every player must be ready.",409);
    room.status="active";room.round=0;room.deadline=battleNow()+BATTLE_QUESTION_SECONDS*1000;
    battleTouchLobby(room,d);await save(d);return json({ok:true,room:battleConfirmedRoom(d,room,a.sub)});
  }
  if(action==="rematch"){
    if(room.status!=="finished"||room.createdBy!==a.sub)return battleFailure("Only the original room creator can request a rematch after a completed game.",403);
    const pool=d.battleQuestions.filter(q=>q.subject===room.subject&&(!room.difficulty||room.difficulty==="mixed"||q.difficulty===room.difficulty)&&battleValidQuestion(q));
    if(pool.length<room.questionCount)return battleFailure("Not enough approved questions are available for a rematch.",409);
    const used=new Set(room.questions.map(q=>q.id));
    const fresh=pool.filter(q=>!used.has(q.id));
    const chosen=fresh.length>=room.questionCount?selectUniqueQuestions(fresh,room.questionCount):selectUniqueQuestions(pool,room.questionCount);
    const newQuestions=chosen.map(q=>({id:q.id,q:q.q,options:q.options,answer:q.answer,explanation:q.explanation,passage:q.passage||"",imageRef:q.imageRef||"",imageRefs:q.imageRefs||[]}));
    let newCode;do{newCode="GB-"+crypto.randomInt(100000,1000000);}while(d.battleRooms.some(r=>r.code===newCode&&["waiting","active"].includes(r.status)));
    const now=battleNow(),newRoom={...clone(room),id:crypto.randomUUID(),code:newCode,createdAt:new Date(now).toISOString(),expiresAt:now+BATTLE_ROOM_TTL,status:"waiting",challengeStatus:room.sourceTeamId?"pending":"accepted",round:0,deadline:null,winner:null,questions:newQuestions,answers:{},suggestions:{},messages:[],teams:clone(room.teams)};
    if(room.sourceTeamId){newRoom.teams.B.members=[];newRoom.teams.B.ready=[];}
    for(const t of Object.values(newRoom.teams)){t.score=0;t.ready=[];t.pending=[];}
    d.battleRooms.push(newRoom);battleTouchTeam(d.battleTeams.find(t=>t.id===newRoom.sourceTeamId));battleTouchTeam(d.battleTeams.find(t=>t.id===newRoom.challengedTeamId));await save(d);
    return json({ok:true,room:battleSafeRoom(d,newRoom,a.sub)},201);
  }
  if(action==="chat"){
    if(!["waiting","active"].includes(room.status))return battleFailure("The match chat is closed.",409);
    if(!rateLimit(request,"battle-chat:"+a.sub,100,60*60*1000))return battleFailure("Message limit reached.",429);
    const msg=String(x.text||"").trim();if(!msg||msg.length>1000)return battleFailure("Write a message of up to 1,000 characters.");
    const message={id:crypto.randomUUID(),side,userId:a.sub,text:msg,createdAt:new Date().toISOString()};
    room.messages.push(message);
    room.messages=room.messages.slice(-300);
    battleTouchLobby(room,d);await save(d);
    return json({ok:true,message:{id:message.id,studentName:battlePublicUser(d,a.sub).name,text:message.text,createdAt:message.createdAt,mine:true}},201);
  }
  if(action==="suggest"||action==="answer"){
    if(room.status!=="active")return battleFailure("The match is not active.",409);
    const now=battleNow();if(now>=room.deadline){if(battleTick(room,now))await save(d);return battleFailure("Time is up for this round.",409);}
    const answer=Number(x.answer),q=room.questions[room.round];if(!Number.isInteger(answer)||answer<0||answer>=q.options.length)return battleFailure("Choose a valid answer option.");
    if(action==="suggest"){
      room.suggestions[room.round]??={};room.suggestions[room.round][side]??=[];
      const arr=room.suggestions[room.round][side];const previous=arr.find(v=>v.userId===a.sub);
      if(previous)previous.answer=answer;else arr.push({userId:a.sub,answer});
      battleTouchLobby(room,d);await save(d);return json({ok:true,room:battleConfirmedRoom(d,room,a.sub)});
    }
    if(team.leader!==a.sub)return battleFailure("Only the team leader may submit the final answer.",403);
    room.answers[room.round]??={};if(room.answers[room.round][side])return battleFailure("Your team already submitted an answer for this round.",409);
    const correct=answer===q.answer,secondsUsed=Math.max(0,Math.round((BATTLE_QUESTION_SECONDS*1000-(room.deadline-now))/1000));
    const awarded=correct?(10+(room.speedBonus?(secondsUsed<=10?5:secondsUsed<=20?2:0):0)):0;
    room.answers[room.round][side]={answer,correct,points:awarded,secondsUsed};team.score+=awarded;
    battleTouchLobby(room,d);await save(d);return json({ok:true,submitted:true,room:battleConfirmedRoom(d,room,a.sub)});
  }
  return battleFailure("Unknown room action.",404);
}
function battleParseCsv(text,subject,topic) {
  const rows=[];let row=[],field="",quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
    else if(c===','&&!quoted){row.push(field.trim());field="";}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field.trim());if(row.some(Boolean))rows.push(row);row=[];field="";}
    else field+=c;
  }
  row.push(field.trim());if(row.some(Boolean))rows.push(row);
  if(rows.length<2)return [];
  const norm=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"");
  const headers=rows[0].map(norm);
  const fieldAt=(row,...names)=>{const idx=headers.findIndex(h=>names.includes(h));return idx<0?"":String(row[idx]||"").trim();};
  if(!headers.some(h=>["question","q","questiontext"].includes(h)))return [];
  return rows.slice(1,501).map((row,i)=>{
    const options=[fieldAt(row,"optiona","a"),fieldAt(row,"optionb","b"),fieldAt(row,"optionc","c"),fieldAt(row,"optiond","d")].filter(Boolean);
    const answerValue=fieldAt(row,"answer","correctanswer","correctoption").trim();
    const byLabel=/^[A-D]$/i.test(answerValue)?answerValue.toUpperCase().charCodeAt(0)-65:-1;
    const byText=options.findIndex(o=>o.trim().toLowerCase()===answerValue.toLowerCase());
    const byIndex=/^\d+$/.test(answerValue)?Number(answerValue)-1:-1;
    const answer=byLabel>=0?byLabel:byText>=0?byText:byIndex;
    return {q:fieldAt(row,"question","q","questiontext"),subject,topic:"General",options,answer:answer>=0?answer:0,needsReview:answer<0||answer>=options.length||options.length<2,explanation:fieldAt(row,"explanation","reason"),difficulty:"medium"};
  }).filter(q=>q.q);
}
async function battleAdminHandler(request,d,p,m,url) {
  const subjects=()=>d.battleSubjects.map(s=>s.name);
  async function validateBattleImages(item) {
    for(const ref of item.imageRefs||[]){
      const key=decodeURIComponent(ref.slice("/api/files/".length));
      const meta=await store().get(`${key}.meta`,{type:"json"});
      if(!meta || !/^image\/(png|jpeg|webp|gif)$/i.test(String(meta.contentType||"")) || Number(meta.size)>5*1024*1024)
        throw new Error("A question diagram must be an existing image (PNG, JPEG, WebP or GIF) smaller than 5 MB.");
    }
  }
  if(m==="GET"&&p==="/api/admin/battle/settings")return json({speedBonus:!!d.settings.battleSpeedBonus});
  if(m==="POST"&&p==="/api/admin/battle/settings"){
    const x=await readJSON(request);if(typeof x.speedBonus!=="boolean")return battleFailure("Choose whether speed bonuses are enabled.");
    d.settings.battleSpeedBonus=x.speedBonus;await save(d);return json({speedBonus:!!d.settings.battleSpeedBonus});
  }
  if(m==="GET"&&p==="/api/admin/battle/subjects")return json(d.battleSubjects);
  if(m==="POST"&&p==="/api/admin/battle/subjects"){
    return battleFailure("Manage subjects globally in Admin → Subjects.",410);
    /* retired compatibility code */
    const x=await readJSON(request),name=cleanString(x.name,80);
    if(!name||d.battleSubjects.some(s=>s.name.toLowerCase()===name.toLowerCase()))return battleFailure("Enter a unique subject name.",409);
    const row={id:crypto.randomUUID(),name};d.battleSubjects.push(row);await save(d);return json(row,201);
  }
  if(m==="DELETE"&&/^\/api\/admin\/battle\/subjects\/[^/]+$/.test(p)){
    return battleFailure("Manage subjects globally in Admin → Subjects.",410);
    /* retired compatibility code */
    const id=p.split("/").pop(),item=d.battleSubjects.find(s=>s.id===id);
    if(!item)return battleFailure("Subject not found.",404);
    // Subjects are global across EduSpace. Deleting a subject while it still
    // owns lessons, CBTs or topics would make saved content disappear on the
    // next data migration/normalisation pass, so refuse destructive deletes.
    if(SUBJECTS.includes(item.name))return battleFailure("Default EduSpace subjects cannot be deleted.",409);
    const used=d.battleQuestions.some(q=>q.subject===item.name)||d.questionBank.some(q=>q.subject===item.name)||d.topics.some(t=>t.subject===item.name)||d.notes.some(n=>n.subject===item.name)||d.cbtTests.some(t=>t.subject===item.name)||d.videos.some(v=>v.subject===item.name)||d.progress.some(x=>x.subject===item.name)||d.battleRooms.some(r=>r.subject===item.name)||d.users.some(u=>(u.selectedSubjects||[]).includes(item.name));
    if(used)return battleFailure("This subject is used across EduSpace. Move or archive its topics, materials, CBTs, students and matches before deleting it.",409);
    d.battleSubjects=d.battleSubjects.filter(s=>s.id!==id);await save(d);return json({ok:true});
  }
  if(m==="GET"&&p==="/api/admin/battle/questions"){
    const subject=url.searchParams.get("subject")||"",q=(url.searchParams.get("search")||"").trim().toLowerCase();
    const selected=d.battleQuestions.filter(x=>(!subject||x.subject===subject)&&(!q||[x.q,x.topic,x.passage,x.explanation].some(t=>String(t||"").toLowerCase().includes(q))));
    // Backwards-compatible legacy response, with new paginated response on ?page=.
    if(!url.searchParams.has("page"))return json(selected.slice(-500));
    const limit=Math.min(100,Math.max(1,Number.parseInt(url.searchParams.get("limit"),10)||25));
    const page=Math.max(1,Number.parseInt(url.searchParams.get("page"),10)||1);
    const counts=d.battleQuestions.reduce((acc,item)=>{acc[item.subject]=(acc[item.subject]||0)+1;return acc;},{});
    return json({questions:selected.slice().reverse().slice((page-1)*limit,page*limit),page,limit,total:selected.length,totalAll:d.battleQuestions.length,counts});
  }
  // Destructive operations are limited to Battle Arena bank records only. Historic
  // completed match snapshots and the ordinary EduSpace Question Bank are preserved.
  if(m==="POST"&&p==="/api/admin/battle/questions/bulk-delete"){
    const x=await readJSON(request),scope=String(x.scope||""),subject=cleanString(x.subject,80),phrase=String(x.confirmText||"").trim();
    if(scope==="subject"){
      if(!subjects().includes(subject))return battleFailure("Select a valid subject before deleting its Battle Arena questions.");
      if(phrase!=="DELETE SUBJECT")return battleFailure("Type DELETE SUBJECT to confirm this operation.");
    } else if(scope==="all"){
      if(subject||phrase!=="DELETE ALL BATTLE QUESTIONS")return battleFailure("Type DELETE ALL BATTLE QUESTIONS to confirm deletion of the whole Battle Arena question bank.");
    } else return battleFailure("Choose a valid deletion scope.");
    const before=d.battleQuestions.length;
    d.battleQuestions=scope==="all"?[]:d.battleQuestions.filter(q=>q.subject!==subject);
    const deleted=before-d.battleQuestions.length;
    if(deleted)await save(d);
    return json({ok:true,scope,subject:scope==="subject"?subject:null,deleted,remaining:d.battleQuestions.length});
  }
  if(m==="POST"&&p==="/api/admin/battle/questions"){
    const x=await readJSON(request);let item;try{item=battleQuestionInput(x,subjects());}catch(e){return battleFailure(e.message);}
    try{await validateBattleImages(item);}catch(e){return battleFailure(e.message);}
    item.id=crypto.randomUUID();d.battleQuestions.push(item);await save(d);return json(item,201);
  }
  if(/^(PATCH|DELETE)$/.test(m)&&/^\/api\/admin\/battle\/questions\/[^/]+$/.test(p)){
    const id=p.split("/").pop(),index=d.battleQuestions.findIndex(x=>x.id===id);
    if(index<0)return battleFailure("Question not found.",404);
    if(m==="DELETE"){d.battleQuestions.splice(index,1);await save(d);return json({ok:true});}
    const x=await readJSON(request);let item;try{item=battleQuestionInput({...d.battleQuestions[index],...x},subjects());}catch(e){return battleFailure(e.message);}
    try{await validateBattleImages(item);}catch(e){return battleFailure(e.message);}
    d.battleQuestions[index]={...item,id};await save(d);return json(d.battleQuestions[index]);
  }
  if(m==="POST"&&p==="/api/admin/battle/extract"){
    const x=await readJSON(request),key=String(x.fileKey||""),fileName=String(x.fileName||"").slice(0,180);
    if(!/\.(pdf|docx|txt|csv)$/i.test(fileName))return battleFailure("Upload a PDF, DOCX, TXT or CSV document.");
    const meta=await store().get(`${key}.meta`,{type:"json"});
    if(!meta||meta.size>15*1024*1024)return battleFailure("Upload a valid document smaller than 15 MB.",413);
    let parts;try{parts=await extractDocumentParts(await readStoredFile(key),fileName,meta.contentType);}catch(e){return battleFailure("Document could not be extracted: "+e.message,422);}
    const subject=cleanString(x.subject,80),topic="General";
    const csv=/\.csv$/i.test(fileName);
    const parsed=csv?{questions:battleParseCsv(parts.text,subject,topic),report:{format:"csv",numbered:0,imagesFound:0}}:parseExtractedQuestions(parts.text,parts.assets,subject);
    // Preserve the original missing/unknown answer flag. Imports require human review.
    const questions=parsed.questions.slice(0,500).map(q=>({...q,subject,topic:"General",difficulty:"medium"}));
    if(parts.assets.size)await persistImportedImageAssets(questions,parts.assets,"battle");
    return json({questions,report:parsed.report,ready:questions.filter(q=>!q.needsReview).length,needsReview:questions.filter(q=>q.needsReview).length});
  }
  if(m==="POST"&&p==="/api/admin/battle/import"){
    const x=await readJSON(request),incoming=Array.isArray(x.questions)?x.questions:[];
    if(!incoming.length||incoming.length>250)return battleFailure("Select 1–250 reviewed questions per import.");
    const out=[];for(const q of incoming){let item;try{item=battleQuestionInput(q,subjects());}catch(e){return battleFailure(`Question ${out.length+1}: ${e.message}`);}try{await validateBattleImages(item);}catch(e){return battleFailure(`Question ${out.length+1}: ${e.message}`);}item.id=crypto.randomUUID();out.push(item);}
    d.battleQuestions.push(...out);await save(d);return json({ok:true,imported:out.length},201);
  }
  if(m==="GET"&&p==="/api/admin/battle/rooms")return json(d.battleRooms.slice(-100).reverse().map(r=>({id:r.id,code:r.code,title:r.title,status:r.status,subject:r.subject,format:r.format,scoreA:r.teams.A.score,scoreB:r.teams.B.score,createdAt:r.createdAt})));
  if(m==="GET"&&/^\/api\/admin\/battle\/rooms\/[^/]+$/.test(p)){
    const r=d.battleRooms.find(x=>x.id===p.split("/").pop());if(!r)return battleFailure("Match not found.",404);
    return json({...battleSafeRoom(d,r,"",true),messages:r.messages.map(msg=>({...msg,studentName:battlePublicUser(d,msg.userId).name}))});
  }
  if(m==="POST"&&/^\/api\/admin\/battle\/rooms\/[^/]+\/cancel$/.test(p)){
    const r=d.battleRooms.find(x=>x.id===p.split("/")[5]);if(!r)return battleFailure("Match not found.",404);
    if(!["waiting","active"].includes(r.status))return battleFailure("This match has already ended.",409);
    r.status="cancelled";r.deadline=null;await save(d);return json({ok:true});
  }
  if(m==="DELETE"&&/^\/api\/admin\/battle\/rooms\/[^/]+\/messages\/[^/]+$/.test(p)){
    const parts=p.split("/"),r=d.battleRooms.find(x=>x.id===parts[5]);if(!r)return battleFailure("Match not found.",404);
    const length=r.messages.length;r.messages=r.messages.filter(v=>v.id!==parts[7]);if(r.messages.length===length)return battleFailure("Message not found.",404);
    await save(d);return json({ok:true});
  }
  return battleFailure("Battle Arena admin endpoint not found.",404);
}

/* --------------------------------------------------------------------------
   Student Learning Centre + Assessment Hub v1 integration contract.
   EduSpace never trusts external CBT links or browser-supplied results.
   Assessment Hub integration is opt-in, server-authenticated and account-linked.
--------------------------------------------------------------------------- */
const STUDY_ACTIVITY_TYPES=new Set(["study","cbt","material","video","revision","other"]);
const LEARNING_MAX={mistakes:300,saved:300,plans:150};
// Protocol v2 invalidates old Hub links without deleting student accounts or notes.
const HUB_LINK_GENERATION = 2;
const hubActiveLink = x => Number(x?.generation) === HUB_LINK_GENERATION && !!x.externalUserId;
const hubSecret=()=>env("ASSESSMENT_HUB_SYNC_SECRET");
const learningNow=()=>new Date().toISOString();
const learningFail=(message,status=400)=>json({error:message},status);
const learningOwner=(list,id,uid)=>list.find(x=>x.id===id && x.userId===uid);
const learningDate=value=>typeof value==="string"&&/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)&&!Number.isNaN(Date.parse(value+"T00:00:00Z"))&&new Date(value+"T00:00:00Z").toISOString().slice(0,10)===value;
const shortWords=(s,max)=>cleanString(s,max).replace(/[\u0000-\u001f\u007f]/g," ");
const userLearningPublic=u=>({id:u.id,name:u.name,username:u.username,avatar:validAvatar(u.avatar),online:Number(u.lastSeenAt||0)>Date.now()-90000});
const mayExploreStudent=(d,uid,u)=>u.id!==uid&&u.status==="active"&&!d.learningBlocks.some(b=>[b.from,b.to].includes(uid)&&[b.from,b.to].includes(u.id));
function learningBadges(d,userId){
  const finishedPlans=d.learningPlans.filter(x=>x.userId===userId&&x.completed);
  const completedTopics=d.progress.filter(x=>x.userId===userId&&x.completed).length;
  const mastered=d.learningMistakes.filter(x=>x.userId===userId&&x.mastered).length;
  const battleWins=d.battleRooms.filter(r=>r.status==="finished"&&r.winner&&r.teams?.[r.winner]?.members?.includes(userId)).length;
  const partners=d.learningPartners.filter(x=>x.status==="accepted"&&[x.from,x.to].includes(userId)).length;
  const defs=[
    {id:"first-steps",title:"First Steps",icon:"🌱",description:"Complete your first topic",current:completedTopics,target:1},
    {id:"dedicated-scholar",title:"Dedicated Scholar",icon:"📚",description:"Complete 20 topics",current:completedTopics,target:20},
    {id:"organised-learner",title:"Organised Learner",icon:"📅",description:"Finish 5 planned activities",current:finishedPlans.length,target:5},
    {id:"revision-champion",title:"Revision Champion",icon:"🧠",description:"Master 20 mistakes",current:mastered,target:20},
    {id:"study-partner",title:"Study Partner",icon:"🤝",description:"Start a study partnership",current:partners,target:1},
    {id:"battle-champion",title:"Battle Champion",icon:"🏆",description:"Win 5 team battles",current:battleWins,target:5}
  ];
  return defs.map(x=>({...x,earned:x.current>=x.target,progress:Math.min(100,Math.round(x.current/x.target*100))}));
}
function safeLearningExternalUrl(value){
  try{const u=new URL(String(value||""));return ["https:","http:"].includes(u.protocol)?u.href:"";}catch{return "";}
}
function learningResources(d,u,space="public"){
  const allowed=studentSubjects(u), isPremium=space==="restricted";
  return [
    ...d.cbtTests.filter(x=>x.published&&allowed.includes(x.subject)&&matchesSpace(x,space)).map(x=>({id:x.id,type:"cbt",title:x.title,subject:x.subject,locked:false,url:safeLearningExternalUrl(x.linkUrl)})),
    ...d.notes.filter(x=>x.published&&allowed.includes(x.subject)&&matchesSpace(x,space)).map(x=>({id:x.id,type:"material",title:x.title,subject:x.subject,locked:false,url:"/materials.html?subject="+encodeURIComponent(x.subject)+(isPremium?"&space=premium":"")})),
    ...(!isPremium?d.videos.filter(x=>x.published&&allowed.includes(x.subject)).map(x=>({id:x.id,type:"video",title:x.title,subject:x.subject,locked:false,url:safeLearningExternalUrl(x.youtubeUrl)||"/videos.html"})):[])
  ];
}
function learningQuestionFromBattle(d,userId,roomId,questionId){
  const room=d.battleRooms.find(r=>r.id===roomId&&r.status==="finished"&&["A","B"].some(side=>r.teams?.[side]?.members?.includes(userId)));
  const q=room?.questions?.find(q=>String(q.id)===questionId);
  if(!q)return null;
  return {source:"battle",sourceId:String(room.id)+":"+String(q.id),subject:room.subject,topic:room.topic||"",question:shortWords(q.q,4000),options:(q.options||[]).slice(0,6).map(o=>shortWords(o,1200)),correctIndex:Number(q.answer),explanation:shortWords(q.explanation||"",4500)};
}
function learningQuestionInput(x){
  const question=shortWords(x.question||x.q,4000),subject=shortWords(x.subject,80),topic=shortWords(x.topic,150);
  if(question.length<8||!subject)return null;
  const options=Array.isArray(x.options)?x.options.slice(0,6).map(v=>shortWords(v,1200)):[];
  const correctIndex=Number.isInteger(x.correctIndex)&&x.correctIndex>=0&&x.correctIndex<options.length?x.correctIndex:null;
  return {subject,topic,question,options,correctIndex,explanation:shortWords(x.explanation||"",4500)};
}
// Erase private learning data on account deletion; do not leave orphaned chats,
// subscriptions, linked hub identifiers or reports behind.
function purgeStudentLearning(d, userId){
  for(const key of ["learningMistakes","learningSaved","learningPlans","learningLinks","learningAssessments","learningEvents"])
    d[key]=d[key].filter(x=>x.userId!==userId);
  for(const key of ["learningPartners","learningMessages","learningPartnerGoals","learningBlocks"])
    d[key]=d[key].filter(x=>x.from!==userId&&x.to!==userId);
  d.learningReports=d.learningReports.filter(x=>x.reporter!==userId&&x.from!==userId&&x.to!==userId);
  d.learningCommunities=(d.learningCommunities||[]).map(c=>{
    const members=(c.members||[]).filter(id=>id!==userId);
    if(!members.length)return null;
    return {...c,members,lead:c.lead===userId?members[0]:c.lead,pending:(c.pending||[]).filter(id=>id!==userId)};
  }).filter(Boolean);
  d.learningCommunityMessages=(d.learningCommunityMessages||[]).filter(m=>m.from!==userId&&d.learningCommunities.some(c=>c.id===m.communityId));
}

// Best-effort public profile mirroring for a deliberately gated SQL cutover.
// Login credentials, email and WhatsApp are never sent to this directory.
async function mirrorStudyStudentProfile(user){
  if(String(env('GB_STUDY_DIRECTORY_BACKEND')||'legacy').toLowerCase()!=='supabase')return;
  try{
    const store=createStudyChatStore({GB_CHAT_BACKEND:env('GB_CHAT_BACKEND'),
      GB_CHAT_SUPABASE_URL:env('GB_CHAT_SUPABASE_URL'),GB_CHAT_SUPABASE_SECRET:env('GB_CHAT_SUPABASE_SECRET')});
    if(!store)throw Error('Study directory mirror requires SQL chat storage');
    await store.upsertStudent(user);
  }catch(e){
    // The user account is already committed. Never claim a failed registration
    // after successfully creating an account (which causes duplicate retries).
    console.warn('Study directory profile mirror will require reconciliation:',e?.message||e);
  }
}

async function learningHandler(request,d,a,p,m,url){
  const user=d.users.find(u=>u.id===a.sub);
  if(!user||user.status!=="active")return learningFail("Account is not active.",403);
  const uid=user.id,now=learningNow();
  // Optional isolated Postgres chat storage: when enabled, message writes no
  // longer rewrite the central EduSpace Blob data record. Authentication and
  // partnership/community permissions remain authoritative here on the server.
  const chatDb=createStudyChatStore({
    GB_CHAT_BACKEND:env("GB_CHAT_BACKEND"),
    GB_CHAT_SUPABASE_URL:env("GB_CHAT_SUPABASE_URL"),
    GB_CHAT_SUPABASE_SECRET:env("GB_CHAT_SUPABASE_SECRET"),GB_CHAT_REALTIME_ENABLED:env("GB_CHAT_REALTIME_ENABLED")
  });
  // v12.16: opt-in, fail-closed SQL relationship authority. Authentication and
  // account passwords remain in the existing store pending a separate audit.
  const directoryMode=String(env('GB_STUDY_DIRECTORY_BACKEND')||'legacy').toLowerCase();
  if(!['legacy','supabase'].includes(directoryMode))return learningFail('Invalid study directory configuration.',503);
  const directoryEnabled=directoryMode==='supabase';
  if(directoryEnabled&&(!chatDb||String(env('GB_STUDY_DIRECTORY_CUTOVER_APPROVED'))!=='true'))
    return learningFail('SQL study directory requires verified migrations, backfill and explicit cutover approval.',503);
  const directory=directoryEnabled?chatDb:null;
  // Read only when a route needs partnerships. Keep d.learningPartners untouched:
  // unrelated legacy saves must never replace all relationships with one user's SQL rows.
  const needsPartners=(p.startsWith('/api/learning/partners') &&
      !['/api/learning/partners/explore','/api/learning/partners/search','/api/learning/partners/presence'].includes(p))||
      p==='/api/learning/bootstrap'||p==='/api/learning/overview'||
      p==='/api/learning/badges'||p==='/api/learning/messaging/realtime-ticket';
  // Parallel indexed reads keep the SQL cutover from adding two consecutive
  // network round trips to every chat action or conversation-list refresh.
  const directorySnapshot=directory&&needsPartners?await Promise.all([
    directory.findPartnerships(uid),directory.blockedFor(uid)]):null;
  const partners=directorySnapshot?directorySnapshot[0]:d.learningPartners;
  const studyBlocks=directorySnapshot?[...d.learningBlocks,...directorySnapshot[1]]:d.learningBlocks;
  const badgeView=directory&&needsPartners?{...d,learningPartners:partners}:d;
  const sqlMutate=async(action,options)=>{
    try{return await directory.partnerMutation(action,uid,options);}
    catch(e){
      if(e.dbCode==='23505'||e.dbCode==='23514')return {error:e.message,status:409};
      if(e.dbCode==='42501')return {error:e.message,status:403};
      if(e.dbCode==='P0002')return {error:e.message,status:404};
      throw e;
    }
  };
  let realtimeConfig=null, realtimeConfigError=null;
  try{realtimeConfig=realtimeConfiguration({
    GB_CHAT_REALTIME_ENABLED:env("GB_CHAT_REALTIME_ENABLED"),
    GB_CHAT_BACKEND:env("GB_CHAT_BACKEND"),
    GB_CHAT_SUPABASE_URL:env("GB_CHAT_SUPABASE_URL"),
    GB_CHAT_REALTIME_JWT_SECRET:env("GB_CHAT_REALTIME_JWT_SECRET"),
    GB_CHAT_REALTIME_PUBLISHABLE_KEY:env("GB_CHAT_REALTIME_PUBLISHABLE_KEY")
  });}catch(error){realtimeConfigError=error;}
  // Explicit staging-gated SQL metadata mirroring. Current EduSpace login,
  // permissions and historical records remain authoritative in the Blob while
  // the migration and reconciliation are being verified.
  const syncPartner=async part=>{
    if(!realtimeConfig||!chatDb)return;
    const participants=[part.from,part.to];
    for(const id of participants){const found=d.users.find(x=>x.id===id);if(found)await chatDb.upsertStudent(found);}
    await chatDb.upsertPartnership(part);
    const blocked=studyBlocks.some(x=>participants.includes(x.from)&&participants.includes(x.to));
    await chatDb.syncRoomMembers(chatRoom('private',part.from,part.to),part.status==='accepted'&&!blocked?participants:[]);
  };
  const syncCommunity=async c=>{
    if(!realtimeConfig||!chatDb||!c)return;
    await chatDb.upsertCommunity(c);
    for(const id of c.members){const found=d.users.find(x=>x.id===id);if(found)await chatDb.upsertStudent(found);}
    await chatDb.syncCommunityMembers(c);
    await chatDb.syncRoomMembers(chatRoom('community',c.id),c.members);
  };
  const combineChat=(legacy,modern,{after=0,before=Infinity,limit=60}={})=>{
    const seen=new Set();return [...legacy,...modern].filter(v=>{
      if(!v?.id||seen.has(v.id))return false;seen.add(v.id);
      const time=Date.parse(v.createdAt)||0;return time>(after||0)&&time<before;
    }).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))||String(a.id).localeCompare(String(b.id)))
      .slice(after?0:-limit,after?limit:undefined);
  };
  if(m==="GET"&&p==="/api/learning/messaging/realtime-ticket"){
    if(realtimeConfigError)return learningFail('Realtime configuration unavailable. Check server settings.',503);
    if(!realtimeConfig||!chatDb)return learningFail('Realtime is not enabled on this deployment.',503);
    if(!rateLimit(request,'realtime-ticket:'+uid,24,60000))return learningFail('Too many connection requests.',429);
    const other=shortWords(url.searchParams.get('with'),100);
    const communityId=shortWords(url.searchParams.get('community'),100);
    if(Boolean(other)===Boolean(communityId))return learningFail('Choose exactly one study conversation.');
    let room;
    if(other){
      const part=partners.find(x=>x.status==='accepted'&&[x.from,x.to].includes(uid)&&[x.from,x.to].includes(other));
      const blocked=studyBlocks.some(x=>[x.from,x.to].includes(uid)&&[x.from,x.to].includes(other));
      if(!part||blocked)return learningFail('An accepted, unblocked partnership is required.',403);
      room=chatRoom('private',uid,other);await chatDb.syncRoomMembers(room,[part.from,part.to]);
    }else{
      const c=d.learningCommunities.find(x=>x.id===communityId&&x.members.includes(uid));
      if(!c)return learningFail('Community membership is required.',403);
      room=chatRoom('community',communityId);await chatDb.syncRoomMembers(room,c.members);
    }
    const signed=signRealtimeToken(realtimeConfig,uid);
    return json({enabled:true,transport:'websocket',
      url:realtimeConfig.source.replace(/^https:/,'wss:')+'/realtime/v1/websocket',
      key:realtimeConfig.key,topic:realtimeTopic(room),
      token:signed.token,expiresAt:signed.expiresAt},200,{'Cache-Control':'no-store'});
  }
  if(m==="GET"&&p==="/api/learning/messaging/status"){
    if(chatDb){
      // Verify schema availability, not just presence of environment settings.
      await chatDb.list("c:gb-chat-readiness",{limit:1});
      if(directory)await directory.searchDirectory(uid,'',0,1);
      return json({configured:true,backend:"supabase",ready:true,transport:realtimeConfig?'websocket':'incremental-polling',metadataStore:directoryEnabled?'sql-authoritative':realtimeConfig?'sql-mirror':'legacy'});
    }
    return json({configured:false,backend:"legacy-blob",ready:true,transport:"incremental-polling",metadataStore:"legacy"});
  }
  // One authenticated read/response replaces six separate student-page reads.
  // Each array is filtered by this user's ID; no private cross-account data leaks.
  if(m==="GET"&&p==="/api/learning/bootstrap"){
    const space=spaceAccessLevel(url,user);
    if(!space)return learningFail("Premium space requires an activated account.",403);
    const badges=learningBadges(badgeView,uid);
    const resources=learningResources(d,user,space);
    const plans=d.learningPlans.filter(x=>x.userId===uid).sort((a,b)=>a.date.localeCompare(b.date)).map(x=>({...x,resource:resources.find(r=>r.id===x.resourceId&&r.type===x.resourceType)||null}));
    return json({
      overview:{counts:{mistakes:d.learningMistakes.filter(x=>x.userId===uid&&!x.mastered).length,saved:d.learningSaved.filter(x=>x.userId===uid).length,plans:d.learningPlans.filter(x=>x.userId===uid&&!x.completed).length,partners:partners.filter(x=>x.status==="accepted"&&[x.from,x.to].includes(uid)).length},badges,hub:{linked:d.learningLinks.some(x=>x.userId===uid&&hubActiveLink(x)),linkedDevices:d.learningLinks.filter(x=>x.userId===uid&&hubActiveLink(x)).length,maxDevices:2,enabled:!!hubSecret()}},
      mistakes:d.learningMistakes.filter(x=>x.userId===uid).slice(-300).reverse(),
      plans,
      saved:d.learningSaved.filter(x=>x.userId===uid).slice(-300).reverse(),
      badges,
      resources
    });
  }
  if(m==="GET"&&p==="/api/learning/overview")return json({counts:{mistakes:d.learningMistakes.filter(x=>x.userId===uid&&!x.mastered).length,saved:d.learningSaved.filter(x=>x.userId===uid).length,plans:d.learningPlans.filter(x=>x.userId===uid&&!x.completed).length,partners:partners.filter(x=>x.status==="accepted"&&[x.from,x.to].includes(uid)).length},badges:learningBadges(badgeView,uid),hub:{linked:d.learningLinks.some(x=>x.userId===uid&&hubActiveLink(x)),linkedDevices:d.learningLinks.filter(x=>x.userId===uid&&hubActiveLink(x)).length,maxDevices:2,enabled:!!hubSecret()}});
  if(m==="GET"&&p==="/api/learning/resources"){
    const space=spaceAccessLevel(url,user);
    if(!space)return learningFail("Premium space requires an activated account.",403);
    return json(learningResources(d,user,space));
  }
  if(m==="GET"&&p==="/api/learning/badges")return json(learningBadges(badgeView,uid));
  if(m==="GET"&&p==="/api/learning/mistakes")return json(d.learningMistakes.filter(x=>x.userId===uid).slice(-300).reverse());
  if(m==="DELETE"&&p==="/api/learning/mistakes"){
    const x=await readJSON(request).catch(()=>({}));
    const quizId=shortWords(x.quizId||"",100);
    const before=d.learningMistakes.length;
    d.learningMistakes=d.learningMistakes.filter(row=>{
      if(row.userId!==uid)return true;
      if(!quizId)return false;
      // Allow a student to remove all mistakes from a specific CBT without
      // touching their other CBTs. Never select entries owned by other users.
      return !((row.source==="assessment_hub")&&([row.quizId,row.testId,row.cbtId,row.attemptId].some(value=>String(value||"")===quizId)));
    });
    const removed=before-d.learningMistakes.length;if(removed)await save(d);
    return json({ok:true,removed});
  }
  if(m==="POST"&&p==="/api/learning/mistakes"){
    const x=await readJSON(request),q=learningQuestionInput(x);
    if(!q)return learningFail("Enter the subject and a question (at least eight characters).");
    const owned=d.learningMistakes.filter(y=>y.userId===uid);
    if(owned.length>=LEARNING_MAX.mistakes)return learningFail("Mistake Notebook is full. Remove an older entry first.",409);
    const record={id:crypto.randomUUID(),userId:uid,source:"manual",sourceId:"",...q,selectedIndex:null,mastered:false,createdAt:now,updatedAt:now};
    d.learningMistakes.push(record);await save(d);return json(record,201);
  }
  if(m==="PATCH"&&/^\/api\/learning\/mistakes\/[^/]+$/.test(p)){
    const item=learningOwner(d.learningMistakes,p.split("/").pop(),uid);if(!item)return learningFail("Notebook entry not found.",404);
    const x=await readJSON(request);if(typeof x.mastered!=="boolean")return learningFail("Specify mastered as true or false.");
    item.mastered=x.mastered;item.updatedAt=now;await save(d);return json(item);
  }
  if(m==="DELETE"&&/^\/api\/learning\/mistakes\/[^/]+$/.test(p)){
    const n=d.learningMistakes.length;d.learningMistakes=d.learningMistakes.filter(x=>x.id!==p.split("/").pop()||x.userId!==uid);
    if(d.learningMistakes.length===n)return learningFail("Notebook entry not found.",404);
    await save(d);return json({ok:true});
  }
  if(m==="GET"&&p==="/api/learning/saved")return json(d.learningSaved.filter(x=>x.userId===uid).slice(-300).reverse());
  if(m==="POST"&&p==="/api/learning/saved"){
    const x=await readJSON(request);
    const q=x.source==="battle"?learningQuestionFromBattle(d,uid,shortWords(x.roomId,90),shortWords(x.questionId,100)):learningQuestionInput(x);
    if(!q)return learningFail("Question unavailable. Battle questions may only be saved after the match ends.",403);
    if(x.source!=="battle"&&x.source&&x.source!=="manual")return learningFail("This question source cannot be submitted by a student.");
    const own=d.learningSaved.filter(y=>y.userId===uid);
    if(own.length>=LEARNING_MAX.saved)return learningFail("Saved Questions is full. Remove an older entry first.",409);
    const key=q.sourceId||"";
    if(key&&own.some(y=>y.sourceId===key))return learningFail("You have already saved this question.",409);
    const item={id:crypto.randomUUID(),userId:uid,source:q.source||"manual",sourceId:key,...q,createdAt:now};
    d.learningSaved.push(item);await save(d);return json(item,201);
  }
  if(m==="DELETE"&&/^\/api\/learning\/saved\/[^/]+$/.test(p)){
    const n=d.learningSaved.length;d.learningSaved=d.learningSaved.filter(x=>x.userId!==uid||x.id!==p.split("/").pop());
    if(n===d.learningSaved.length)return learningFail("Saved question not found.",404);await save(d);return json({ok:true});
  }
  if(m==="GET"&&p==="/api/learning/plans"){
    const resources=learningResources(d,user);return json(d.learningPlans.filter(x=>x.userId===uid).sort((a,b)=>a.date.localeCompare(b.date)).map(x=>({...x,resource:resources.find(r=>r.id===x.resourceId&&r.type===x.resourceType)||null})));
  }
  if(m==="POST"&&p==="/api/learning/plans"){
    const x=await readJSON(request),title=shortWords(x.title,150),date=String(x.date||""),type=STUDY_ACTIVITY_TYPES.has(x.type)?x.type:"study";
    if(!title||!learningDate(date))return learningFail("Enter an activity title and valid date (YYYY-MM-DD).");
    if(d.learningPlans.filter(y=>y.userId===uid).length>=LEARNING_MAX.plans)return learningFail("You have reached the study-plan limit.",409);
    const resourceType=["cbt","material","video"].includes(x.resourceType)?x.resourceType:"";
    const resourceId=shortWords(x.resourceId,100);
    if(resourceId&&!learningResources(d,user).some(r=>r.id===resourceId&&r.type===resourceType))return learningFail("Selected resource is unavailable.",404);
    const item={id:crypto.randomUUID(),userId:uid,title,date,time:/^([01]\d|2[0-3]):[0-5]\d$/.test(x.time)?x.time:"",type,subject:shortWords(x.subject||"",80),resourceType:resourceId?resourceType:"",resourceId:resourceId||"",completed:false,createdAt:now,updatedAt:now};
    d.learningPlans.push(item);await save(d);return json(item,201);
  }
  if(m==="PATCH"&&/^\/api\/learning\/plans\/[^/]+$/.test(p)){
    const item=learningOwner(d.learningPlans,p.split("/").pop(),uid);if(!item)return learningFail("Study activity not found.",404);
    const x=await readJSON(request);
    if(x.completed!==undefined){if(typeof x.completed!=="boolean")return learningFail("Invalid completion value.");item.completed=x.completed;}
    if(x.title!==undefined){if(!shortWords(x.title,150))return learningFail("Activity title is required.");item.title=shortWords(x.title,150);}
    if(x.date!==undefined){if(!learningDate(x.date))return learningFail("Invalid date.");item.date=x.date;}
    item.updatedAt=now;await save(d);return json(item);
  }
  if(m==="DELETE"&&/^\/api\/learning\/plans\/[^/]+$/.test(p)){
    const n=d.learningPlans.length;d.learningPlans=d.learningPlans.filter(x=>x.userId!==uid||x.id!==p.split("/").pop());
    if(n===d.learningPlans.length)return learningFail("Study activity not found.",404);await save(d);return json({ok:true});
  }
  if(m==="POST"&&p==="/api/learning/partners/presence"){
    // SQL presence updates one indexed student row; it must not rewrite the
    // entire shared Blob every 45 seconds when thousands of learners are online.
    if(directory){await directory.touchStudent(uid);return json({ok:true});}
    // Legacy mode preserves the previous presence behaviour unchanged.
    if(Date.now()-Number(user.lastSeenAt||0)>45000){user.lastSeenAt=Date.now();await save(d);}
    return json({ok:true});
  }
  if(m==="GET"&&p==="/api/learning/partners/explore"){
    if(!rateLimit(request,"partner-explore:"+uid,35,60000))return learningFail("Too many requests.",429);
    const query=shortWords(url.searchParams.get("q"),50).toLowerCase();
    const offset=Math.max(0,Math.min(10000,Number(url.searchParams.get("offset"))||0));
    if(directory){
      const result=await directory.searchDirectory(uid,query,offset,40);
      return json({...result,students:(result.students||[]).map(u=>({...u,avatar:validAvatar(u.avatar)}))});
    }
    const rows=d.users.filter(u=>mayExploreStudent(d,uid,u)&&(!query||String(u.username||"").toLowerCase().includes(query)||String(u.name||"").toLowerCase().includes(query)))
      .sort((a,b)=>Number(b.lastSeenAt||0)-Number(a.lastSeenAt||0)||String(a.username).localeCompare(String(b.username)));
    return json({students:rows.slice(offset,offset+40).map(userLearningPublic),total:rows.length,hasMore:offset+40<rows.length});
  }
  if(m==="GET"&&p==="/api/learning/partners/search"){
    const query=shortWords(url.searchParams.get("q"),50).toLowerCase();if(query.length<2)return json([]);
    if(!rateLimit(request,"partner-search:"+uid,40,60000))return learningFail("Too many searches. Try again shortly.",429);
    if(directory){
      const result=await directory.searchDirectory(uid,query,0,12);
      return json((result.students||[]).map(u=>({...u,avatar:validAvatar(u.avatar)})));
    }
    return json(d.users.filter(u=>mayExploreStudent(d,uid,u)&&(String(u.username||"").toLowerCase().includes(query)||String(u.name||"").toLowerCase().includes(query))).slice(0,12).map(userLearningPublic));
  }
  if(m==="GET"&&p==="/api/learning/partners"){
    const received=d.learningMessages.filter(msg=>msg.to===uid&&!msg.deliveredAt&&!msg.deletedAt);
    if(received.length){for(const msg of received)msg.deliveredAt=now;await save(d);}
    // Only the old messages require a central-data write for delivery; new
    // SQL messages receive their delivery receipts in an indexed DB operation.
    if(chatDb)await chatDb.deliver(uid);
    const inbox=chatDb?await chatDb.inbox(uid):[];
    const inboxMap=new Map(inbox.map(row=>[row.peer,row]));
    const sqlPeerProfiles=directory?await directory.getStudentProfiles(partners.map(x=>x.from===uid?x.to:x.from)):[];
    const sqlPeers=new Map(sqlPeerProfiles.map(x=>[x.id,{...x,avatar:validAvatar(x.avatar)}]));
    const items=partners.filter(x=>[x.from,x.to].includes(uid)).map(x=>{const other=x.from===uid?x.to:x.from;
      const msgs=d.learningMessages.filter(y=>[y.from,y.to].includes(uid)&&[y.from,y.to].includes(other));
      const oldLast=msgs.at(-1),fresh=inboxMap.get(other)||{};
      const newLast=fresh.lastMessage;
      const last=!newLast?oldLast:!oldLast?newLast:(String(newLast.createdAt)>String(oldLast.createdAt)?newLast:oldLast);
      return {...x,person:sqlPeers.get(other)||userLearningPublic(d.users.find(u=>u.id===other)||{id:"",name:"Unavailable",username:"",avatar:""}),direction:x.from===uid?"sent":"received",
        lastMessage:last?{id:last.id,text:last.deletedAt?"":last.text,deletedAt:last.deletedAt||null,createdAt:last.createdAt}:null,
        unreadCount:msgs.filter(y=>y.to===uid&&!y.readAt&&!y.deletedAt&&!(y.deletedFor||[]).includes(uid)).length+Number(fresh.unreadCount||0)};
    });
    return json(items);
  }
  if(m==="POST"&&p==="/api/learning/partners/request"){
    if(!rateLimit(request,"partner-request:"+uid,20,60*60*1000))return learningFail("Too many partnership requests.",429);
    const x=await readJSON(request),other=d.users.find(u=>u.id===x.userId&&u.status==="active");
    if(!other||other.id===uid)return learningFail("Student unavailable.",404);
    if(studyBlocks.some(b=>(b.from===uid&&b.to===other.id)||(b.to===uid&&b.from===other.id)))return learningFail("Partnership is unavailable.",403);
    const existing=partners.find(y=>[y.from,y.to].includes(uid)&&[y.from,y.to].includes(other.id));
    if(existing)return learningFail("A request or partnership already exists.",409);
    if(partners.filter(y=>[y.from,y.to].includes(uid)&&y.status!=="declined").length>=30)return learningFail("Partnership limit reached.",409);
    if(directory){const result=await sqlMutate('request',{other:other.id});
      return result.error?learningFail(result.error,result.status):json(result,201);}
    const item={id:crypto.randomUUID(),from:uid,to:other.id,status:"pending",createdAt:now,updatedAt:now};d.learningPartners.push(item);await save(d);await syncPartner(item);return json(item,201);
  }
  if(m==="POST"&&/^\/api\/learning\/partners\/[^/]+\/respond$/.test(p)){
    const item=partners.find(x=>x.id===p.split("/")[4]&&x.to===uid&&x.status==="pending");
    if(!item)return learningFail("Request not found.",404);
    const x=await readJSON(request);if(typeof x.accept!=="boolean")return learningFail("Choose accept or decline.");
    if(directory){const result=await sqlMutate('respond',{id:item.id,accept:x.accept});
      return result.error?learningFail(result.error,result.status):json({ok:true,status:result.status});}
    item.status=x.accept?"accepted":"declined";item.updatedAt=now;await save(d);await syncPartner(item);return json({ok:true,status:item.status});
  }
  if(m==="DELETE"&&/^\/api\/learning\/partners\/[^/]+$/.test(p)){
    const item=partners.find(x=>x.id===p.split("/")[4]&&[x.from,x.to].includes(uid));if(!item)return learningFail("Partnership not found.",404);
    if(directory){const result=await sqlMutate('remove',{id:item.id});
      return result.error?learningFail(result.error,result.status):json({ok:true});}
    d.learningPartners=partners.filter(x=>x.id!==item.id);await save(d);
    if(realtimeConfig){await chatDb.syncRoomMembers(chatRoom('private',item.from,item.to),[]);await chatDb.removePartnership(item.id);}
    return json({ok:true});
  }
  if(m==="POST"&&p==="/api/learning/partners/block"){
    const x=await readJSON(request),target=d.users.find(u=>u.id===x.userId);
    if(!target||target.id===uid)return learningFail("Student not found.",404);
    if(directory){const result=await sqlMutate('block',{other:target.id});
      if(result.error)return learningFail(result.error,result.status);
      // Keep legacy moderation for non-migrated EduSpace sections. SQL blocks
      // are already committed, even if this compatibility save fails.
      if(!d.learningBlocks.some(b=>b.from===uid&&b.to===target.id)){
        d.learningBlocks.push({id:crypto.randomUUID(),from:uid,to:target.id,createdAt:now});
        d.learningPartners=d.learningPartners.filter(y=>![y.from,y.to].includes(uid)||![y.from,y.to].includes(target.id));
        await save(d);
      }
      return json({ok:true});
    }
    if(!studyBlocks.some(b=>b.from===uid&&b.to===target.id))d.learningBlocks.push({id:crypto.randomUUID(),from:uid,to:target.id,createdAt:now});
    const cancelled=partners.filter(x=>[x.from,x.to].includes(uid)&&[x.from,x.to].includes(target.id));
    d.learningPartners=partners.filter(x=>![x.from,x.to].includes(uid)||![x.from,x.to].includes(target.id));
    await save(d);
    if(realtimeConfig)for(const part of cancelled){await chatDb.syncRoomMembers(chatRoom('private',part.from,part.to),[]);await chatDb.removePartnership(part.id);}
    return json({ok:true});
  }
  if(m==="GET"&&p==="/api/learning/partners/goals"){
    const other=shortWords(url.searchParams.get("with"),100);
    if(!partners.some(x=>x.status==="accepted"&&[x.from,x.to].includes(uid)&&[x.from,x.to].includes(other)))return learningFail("Active partnership required.",403);
    return json(d.learningPartnerGoals.filter(x=>[x.from,x.to].includes(uid)&&[x.from,x.to].includes(other)).slice(-30));
  }
  if(m==="POST"&&p==="/api/learning/partners/goals"){
    const x=await readJSON(request),other=shortWords(x.to,100),title=shortWords(x.title,160),date=String(x.date||"");
    if(!partners.some(y=>y.status==="accepted"&&[y.from,y.to].includes(uid)&&[y.from,y.to].includes(other)))return learningFail("Accepted study partnership required.",403);
    if(!title||!learningDate(date))return learningFail("Enter a shared goal and a valid deadline.");
    if(d.learningPartnerGoals.filter(y=>[y.from,y.to].includes(uid)&&[y.from,y.to].includes(other)).length>=30)return learningFail("Shared goal limit reached.",409);
    const goal={id:crypto.randomUUID(),from:uid,to:other,title,date,completedBy:[],createdAt:now};
    d.learningPartnerGoals.push(goal);await save(d);return json(goal,201);
  }
  if(m==="PATCH"&&/^\/api\/learning\/partners\/goals\/[^/]+$/.test(p)){
    const goal=d.learningPartnerGoals.find(y=>y.id===p.split("/")[5]&&[y.from,y.to].includes(uid));
    if(!goal)return learningFail("Shared goal not found.",404);
    if(!partners.some(y=>y.status==="accepted"&&[y.from,y.to].includes(uid)&&[y.from,y.to].includes(goal.from)&&[y.from,y.to].includes(goal.to)))return learningFail("Active partnership required.",403);
    const x=await readJSON(request);if(typeof x.completed!=="boolean")return learningFail("Invalid goal completion value.");
    goal.completedBy=(goal.completedBy||[]).filter(y=>y!==uid);if(x.completed)goal.completedBy.push(uid);
    await save(d);return json(goal);
  }
  // Private conversation endpoints. Client IDs prevent duplicate sends on reconnection;
  // read receipts only advance when the recipient explicitly opens the conversation.
  const privatePair=other=>partners.some(x=>x.status==="accepted"&&[x.from,x.to].includes(uid)&&[x.from,x.to].includes(other))
    &&!studyBlocks.some(x=>[x.from,x.to].includes(uid)&&[x.from,x.to].includes(other));
  const pairMessages=other=>d.learningMessages.filter(x=>[x.from,x.to].includes(uid)&&[x.from,x.to].includes(other));
  const visibleMsg=msg=>({ ...msg,text:msg.deletedAt?"":msg.text,reactions:Array.isArray(msg.reactions)?msg.reactions:[],replyTo:msg.replyTo||"" });
  if(m==="GET"&&p==="/api/learning/partners/messages"){
    const other=shortWords(url.searchParams.get("with"),100);
    if(!privatePair(other))return learningFail("Active partnership required.",403);
    const after=Date.parse(url.searchParams.get("after")||"")||0;
    const before=Date.parse(url.searchParams.get("before")||"")||Infinity;
    const count=Math.min(100,Math.max(1,Number(url.searchParams.get("limit"))||60));
    const pair=pairMessages(other).filter(x=>!(x.deletedFor||[]).includes(uid));
    const filtered=after?pair.filter(x=>Date.parse(x.createdAt)>after):pair.filter(x=>Date.parse(x.createdAt)<before);
    const changed=Date.parse(url.searchParams.get("changedAfter")||"")||0;
    if(changed){
      const legacy=pair.filter(x=>[x.createdAt,x.editedAt,x.readAt,x.deliveredAt,x.deletedAt]
        .some(t=>t&&Date.parse(t)>changed)).map(visibleMsg);
      const modern=chatDb?await chatDb.changes(chatRoom("private",uid,other),changed):[];
      return json(combineChat(legacy,modern.filter(x=>!(x.deletedFor||[]).includes(uid)),{limit:100}));
    }
    const legacy=(after?filtered.slice(0,count):filtered.slice(-count)).map(visibleMsg);
    if(!chatDb)return json(legacy);
    const modern=await chatDb.list(chatRoom("private",uid,other),{after,before,limit:count});
    return json(combineChat(legacy,modern.filter(x=>!(x.deletedFor||[]).includes(uid)),{after,before,limit:count}));
  }
  if(m==="POST"&&p==="/api/learning/partners/messages/read"){
    const other=shortWords((await readJSON(request)).with,100);
    if(!privatePair(other))return learningFail("Active partnership required.",403);
    const unread=d.learningMessages.filter(x=>x.from===other&&x.to===uid&&!x.readAt&&!x.deletedAt);
    if(unread.length){for(const x of unread){x.deliveredAt ||=now;x.readAt=now;}await save(d);}
    if(chatDb){const r=await chatDb.read(chatRoom("private",uid,other),uid);return json({ok:true,count:unread.length+Number(r.count||0),readAt:r.readAt||now});}
    return json({ok:true,count:unread.length,readAt:now});
  }
  if(m==="POST"&&p==="/api/learning/partners/messages"){
    if(!rateLimit(request,"partner-message:"+uid,50,60000))return learningFail("Too many messages. Try again shortly.",429);
    const x=await readJSON(request),other=shortWords(x.to,100),message=shortWords(x.text,1000);
    if(!message)return learningFail("Message cannot be empty.");
    if(!privatePair(other))return learningFail("Only accepted study partners can exchange messages.",403);
    const clientId=shortWords(x.clientId||"",75);
    if(clientId){const previous=d.learningMessages.find(y=>y.clientId===clientId&&y.from===uid&&y.to===other);if(previous)return json(visibleMsg(previous));}
    const replyTo=shortWords(x.replyTo||"",100);
    if(replyTo&&!pairMessages(other).some(y=>y.id===replyTo)&&!(chatDb&&await chatDb.get(chatRoom("private",uid,other),replyTo)))return learningFail("Reply target unavailable.",404);
    if(chatDb){const saved=await chatDb.send(chatRoom("private",uid,other),uid,other,message,clientId,replyTo);return json(visibleMsg(saved),201);}
    const item={id:crypto.randomUUID(),clientId,from:uid,to:other,text:message,replyTo,createdAt:now,reactions:[],deletedFor:[],deliveredAt:null,readAt:null};
    d.learningMessages.push(item);
    const pair=pairMessages(other);
    if(pair.length>500){const oldest=new Set(pair.slice(0,pair.length-500).map(y=>y.id));d.learningMessages=d.learningMessages.filter(y=>!oldest.has(y.id));}
    await save(d);return json(visibleMsg(item),201);
  }
  if((m==="PATCH"||m==="DELETE")&&/^\/api\/learning\/partners\/messages\/[^/]+$/.test(p)){
    const id=p.split("/").pop();
    const item=d.learningMessages.find(y=>y.id===id);
    if(!item&&chatDb){
      // The room key comes from an actual accepted, unblocked partnership,
      // never from a client-supplied room name.
      const peers=partners.filter(y=>y.status==="accepted"&&[y.from,y.to].includes(uid));
      for(const part of peers){const other=part.from===uid?part.to:part.from;
        if(!privatePair(other))continue;
        const room=chatRoom("private",uid,other),found=await chatDb.get(room,id);
        if(!found)continue;
        if(m==="PATCH"){
          if(found.from!==uid)return learningFail("Only your own messages may be edited.",403);
          const text=shortWords((await readJSON(request)).text,1000);if(!text)return learningFail("Message cannot be empty.");
          return json({ok:true,message:await chatDb.act(room,id,uid,"edit",text)});
        }
        const scope=shortWords(url.searchParams.get("scope")||"me",15);
        if(scope==="everyone"&&found.from!==uid)return learningFail("You can only withdraw your own messages.",403);
        return json({ok:true,message:await chatDb.act(room,id,uid,scope==="everyone"?"delete_everyone":"delete_me")});
      }
    }
    if(!item||![item.from,item.to].includes(uid)||!privatePair(item.from===uid?item.to:item.from))return learningFail("Message unavailable.",404);
    if(m==="PATCH"){
      if(item.from!==uid||item.deletedAt)return learningFail("Only your own messages may be edited.",403);
      if(Date.now()-Date.parse(item.createdAt)>15*60000)return learningFail("Messages can be edited within 15 minutes of sending.",409);
      const value=shortWords((await readJSON(request)).text,1000);if(!value)return learningFail("Message cannot be empty.");
      item.text=value;item.editedAt=now;
    } else {
      const scope=shortWords(url.searchParams.get("scope")||"me",15);
      if(scope==="everyone"){
        if(item.from!==uid)return learningFail("You can only withdraw your own messages.",403);
        if(Date.now()-Date.parse(item.createdAt)>48*3600000)return learningFail("Withdraw messages within 48 hours.",409);
        item.text="";item.deletedAt=now;item.reactions=[];
      }else{item.deletedFor=Array.from(new Set([...(item.deletedFor||[]),uid]));}
    }
    await save(d);return json({ok:true,message:visibleMsg(item)});
  }
  if(m==="POST"&&/^\/api\/learning\/partners\/messages\/[^/]+\/react$/.test(p)){
    return learningFail('Message reactions are no longer available.',410);
    const id=p.split("/")[5],item=d.learningMessages.find(y=>y.id===id);
    if(!item&&chatDb){
      const peers=partners.filter(y=>y.status==="accepted"&&[y.from,y.to].includes(uid));
      for(const part of peers){const other=part.from===uid?part.to:part.from;
        if(!privatePair(other))continue;
        const room=chatRoom("private",uid,other),found=await chatDb.get(room,id);
        if(!found)continue;
        const emoji=String((await readJSON(request)).emoji||"");
        if(emoji&&!['👍','❤️','😂','🎉','👏','🙏'].includes(emoji))return learningFail("Choose an available reaction.");
        const result=await chatDb.act(room,id,uid,"react",emoji);return json({ok:true,reactions:result.reactions});
      }
    }
    if(!item||item.deletedAt||!privatePair(item.from===uid?item.to:item.from))return learningFail("Message unavailable.",404);
    const emoji=String((await readJSON(request)).emoji||"");
    if(emoji&&!['👍','❤️','😂','🎉','👏','🙏'].includes(emoji))return learningFail("Choose an available reaction.");
    item.reactions=(item.reactions||[]).filter(r=>r.userId!==uid);
    if(emoji)item.reactions.push({userId:uid,emoji});await save(d);
    return json({ok:true,reactions:item.reactions});
  }
  if(m==='POST'&&p==='/api/learning/partners/report-student'){
    if(!rateLimit(request,'partner-profile-report:'+uid,5,86400000))return learningFail('Report limit reached.',429);
    const input=await readJSON(request),other=shortWords(input.userId,100),reason=shortWords(input.reason,300);
    if(!other||other===uid||!d.users.some(x=>x.id===other))return learningFail('Student unavailable.',404);
    if(!reason||reason.length<5)return learningFail('Please describe the concern.');
    const item={id:crypto.randomUUID(),reporter:uid,from:other,to:uid,reason,
      messageId:'',text:'Student profile report (no private messages disclosed)',status:'open',createdAt:now};
    d.learningReports.push(item);await save(d);return json({ok:true},201);
  }
  if(m==="POST"&&p==="/api/learning/partners/report"){
    if(!rateLimit(request,"partner-report:"+uid,10,86400000))return learningFail("Report limit reached.",429);
    const x=await readJSON(request);let msg=d.learningMessages.find(y=>y.id===x.messageId&&y.to===uid);
    if(!msg&&chatDb){
      for(const part of partners.filter(y=>y.status==="accepted"&&[y.from,y.to].includes(uid))){
        const other=part.from===uid?part.to:part.from;
        if(!privatePair(other))continue;
        const found=await chatDb.get(chatRoom("private",uid,other),x.messageId);
        if(found&&found.to===uid){msg=found;break;}
      }
    }
    if(!msg)return learningFail("Only messages received by you can be reported.",403);
    if(d.learningReports.some(y=>y.messageId===msg.id&&y.reporter===uid))return learningFail("Message already reported.",409);
    const item={id:crypto.randomUUID(),reporter:uid,messageId:msg.id,from:msg.from,to:msg.to,reason:shortWords(x.reason||"Inappropriate message",300),text:msg.text,status:"open",createdAt:now};
    d.learningReports.push(item);await save(d);return json({ok:true},201);
  }
  if(m==='POST'&&/^\/api\/learning\/communities\/[a-f0-9-]{36}\/picture$/.test(p)){
    if(!rateLimit(request,'community-picture:'+uid,10,3600000))return learningFail('Too many uploads.',429);
    const id=p.split('/')[4];let allowed=(d.learningCommunities||[]).some(c=>c.id===id&&c.lead===uid);
    if(String(env('GB_STUDY_COMMUNITY_BACKEND')||'legacy').toLowerCase()==='supabase'&&chatDb){
      const communities=await chatDb.communitySnapshot(uid,{id,mine:true,limit:1});
      allowed=communities.some(c=>c.id===id&&c.lead===uid||c.id===id&&c.isLead===true);
    }
    if(!allowed)return learningFail('Only the Community Lead can change the picture.',403);
    const encoded=String((await readJSON(request)).webp||'');
    if(!/^data:image\/webp;base64,[A-Za-z0-9+/=]+$/.test(encoded)||encoded.length>100000)return learningFail('Please use a compressed WebP image below 60 KB.');
    const bytes=Buffer.from(encoded.slice('data:image/webp;base64,'.length),'base64');
    if(bytes.length>60000||bytes.length<60||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP')return learningFail('Invalid picture.');
    await store().set(`community-photos/${id}`,bytes);return json({ok:true,picture:'/api/community-photo/'+id});
  }
  // v12.17: SQL is community membership authority ONLY after reviewed staging
  // backfill. Never silently use legacy permissions when SQL mode is enabled.
  const sqlCommunityMode=String(env('GB_STUDY_COMMUNITY_BACKEND')||'legacy').toLowerCase();
  if(!['legacy','supabase'].includes(sqlCommunityMode))return learningFail('Invalid community backend.',503);
  const sqlCommunities=sqlCommunityMode==='supabase';
  if(sqlCommunities&&(!directoryEnabled||!chatDb||String(env('GB_STUDY_COMMUNITY_CUTOVER_APPROVED'))!=='true'))
    return learningFail('Community SQL cutover requires verified backfill and approval.',503);
  if(sqlCommunities&&p.startsWith('/api/learning/communities')){
    const parts=p.split('/');
    const targetId=parts[4]||'';
    // Mutations happen in a single database transaction. Only the server
    // supplies the authenticated actor; browser-provided actor IDs are ignored.
    let action='',input={};
    if(m==='POST'&&p==='/api/learning/communities'){
      if(!rateLimit(request,'community-create:'+uid,5,86400000))return learningFail('Community creation limit reached.',429);
      input=await readJSON(request);action='create';
    }else if(m==='POST'&&p==='/api/learning/communities/join'){
      input=await readJSON(request);action='join';
    }else if(m==='POST'&&/^\/api\/learning\/communities\/[^/]+\/requests$/.test(p)){
      input=await readJSON(request);action='respond';
    }else if(m==='DELETE'&&/^\/api\/learning\/communities\/[^/]+\/members\/[^/]+$/.test(p)){
      action='remove';
    }else if(m==='POST'&&/^\/api\/learning\/communities\/[^/]+\/lead$/.test(p)){
      input=await readJSON(request);action='lead';
    }else if(m==='POST'&&/^\/api\/learning\/communities\/[^/]+\/leave$/.test(p)){
      action='leave';
    }
    if(action){
      const id=action==='join'?shortWords(input.id,100):targetId;
      const target=action==='remove'?parts[6]:shortWords(input.userId,100);
      try{
        const result=await chatDb.communityMutation(action,uid,{id,target,
          accept:!!input.accept,payload:{...input,name:shortWords(input.name,75),
            subject:shortWords(input.subject||'General Study',60),
            description:shortWords(input.description,240),code:shortWords(input.code,100)}});
        if(action==='create'){
          const created=(await chatDb.communitySnapshot(uid,{id:result.id,mine:true,limit:1}))[0];
          return json(created?{...created,members:created.members.length,capacity:20,
            isLead:true,joined:true,pending:false,leaderName:user.name}:result,201);
        }
        if(action==='leave'&&result.deleted&&chatDb)await chatDb.purgeCommunity(chatRoom('community',id));
        return json(result);
      }catch(e){
        if(['23505','23514'].includes(e.dbCode))return learningFail(e.message,409);
        if(e.dbCode==='42501')return learningFail(e.message,403);
        if(e.dbCode==='P0002')return learningFail(e.message,404);
        throw e; // Fail closed; do not revive revoked legacy membership.
      }
    }
    // Membership read from SQL for both viewing and message authorisation.
    // The returned record contains no invite code for outsiders.
    const mine=(p==='/api/learning/communities'&&url.searchParams.get('mine')==='1')||!!targetId;
    d.learningCommunities=await chatDb.communitySnapshot(uid,{
      id:targetId,query:p==='/api/learning/communities'?shortWords(url.searchParams.get('q'),70):'',mine,limit:150
    });
  }
  // Study Communities: a separate study group, not a public chat-room directory.
  // Invitations use a random code; private communities are not listed publicly.
  const communityPublic=c=>({id:c.id,name:c.name,description:c.description,subject:c.subject,visibility:c.visibility,
    joinMode:c.joinMode,lead:c.lead,leaderName:d.users.find(u=>u.id===c.lead)?.name||"Community Lead",
    members:c.members.length,capacity:20,pending:(c.pending||[]).includes(uid),joined:c.members.includes(uid),
    isLead:c.lead===uid,createdAt:c.createdAt,inviteCode:c.members.includes(uid)?c.inviteCode:undefined});
  const communityById=id=>d.learningCommunities.find(c=>c.id===id);
  const communityAuth=id=>{const c=communityById(id);return c&&c.members.includes(uid)?c:null;};
  if(m==="GET"&&p==="/api/learning/communities"){
    const query=shortWords(url.searchParams.get("q"),70).toLowerCase();
    const mine=url.searchParams.get("mine")==="1";
    const rows=d.learningCommunities.filter(c=>mine?c.members.includes(uid)||(c.pending||[]).includes(uid):c.visibility==="public")
      .filter(c=>!query||[c.name,c.subject,c.description].some(x=>String(x||"").toLowerCase().includes(query)))
      .slice(-150).reverse().map(communityPublic);
    return json({communities:rows});
  }
  if(m==="POST"&&p==="/api/learning/communities"){
    if(!rateLimit(request,"community-create:"+uid,5,86400000))return learningFail("Community creation limit reached.",429);
    if(d.learningCommunities.filter(c=>c.lead===uid).length>=5)return learningFail("You may lead up to five communities.",409);
    const x=await readJSON(request),name=shortWords(x.name,75),description=shortWords(x.description||"",240),subject=shortWords(x.subject||"General Study",60);
    if(name.length<4)return learningFail("Community name must contain at least four characters.");
    const c={id:crypto.randomUUID(),name,description,subject,visibility:x.visibility==="private"?"private":"public",joinMode:x.joinMode==="approval"?"approval":"open",lead:uid,members:[uid],pending:[],inviteCode:crypto.randomBytes(9).toString("base64url"),createdAt:now,updatedAt:now};
    d.learningCommunities.push(c);await save(d);await syncCommunity(c);return json(communityPublic(c),201);
  }
  if(m==="POST"&&p==="/api/learning/communities/join"){
    const x=await readJSON(request),c=communityById(shortWords(x.id,100));
    if(!c)return learningFail("Community unavailable.",404);
    const invited=x.code&&String(x.code)===c.inviteCode;
    if(c.visibility==="private"&&!invited)return learningFail("A valid invitation is required.",403);
    if(c.members.includes(uid))return json({ok:true,status:"joined"});
    if(c.members.length>=20)return learningFail("This community is full (20/20).",409);
    if((c.pending||[]).includes(uid))return json({ok:true,status:"pending"});
    if(c.joinMode==="approval"&&!invited){c.pending.push(uid);c.updatedAt=now;await save(d);await syncCommunity(c);return json({ok:true,status:"pending"});}
    c.members.push(uid);c.updatedAt=now;await save(d);await syncCommunity(c);return json({ok:true,status:"joined"});
  }
  if(m==="GET"&&/^\/api\/learning\/communities\/[^/]+$/.test(p)){
    const c=communityAuth(p.split("/")[4]);if(!c)return learningFail("Join the community to view its details.",403);
    return json({...communityPublic(c),memberProfiles:c.members.map(id=>userLearningPublic(d.users.find(u=>u.id===id))).filter(u=>u.id),pendingProfiles:c.lead===uid?(c.pending||[]).map(id=>userLearningPublic(d.users.find(u=>u.id===id))).filter(u=>u.id):[]});
  }
  if(m==="POST"&&/^\/api\/learning\/communities\/[^/]+\/requests$/.test(p)){
    const c=communityById(p.split("/")[4]);if(!c||c.lead!==uid)return learningFail("Community Lead access required.",403);
    const x=await readJSON(request),memberId=shortWords(x.userId,100);
    if(!(c.pending||[]).includes(memberId))return learningFail("Join request unavailable.",404);
    c.pending=c.pending.filter(id=>id!==memberId);
    if(x.accept){if(c.members.length>=20)return learningFail("This community has reached 20 members.",409);c.members.push(memberId);}
    c.updatedAt=now;await save(d);await syncCommunity(c);return json({ok:true});
  }
  if(m==="DELETE"&&/^\/api\/learning\/communities\/[^/]+\/members\/[^/]+$/.test(p)){
    const part=p.split("/"),c=communityById(part[4]),target=part[6];
    if(!c||c.lead!==uid)return learningFail("Community Lead permission required.",403);
    if(target===uid)return learningFail("Transfer Community Lead before leaving.",409);
    if(!c.members.includes(target))return learningFail("Member unavailable.",404);
    c.members=c.members.filter(id=>id!==target);c.updatedAt=now;await save(d);await syncCommunity(c);return json({ok:true});
  }
  if(m==="POST"&&/^\/api\/learning\/communities\/[^/]+\/lead$/.test(p)){
    const c=communityById(p.split("/")[4]);if(!c||c.lead!==uid)return learningFail("Only the Community Lead can transfer leadership.",403);
    const x=await readJSON(request);if(!c.members.includes(x.userId)||x.userId===uid)return learningFail("Choose an existing member.");
    c.lead=x.userId;c.updatedAt=now;await save(d);await syncCommunity(c);return json({ok:true});
  }
  if(m==="POST"&&/^\/api\/learning\/communities\/[^/]+\/leave$/.test(p)){
    const c=communityAuth(p.split("/")[4]);if(!c)return learningFail("Community unavailable.",404);
    if(c.lead===uid&&c.members.length>1)return learningFail("Transfer Community Lead before leaving.",409);
    if(c.lead===uid){d.learningCommunities=d.learningCommunities.filter(v=>v.id!==c.id);d.learningCommunityMessages=d.learningCommunityMessages.filter(v=>v.communityId!==c.id);}
    else c.members=c.members.filter(v=>v!==uid);
    await save(d);
    if(c.lead===uid&&chatDb)await chatDb.purgeCommunity(chatRoom("community",c.id));
    if(realtimeConfig){
      if(c.lead===uid){await chatDb.syncRoomMembers(chatRoom('community',c.id),[]);await chatDb.removeCommunity(c.id);}
      else await syncCommunity(c);
    }
    return json({ok:true});
  }
  if(m==="GET"&&/^\/api\/learning\/communities\/[^/]+\/messages$/.test(p)){
    const c=communityAuth(p.split("/")[4]);if(!c)return learningFail("Community membership required.",403);
    const after=Date.parse(url.searchParams.get("after")||"")||0,before=Date.parse(url.searchParams.get("before")||"")||Infinity;
    const list=d.learningCommunityMessages.filter(v=>v.communityId===c.id&&(v.createdAt&&Date.parse(v.createdAt)<before)&&(!after||Date.parse(v.createdAt)>after));
    const changed=Date.parse(url.searchParams.get("changedAfter")||"")||0;
    if(changed){
      const legacy=d.learningCommunityMessages.filter(v=>v.communityId===c.id&&[v.createdAt,v.editedAt,v.deletedAt]
        .some(t=>t&&Date.parse(t)>changed));
      const modern=chatDb?await chatDb.changes(chatRoom("community",c.id),changed):[];
      return json(combineChat(legacy,modern,{limit:100}).map(v=>({...v,fromName:d.users.find(u=>u.id===v.from)?.name||"Student"})));
    }
    const legacy=(after?list.slice(0,100):list.slice(-60)).map(v=>({...v,fromName:d.users.find(u=>u.id===v.from)?.name||"Student",reactions:v.reactions||[]}));
    if(!chatDb)return json(legacy);
    const modern=await chatDb.list(chatRoom("community",c.id),{after,before,limit:after?100:60});
    return json(combineChat(legacy,modern.map(v=>({...v,fromName:d.users.find(u=>u.id===v.from)?.name||"Student"})),{after,before,limit:after?100:60}));
  }
  if(m==="POST"&&/^\/api\/learning\/communities\/[^/]+\/messages$/.test(p)){
    const c=communityAuth(p.split("/")[4]);if(!c)return learningFail("Community membership required.",403);
    if(!rateLimit(request,"community-message:"+uid,45,60000))return learningFail("Please slow down your messages.",429);
    const x=await readJSON(request),text=shortWords(x.text,1000),clientId=shortWords(x.clientId||"",75);
    if(!text)return learningFail("Write a message first.");
    const prior=clientId&&d.learningCommunityMessages.find(y=>y.from===uid&&y.communityId===c.id&&y.clientId===clientId);
    if(prior)return json(prior);
    const replyTo=shortWords(x.replyTo||"",100);
    if(replyTo&&!d.learningCommunityMessages.some(y=>y.communityId===c.id&&y.id===replyTo)&&!(chatDb&&await chatDb.get(chatRoom("community",c.id),replyTo)))return learningFail("Reply target unavailable.",404);
    if(chatDb){const item=await chatDb.send(chatRoom("community",c.id),uid,null,text,clientId,replyTo);
      return json({...item,communityId:c.id,fromName:user.name},201);}
    const item={id:crypto.randomUUID(),communityId:c.id,from:uid,text,clientId,replyTo,createdAt:now,reactions:[]};
    d.learningCommunityMessages.push(item);
    const ids=d.learningCommunityMessages.filter(v=>v.communityId===c.id);
    if(ids.length>500){const discard=new Set(ids.slice(0,ids.length-500).map(v=>v.id));d.learningCommunityMessages=d.learningCommunityMessages.filter(v=>!discard.has(v.id));}
    c.updatedAt=now;await save(d);return json({...item,fromName:user.name},201);
  }
  if((m==="PATCH"||m==="DELETE")&&/^\/api\/learning\/communities\/[^/]+\/messages\/[^/]+$/.test(p)){
    const [, , , ,id,,messageId]=p.split("/"),c=communityAuth(id);
    const item=c&&d.learningCommunityMessages.find(v=>v.communityId===id&&v.id===messageId);
    if(!item&&c&&chatDb){
      const room=chatRoom("community",id),found=await chatDb.get(room,messageId);
      if(!found)return learningFail("Message unavailable.",404);
      if(m==="PATCH"){
        if(found.from!==uid)return learningFail("Only the author may edit a message.",403);
        const text=shortWords((await readJSON(request)).text,1000);if(!text)return learningFail("Write a message first.");
        return json({ok:true,message:await chatDb.act(room,messageId,uid,"edit",text)});
      }
      if(found.from!==uid&&c.lead!==uid)return learningFail("Only the author or Community Lead may remove messages.",403);
      return json({ok:true,message:await chatDb.act(room,messageId,uid,"delete_everyone","",c.lead===uid)});
    }
    if(!item)return learningFail("Message unavailable.",404);
    if(item.from!==uid&&c.lead!==uid)return learningFail("Only the author or Community Lead may remove messages.",403);
    if(m==="PATCH"){
      if(item.from!==uid)return learningFail("Only the author may edit a message.",403);
      if(Date.now()-Date.parse(item.createdAt)>15*60000)return learningFail("Messages may be edited within 15 minutes.",409);
      const text=shortWords((await readJSON(request)).text,1000);if(!text)return learningFail("Write a message first.");
      item.text=text;item.editedAt=now;
    }else{item.text="";item.deletedAt=now;item.reactions=[];}
    await save(d);return json({ok:true,message:item});
  }
  if(m==="POST"&&/^\/api\/learning\/communities\/[^/]+\/messages\/[^/]+\/react$/.test(p)){
    return learningFail('Message reactions are no longer available.',410);
    const parts=p.split("/"),c=communityAuth(parts[4]);
    const item=c&&d.learningCommunityMessages.find(v=>v.communityId===c.id&&v.id===parts[6]);
    if(!item&&c&&chatDb){
      const room=chatRoom("community",c.id),found=await chatDb.get(room,parts[6]);
      if(!found||found.deletedAt)return learningFail("Message unavailable.",404);
      const emoji=String((await readJSON(request)).emoji||"");
      if(emoji&&!['👍','❤️','😂','🎉','👏','🙏'].includes(emoji))return learningFail("Choose an available reaction.");
      const changed=await chatDb.act(room,parts[6],uid,"react",emoji);
      return json({ok:true,reactions:changed.reactions});
    }
    if(!item||item.deletedAt)return learningFail("Message unavailable.",404);
    const emoji=String((await readJSON(request)).emoji||"");
    if(emoji&&!['👍','❤️','😂','🎉','👏','🙏'].includes(emoji))return learningFail("Choose an available reaction.");
    item.reactions=(item.reactions||[]).filter(v=>v.userId!==uid);if(emoji)item.reactions.push({userId:uid,emoji});
    await save(d);return json({ok:true,reactions:item.reactions});
  }
  if(m==="GET"&&p==="/api/learning/integration/status"){
    const link=d.learningLinks.find(x=>x.userId===uid&&hubActiveLink(x));
    const activeLinks=d.learningLinks.filter(x=>x.userId===uid&&hubActiveLink(x));
    return json({provider:"assessment_hub",linked:activeLinks.length>0,linkedDevices:activeLinks.length,maxDevices:2,configured:!!hubSecret(),lastSync:activeLinks.map(x=>x.lastSync).filter(Boolean).sort().at(-1)||null,mode:activeLinks.length?"linked":hubSecret()?"ready_to_link":"awaiting_hub_setup"});
  }
  if(m==="POST"&&p==="/api/learning/integration/link-code"){
    if(!hubSecret())return learningFail("Assessment Hub connection is not enabled yet. Your learning tools remain available.",503);
    if(!rateLimit(request,"hub-link:"+uid,5,3600000))return learningFail("Too many link requests.",429);
    const code=crypto.randomBytes(9).toString("base64url").toUpperCase();
    const linked=d.learningLinks.filter(x=>x.userId===uid&&hubActiveLink(x));
    if(linked.length>=2)return learningFail("Two Assessment Hub devices are already linked. Unlink an existing device before adding another.",409);
    // Keep existing active links; only replace an expired/unconsumed invitation.
    d.learningLinks=d.learningLinks.filter(x=>x.userId!==uid||hubActiveLink(x)||x.generation!==HUB_LINK_GENERATION);
    const record={generation:HUB_LINK_GENERATION,id:crypto.randomUUID(),userId:uid,externalUserId:"",codeHash:crypto.createHash("sha256").update(code).digest("hex"),expiresAt:Date.now()+15*60000,lastSync:null};
    d.learningLinks.push(record);await save(d);
    return json({code,expiresInSeconds:900,linkedDevices:linked.length,maxDevices:2});
  }
  return learningFail("Learning Centre endpoint not found.",404);
}

// This receiver stays dormant until an explicit, shared server-to-server secret
// is configured on both platforms. A signed link is mandatory before CBT events.
async function assessmentHubReceiver(request,d,p,m){
  if(m!=="POST")return learningFail("Method not supported.",405);
  const secret=hubSecret();if(!secret||secret.length<32)return learningFail("Assessment Hub integration is not configured.",503);
  const bytes=await readRawBody(request);if(bytes.length>300000)return learningFail("Event too large.",413);
  const stamp=request.headers.get("x-gb-hub-timestamp")||"",signature=request.headers.get("x-gb-hub-signature")||"";
  const ts=Number(stamp);if(!/^\d{10}$/.test(stamp)||Math.abs(Math.floor(Date.now()/1000)-ts)>300)return learningFail("Invalid event timestamp.",401);
  const expected="sha256="+crypto.createHmac("sha256",secret).update(stamp+".").update(bytes).digest("hex");
  if(!/^sha256=[a-f0-9]{64}$/i.test(signature)||!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(signature.toLowerCase())))return learningFail("Invalid event signature.",401);
  let x;try{x=JSON.parse(bytes.toString("utf8"));}catch{return learningFail("Invalid JSON.");}
  const eventId=shortWords(x.eventId,100),kind=shortWords(x.type,80),externalUserId=shortWords(x.externalUserId,120);
  if(!eventId||!externalUserId)return learningFail("Event ID and Assessment Hub user ID are required.");
  if(d.learningEvents.some(e=>e.id===eventId))return json({ok:true,duplicate:true});
  const now=learningNow();let userId="";
  if(kind==="account.unlinked"){
    const link=d.learningLinks.find(l=>hubActiveLink(l)&&l.externalUserId===externalUserId);
    if(link){userId=link.userId;link.externalUserId="";link.lastSync=null;}
    // Unlinking keeps the student's CBT attempt history, mistakes and saved questions.
  }else if(kind==="account.linked"){
    const code=shortWords(x.linkCode,40);const hash=crypto.createHash("sha256").update(code).digest("hex");
    const link=d.learningLinks.find(l=>l.generation===HUB_LINK_GENERATION&&l.codeHash===hash&&l.expiresAt>Date.now());
    if(!link||!code)return learningFail("Link code expired or invalid.",403);
    if(d.learningLinks.some(l=>hubActiveLink(l)&&l.externalUserId===externalUserId&&l.userId!==link.userId))return learningFail("Assessment Hub account already linked.",409);
    if(d.learningLinks.filter(l=>l.userId===link.userId&&hubActiveLink(l)).length>=2)return learningFail("This EduSpace account already has two linked Assessment Hub devices.",409);
    userId=link.userId;link.externalUserId=externalUserId;link.codeHash="";link.expiresAt=0;link.lastSync=now;
  }else{
    const link=d.learningLinks.find(l=>hubActiveLink(l)&&l.externalUserId===externalUserId&&l.userId&&d.users.some(u=>u.id===l.userId&&u.status==="active"));
    if(!link)return learningFail("Assessment Hub account must be linked first.",403);
    userId=link.userId;
    if(kind==="cbt.completed"){
      const attempt=shortWords(x.attemptId,140),questions=Array.isArray(x.questions)?x.questions:[];
      if(!attempt||!questions.length||questions.length>250)return learningFail("Completed CBT attempt is invalid.");
      for(const source of questions){
        const questionId=shortWords(source.questionId,150),q=learningQuestionInput(source),selected=Number(source.selectedIndex);
        if(!questionId||!q||q.correctIndex===null||!Number.isInteger(selected)||selected< -1||selected>=q.options.length)return learningFail("Completed CBT question data is invalid.");
      }
      for(const source of questions){
        if(source.selectedIndex===source.correctIndex)continue;
        const q=learningQuestionInput(source),sourceId="assessment_hub:"+shortWords(source.questionId,150);
        const existing=d.learningMistakes.find(y=>y.userId===userId&&y.sourceId===sourceId);
        if(existing){existing.selectedIndex=source.selectedIndex;existing.updatedAt=now;existing.mastered=false;
          existing.quizId=shortWords(x.quizId||x.testId||existing.quizId||"",100);
          existing.quizTitle=shortWords(x.quizTitle||x.testTitle||existing.quizTitle||"",180);continue;}
        if(d.learningMistakes.filter(y=>y.userId===userId).length>=LEARNING_MAX.mistakes)break;
        d.learningMistakes.push({id:crypto.randomUUID(),userId,source:"assessment_hub",sourceId,attemptId:attempt,
          quizId:shortWords(x.quizId||x.testId||"",100),quizTitle:shortWords(x.quizTitle||x.testTitle||"",180),
          ...q,selectedIndex:source.selectedIndex,mastered:false,createdAt:now,updatedAt:now});
      }
      if(!d.learningAssessments.some(z=>z.userId===userId&&z.attemptId===attempt))d.learningAssessments.push({id:crypto.randomUUID(),userId,attemptId:attempt,subject:shortWords(x.subject,80),total:questions.length,correct:questions.filter(q=>q.selectedIndex===q.correctIndex).length,createdAt:now});
    }else if(kind==="question.bookmarked"){
      const questionId=shortWords(x.questionId,150),q=learningQuestionInput(x);
      if(!questionId||!q)return learningFail("Bookmarked question is invalid.");
      const sourceId="assessment_hub:"+questionId;
      if(!d.learningSaved.some(y=>y.userId===userId&&y.sourceId===sourceId)&&d.learningSaved.filter(y=>y.userId===userId).length<LEARNING_MAX.saved)d.learningSaved.push({id:crypto.randomUUID(),userId,source:"assessment_hub",sourceId,...q,createdAt:now});
    }else if(kind==="question.unbookmarked"){
      const sourceId="assessment_hub:"+shortWords(x.questionId,150);
      d.learningSaved=d.learningSaved.filter(y=>y.userId!==userId||y.sourceId!==sourceId);
    }else return learningFail("Unsupported event type.");
    link.lastSync=now;
  }
  d.learningEvents.push({id:eventId,type:kind,userId,createdAt:now});
  if(d.learningEvents.length>10000)d.learningEvents=d.learningEvents.slice(-10000);
  await save(d);return json({ok:true});
}

async function handler(request) {
  const url = new URL(request.url);
  const p = normalisePath(url.pathname);
  const m = request.method;
  try {
    // Thumbnail CDN fallback: this public endpoint does not read student data,
    // so it must run before the large Blob bootstrap. Only an 11-character
    // YouTube ID is accepted; the upstream host is fixed (not user supplied).
    if (m === "GET" && /^\/api\/video-thumbnail\/[A-Za-z0-9_-]{11}$/.test(p)) {
      const videoId=p.slice("/api/video-thumbnail/".length);
      try {
        const upstream=await fetch(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, {
          headers:{accept:"image/jpeg"},
          signal:AbortSignal.timeout(5000)
        });
        const contentType=(upstream.headers.get("content-type")||"").toLowerCase();
        const size=Number(upstream.headers.get("content-length")||0);
        if(!upstream.ok || !contentType.startsWith("image/") || size>2000000) {
          return new Response("Video thumbnail unavailable",{status:502,headers:{"cache-control":"no-store"}});
        }
        const image=await upstream.arrayBuffer();
        if(image.byteLength<100 || image.byteLength>2000000) {
          return new Response("Video thumbnail unavailable",{status:502,headers:{"cache-control":"no-store"}});
        }
        return new Response(image,{status:200,headers:{
          "content-type":contentType,"cache-control":"public, max-age=86400, s-maxage=604800",
          "x-content-type-options":"nosniff"
        }});
      }catch{
        return new Response("Video thumbnail unavailable",{status:502,headers:{"cache-control":"no-store"}});
      }
    }
    let bootstrapData = null;
    if (m !== "OPTIONS" && p !== "/api/health" && p !== "/api/status") {
      bootstrapData = await load();
      const live = await activeRuntimeHandler(bootstrapData.appUpdate);
      if (live && live !== handler) return live(request);
    }
    if (p.startsWith("/api/integrations/assessment-hub/")) return assessmentHubReceiver(request,await load(),p,m);
    if (p.startsWith("/api/learning/")) {
      const d=bootstrapData || await load();
      const a=await auth(request,"student",d);if(!a)return learningFail("Student login required.",401);
      return await learningHandler(request,d,a,p,m,url);
    }
    if(m==="GET"&&p==="/api/admin/learning/reports"){
      const d=await load();if(!await adminAuth(request,d))return learningFail("Admin login required.",401);
      return json(d.learningReports.slice(-150).reverse());
    }
    if(m==="PATCH"&&/^\/api\/admin\/learning\/reports\/[^/]+$/.test(p)){
      const d=await load();if(!await adminAuth(request,d))return learningFail("Admin login required.",401);
      const item=d.learningReports.find(x=>x.id===p.split("/").pop());if(!item)return learningFail("Report not found.",404);
      const x=await readJSON(request);if(!["open","resolved"].includes(x.status))return learningFail("Invalid report status.");
      item.status=x.status;await save(d);return json(item);
    }
    if (m === "GET" && p === "/api/health") return json({ ok: true, time: Date.now() });
    if (m === "GET" && p === "/api/jamb-countdown") {
      const d = await load();
      return json({ target: d.settings?.jambDate || DEFAULT_JAMB_DATE, label: d.settings?.jambLabel || "JAMB UTME", updatedAt: d.settings?.jambUpdatedAt || null, now: Date.now() });
    }
    if (p === "/api/echo") {
      // Deployment probe: reports what the function actually received for a
      // JSON body, without ever echoing the payload itself.
      if (m !== "POST") return json({ error: "Send a POST request to /api/echo." }, 405);
      const bytes = await readRawBody(request);
      let parsed = false, parseError = null, keys = [];
      try {
        const value = JSON.parse(stripBom(bytes.toString("utf8")).trim() || "{}");
        parsed = true;
        keys = value && typeof value === "object" ? Object.keys(value).slice(0, 20) : [];
      } catch (error) { parseError = error.message; }
      return json({
        ok: parsed,
        method: m,
        contentType: request.headers?.get?.("content-type") || null,
        bytes: bytes.length,
        parsed,
        keys,
        parseError,
        preParsedBody: Boolean(preParsedBody(request)),
        runtime: "edgeone-node-function",
        time: Date.now()
      }, parsed ? 200 : 400);
    }
    if (m === "GET" && p === "/api/status") {
      try {
        const d = await load();
        return json({
          ok: true,
          storage: storageReport(),
          adminConfigured: adminConfigured(d),
          students: d.users.length,
          contentPackVersion: d.settings.contentPackVersion || null,
          time: Date.now()
        });
      } catch (error) {
        return json({ ok: false, storage: storageReport(), error: error?.message || "Storage is unavailable." }, error?.storageUnavailable ? 503 : 500);
      }
    }
    if (m === "OPTIONS") return new Response(null, { status: 204, headers: { "allow": "GET,POST,PATCH,DELETE,OPTIONS" } });
    if(m==='GET'&&p==='/api/support/whatsapp'){
      // Keep the support recipient out of page markup. WhatsApp will still
      // disclose the number inside its own conversation interface.
      const number=String(env('GB_SUPPORT_WHATSAPP_NUMBER')||'2348156767275').replace(/\D/g,'');
      if(!/^\d{10,15}$/.test(number))return json({error:'Support contact is unavailable.'},503);
      const category=String(url.searchParams.get('context')||'help');
      const message=category==='suspended'? 'Hello Gifted Brainz EduSpace Support. My account has been suspended. I would like to request assistance.':category==='password'?'Hello Gifted Brainz EduSpace Support. I need help resetting my password.':'Hello Gifted Brainz EduSpace Support. I need assistance with my account or learning activities.';
      return new Response(null,{status:302,headers:{'location':'https://wa.me/'+number+'?text='+encodeURIComponent(message),'cache-control':'no-store','referrer-policy':'no-referrer'}});
    }
    if (m === "GET" && p === "/api/subjects/catalog") {
      const d=await load();return json(platformSubjects(d));
    }
    if (m === "GET" && p === "/api/subjects") {
      const studentToken = await auth(request, "student");
      if (studentToken) {
        const d = await load(), u = d.users.find(u2 => u2.id === studentToken.sub);
        return json(studentSubjects(u));
      }
      const adminToken = await verifyToken(bearer(request), "admin");
      if (adminToken) return json(platformSubjects(await load()));
      return json({ error: "Authentication required." }, 401);
    }
    if (m === "GET" && p === "/api/app/update") {
      const d = await load();
      const up = d.appUpdate;
      if (!up) return json({ available: false });
      return json({ available: true, version: up.version, notes: up.notes, date: up.date, assetVersion: up.assetVersion || null });
    }
    if (m === "GET" && p === "/api/app/runtime/manifest") {
      const d = await load();
      const up = d.appUpdate;
      if (!up?.manifestKey) return json({ available: false }, 404);
      const manifest = await store().get(up.manifestKey, { type: "json" });
      if (!manifest) return json({ error: "Update manifest not found." }, 404);
      return json({ version: manifest.version, files: runtimeManifestFiles(manifest).map((f) => ({ path: f.path, contentType: f.contentType, size: f.size, sha256: f.sha256 })) });
    }
    if (m === "GET" && p.startsWith("/api/app/runtime/file/")) {
      const raw = decodeURIComponent(p.slice("/api/app/runtime/file/".length));
      const safe = safeRuntimePath(raw);
      if (!safe) return json({ error: "File not found." }, 404);
      const d = await load(), up = d.appUpdate;
      if (!up?.manifestKey) return json({ error: "No live update." }, 404);
      const manifest = await store().get(up.manifestKey, { type: "json" });
      const f = runtimeManifestFiles(manifest).find((x) => x.path === safe);
      if (!f) return json({ error: "File not found." }, 404);
      const obj = await store().get(f.key, { type: "arrayBuffer" });
      if (!obj) return json({ error: "File not found." }, 404);
      return new Response(obj, { status: 200, headers: { "content-type": f.contentType, "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" } });
    }
    if (m === "GET" && p === "/api/subjects/icons") {
      const d=await load();return json(d.battleSubjects.map(s=>({name:s.name,emoji:subjectEmoji(s.emoji||"📚")})));
    }
    // Public profile pictures are tiny, normalised WebP images kept outside
    // the central JSON record. Account credentials are never served here.
    if(m==='GET'&&/^\/api\/(profile-photo|community-photo)\/[a-f0-9-]{36}$/.test(p)){
      const parts=p.split('/'),id=parts[3],kind=parts[2]==='community-photo'?'community-photos':'profile-photos';
      const content=await store().get(`${kind}/${id}`,{type:'arrayBuffer'});
      if(!content)return json({error:'Picture unavailable.'},404);
      return new Response(content,{status:200,headers:{'content-type':'image/webp','cache-control':'public,max-age=300','x-content-type-options':'nosniff'}});
    }
    if(m==='POST'&&p==='/api/me/photo'){
      const a=await auth(request,'student');if(!a)return json({error:'Authentication required.'},401);
      if(!rateLimit(request,'profile-photo:'+a.sub,12,3600000))return json({error:'Too many uploads. Please try later.'},429);
      const input=await readJSON(request),encoded=String(input.webp||'');
      if(!/^data:image\/webp;base64,[A-Za-z0-9+/=]+$/.test(encoded)||encoded.length>100000)return json({error:'Please upload a compressed WebP image under 60 KB.'},400);
      const buffer=Buffer.from(encoded.slice('data:image/webp;base64,'.length),'base64');
      if(buffer.length>60000||buffer.length<60||buffer.toString('ascii',0,4)!=='RIFF'||buffer.toString('ascii',8,12)!=='WEBP')return json({error:'Invalid picture format or file size.'},400);
      const d=await load(),u=d.users.find(user=>user.id===a.sub&&user.status==='active');if(!u)return json({error:'Account unavailable.'},403);
      await store().set(`profile-photos/${u.id}`,buffer);
      u.avatar='custom-'+u.id;await save(d);await mirrorStudyStudentProfile(u);
      return json({ok:true,user:publicUser(u),avatar:u.avatar});
    }
    if (m === "GET" && p === "/api/avatars") return json(GB_AVATARS);
    if (m === "POST" && p === "/api/register") {
      if (!rateLimit(request, "register", 8, 9e5)) return json({ error: "Too many registration attempts. Try again later." }, 429);
      const x = await readJSON(request), d = await load();
      const name = cleanString(x.name, 120), email = cleanString(x.email, 160).toLowerCase();
      const username = cleanString(x.username, 80), password = String(x.password ?? "");
      const whatsapp = cleanString(x.whatsapp, 30).replace(/[\s()\-]/g, "");
      const subjectCheck = validateSelectedSubjects(x.selectedSubjects,platformSubjects(d));
      if (subjectCheck.error) return json({ error: subjectCheck.error }, 400);
      if (!name || !email || !username || !whatsapp || password.length < 8)
        return json({ error: "Name, email, WhatsApp number, username and a password of at least 8 characters are required." }, 400);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
      if (!/^\+?[1-9]\d{7,14}$/.test(whatsapp)) return json({ error: "Enter a valid WhatsApp number with country code, e.g. +2348012345678." }, 400);
      if (!/^[a-zA-Z0-9._-]{3,80}$/.test(username)) return json({ error: "Username may only contain letters, numbers, dot, dash and underscore." }, 400);
      if (d.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) return json({ error: "That username is already in use." }, 409);
      if (d.users.some((u) => u.email === email)) return json({ error: "An account with that email already exists." }, 409);
      // Accounts are merged by id, so two simultaneous registrations of the same
      // username or email would both be kept and login would then pick whichever
      // duplicate came first. Reserve the normalised username and email in
      // shared storage first; only the request that wins both reservations may
      // create the account.
      const userId = crypto.randomUUID();
      const reservations = [];
      const reserve = async (kind, value) => {
        const key = `unique/${kind}/${encodeURIComponent(value)}`;
        const claim = await store().get(key, { type: "json" }).catch(() => null);
        if (claim?.userId && claim.userId !== userId) {
          const stillActive = d.users.some((u) => u.id === claim.userId && (kind === "username"
            ? String(u.username || "").toLowerCase() === String(value).toLowerCase()
            : String(u.email || "").toLowerCase() === String(value).toLowerCase()));
          if (!stillActive) await store().delete(key).catch(() => {});
        }
        const created = await store().setJSON(key, { userId, at: new Date().toISOString() }, { onlyIfNew: true }).catch(() => null);
        if (created && created.modified === false) return false;
        reservations.push(key);
        return true;
      };
      const releaseReservations = async () => {
        for (const key of reservations) await store().delete(key).catch(() => {});
      };
      if (!await reserve("username", username.toLowerCase())) {
        await releaseReservations();
        return json({ error: "That username is already in use." }, 409);
      }
      if (!await reserve("email", email)) {
        await releaseReservations();
        return json({ error: "An account with that email already exists." }, 409);
      }
      const ph = passwordHash(password);
      const user = { id: userId, name, username, email, whatsapp, selectedSubjects: subjectCheck.subjects, passwordHash: ph.hash, passwordSalt: ph.salt, status: "active", approval: "approved", approved: true, avatar:validAvatar(x.avatar), accountType: "free", firstLogin: true, joined: (/* @__PURE__ */ new Date()).toISOString(), requestedAt: (/* @__PURE__ */ new Date()).toISOString() };
      d.users.push(user);
      try {
        await save(d);
      } catch (error) {
        await releaseReservations();
        throw error;
      }
      await mirrorStudyStudentProfile(user);
      return json({
        pending: false,
        user: publicUser(user), token: await issue(user.id,"student",user.tokenVersion||1),
        message: "Welcome to Gifted Brainz! Your free account is ready."
      });
    }
    // The public verification lookup was retired with instant registration.
    // Do not expose whether a username or email exists through a status endpoint.
    if (m === "GET" && p === "/api/registration-status")
      return json({ error: "Verification is no longer required. New students can log in immediately." }, 410);
    if (m === "POST" && p === "/api/auth/refresh") {
      // A separate, HttpOnly remembered-device cookie renews short-lived access
      // tokens. It is always verified against the current account token version.
      const origin=request.headers.get('origin');
      if(origin&&origin!==new URL(request.url).origin)return json({error:'Invalid request origin.'},403);
      const refresh=await verifyToken(cookieValue(request,'gbRememberSession'),'remember');
      if(!refresh)return json({error:'Your saved sign-in has expired.'},401);
      const d=await load();
      if(!studentTokenValid(d,refresh))return json({error:'Your saved sign-in is no longer valid.'},401);
      const user=d.users.find(x=>x.id===refresh.sub);
      return json({token:await issue(user.id,'student',user.tokenVersion||1),user:publicUser(user)});
    }
    if (m === "POST" && p === "/api/auth/logout") {
      return new Response(JSON.stringify({ok:true}),{status:200,headers:{'content-type':'application/json','set-cookie':'gbRememberSession=; Path=/api/auth; Max-Age=0; HttpOnly; Secure; SameSite=Strict'}});
    }
    if (m === "POST" && p === "/api/login") {
      if (!rateLimit(request, "login", 12, 9e5)) return json({ error: "Too many login attempts. Try again in a few minutes." }, 429);
      const x = await readJSON(request), d = await load();
      const identifier = cleanString(x.username, 80), password = String(x.password ?? "");
      const u = d.users.find((a) => a.username.toLowerCase() === identifier.toLowerCase() || String(a.email || "").toLowerCase() === identifier.toLowerCase());
      if (!u || !verifyPassword(password, u))
        return json({ error: "Invalid username or password." }, 401);
      if (u.status === "suspended") return json({error:"Your Gifted Brainz EduSpace account has been suspended. Access is temporarily restricted. Contact the administrator for assistance.",code:"ACCOUNT_SUSPENDED"},403);
      if (u.status !== "active") return json({error:"This account is currently unavailable. Contact the administrator for assistance."},403);
      if (!u.passwordSalt) {
        const ph = passwordHash(password);
        u.passwordHash = ph.hash;
        u.passwordSalt = ph.salt;
        await save(d);
      }
      await mirrorStudyStudentProfile(u);
      const responseBody=JSON.stringify({user:publicUser(u),token:await issue(u.id,'student',u.tokenVersion||1)});
      const remember=Boolean(x.rememberDevice===true);
      const cookie=remember?`gbRememberSession=${encodeURIComponent(await sign({sub:u.id,role:'remember',v:u.tokenVersion||1,exp:Math.floor(Date.now()/1000)+30*86400}))}; Path=/api/auth; Max-Age=${30*86400}; HttpOnly; Secure; SameSite=Strict`:
        'gbRememberSession=; Path=/api/auth; Max-Age=0; HttpOnly; Secure; SameSite=Strict';
      return new Response(responseBody,{status:200,headers:{'content-type':'application/json','set-cookie':cookie,'cache-control':'no-store'}});
    }
    if (m === "POST" && p === "/api/admin/login") {
      if (!rateLimit(request, "admin-login", 10, 9e5)) return json({ error: "Too many admin login attempts. Try again in a few minutes." }, 429);
      const x = await readJSON(request), d = await load();
      if (!adminConfigured(d)) return json({ error: "Admin credentials are not configured on the server yet." }, 503);
      const username = String(x.username || x.email || "").trim();
      const usernameOk = username.toLowerCase() === adminUsername(d).toLowerCase();
      if (!usernameOk || !adminPasswordOk(d, String(x.password || "")))
        return json({ error: "Invalid admin username or password. Check the credentials and try again." }, 401);
      return json({
        user: { id: "admin", name: "Administrator", username: adminUsername(d), email: adminEmail(d) },
        token: await issue("admin", "admin", d.settings.tokenVersion || 1)
      });
    }
    if (m === "GET" && /^\/api\/results\/[^/]+\/review$/.test(p))
      return json({ error: "This legacy activity-history page is no longer available." }, 410);
    if (m === "GET" && p === "/api/learning-space") {
      const a = await auth(request, "student");
      if (!a) return json({ error: "Authentication required." }, 401);
      const d = await load(), u = d.users.find(v => v.id === a.sub && v.status === "active");
      if (!u) return json({ error: "Account unavailable." }, 401);
      return json({ accountType: isActivatedAccount(u) ? "activated" : "free", canOpenPremium: isActivatedAccount(u) });
    }
    if (m === "GET" && p === "/api/cbt-tests") {
      const a = await auth(request, "student");
      if (!a) return json({ error: "Authentication required." }, 401);
      const d = await load(), u = d.users.find(u2 => u2.id === a.sub);
      if (!u || u.status !== "active") return json({ error: "Account unavailable." }, 401);
      const space = spaceAccessLevel(url,u);
      if (!space) return json({ error: "Premium space requires an activated account." }, 403);
      const allowed = studentSubjects(u);
      const rows = d.cbtTests.filter(t => t.published && allowed.includes(t.subject) && matchesSpace(t,space))
        .sort((x, y) => x.subject.localeCompare(y.subject) || String(x.title).localeCompare(String(y.title)))
         .map(t => {
          const locked = false;
          return { id: t.id, subject: t.subject, title: t.title,
            writeup: locked ? "" : t.writeup, linkUrl: locked ? "" : t.linkUrl,
            linkLabel: locked ? "" : t.linkLabel,
            performanceUrl: locked ? "" : (t.performanceUrl || ""),
            performanceLabel: locked ? "" : (t.performanceLabel || "Check Performance"), accessLevel: t.accessLevel || "public",
            locked, createdAt: t.createdAt };
        });
      return json(rows);
    }
    if (m === "GET" && p === "/api/videos") {
      const a = await auth(request, "student");
      if (!a) return json({ error: "Authentication required." }, 401);
      const d = await load(), u = d.users.find(u2 => u2.id === a.sub);
      if (!u || u.status !== "active") return json({ error: "Account unavailable." }, 401);
      const allowed = studentSubjects(u);
      const rows = d.videos.filter(v => v.published && (allowed.includes(v.subject)||v.subject==="All subjects"))
        .sort((x, y) => x.subject.localeCompare(y.subject) || String(x.title).localeCompare(String(y.title)))
        .map(v => ({ id: v.id, subject: v.subject, title: v.title,
          description: v.description, youtubeUrl: v.youtubeUrl, createdAt: v.createdAt }));
      return json(rows);
    }

    if (p.startsWith("/api/battle/")) {
      const d=bootstrapData || await load();
      const a=await auth(request,"student",d);
      if(!a)return json({error:"Authentication required."},401);
      return battleStudentHandler(request,d,a,p,m,url);
    }

    if (m === "GET" && p === "/api/progress") {
      const a = await auth(request, "student");
      if (!a) return json({ error: "Authentication required." }, 401);
      const d = await load(), u = d.users.find(x => x.id === a.sub);
      if (!u || u.status !== "active") return json({ error: "Account unavailable." }, 401);
      const allowed = studentSubjects(u);
      const requested = cleanString(url.searchParams.get("subject") || "", 80);
      if (requested && !allowed.includes(requested)) return json({ error: `You are not registered for ${requested}.` }, 403);
      const completedIds = new Set(d.progress.filter(x => x.userId === u.id && x.completed === true).map(x => String(x.topicId)));
      const subjects = (requested ? [requested] : allowed).map(subject => {
        const topics = d.topics
          .filter(t => t && String(t.subject || "") === subject && t.id && t.name && !/uncategorized|topic not assigned/i.test(String(t.name)))
          .map(t => ({ id: String(t.id), name: String(t.name), completed: completedIds.has(String(t.id)) }));
        const completed = topics.filter(t => t.completed).length;
        const total = topics.length;
        return { subject, topics, completed, total, percent: total ? Math.round(completed / total * 100) : 0 };
      });
      const completed = subjects.reduce((sum, x) => sum + x.completed, 0);
      const total = subjects.reduce((sum, x) => sum + x.total, 0);
      return json({ subjects, summary: { completed, total, percent: total ? Math.round(completed / total * 100) : 0 } });
    }
    if (m === "POST" && p === "/api/progress") {
      const a = await auth(request, "student");
      if (!a) return json({ error: "Authentication required." }, 401);
      const x = await readJSON(request), d = await load(), u = d.users.find(v => v.id === a.sub);
      if (!u || u.status !== "active") return json({ error: "Account unavailable." }, 401);
      const subject = cleanString(x.subject, 80), topicId = cleanString(x.topicId, 120);
      const guard = assertUserSubject(u, subject); if (guard) return guard;
      if (!topicId || typeof x.completed !== "boolean") return json({ error: "A valid topic and completed status are required." }, 400);
      const topic = d.topics.find(t => String(t.id) === topicId && String(t.subject || "") === subject && !/uncategorized|topic not assigned/i.test(String(t.name || "")));
      if (!topic) return json({ error: "Topic not found for the selected subject." }, 404);
      const existingIndex = d.progress.findIndex(item => item.userId === u.id && String(item.topicId) === topicId);
      if (x.completed) {
        const record = { id: "progress_" + crypto.createHash("sha256").update(`${u.id}|${topicId}`).digest("hex").slice(0, 32), userId: u.id, subject, topicId, completed: true, updatedAt: new Date().toISOString() };
        if (existingIndex >= 0) d.progress[existingIndex] = { ...d.progress[existingIndex], ...record };
        else d.progress.push(record);
      } else if (existingIndex >= 0) {
        d.progress.splice(existingIndex, 1);
      }
      await save(d);
      const topicRows = d.topics.filter(t => t && String(t.subject || "") === subject && t.id && t.name && !/uncategorized|topic not assigned/i.test(String(t.name)));
      const checked = new Set(d.progress.filter(item => item.userId === u.id && item.completed).map(item => String(item.topicId)));
      const completed = topicRows.filter(t => checked.has(String(t.id))).length;
      return json({ ok: true, subject, topicId, completed: !!x.completed, completedCount: completed, total: topicRows.length, percent: topicRows.length ? Math.round(completed / topicRows.length * 100) : 0 });
    }
    if (m === "GET" && p === "/api/dashboard") {
      const a = await auth(request, "student");
      if (!a) return json({ error: "Authentication required." }, 401);
      const d = await load(), u = d.users.find((u2) => u2.id === a.sub);
      if (!u || u.status !== "active") return json({ error: "Account unavailable." }, 401);
      const allowedSubjects = studentSubjects(u);
      const selectedSubjects = allowedSubjects;
      // Study Recommendations are driven by topic completion and study materials
      // for the subjects they have covered the least.
      const completedTopicIds = new Set(d.progress.filter(x => x.userId === u.id && x.completed === true).map(x => String(x.topicId)));
      const recommendations = selectedSubjects.map(subject => {
        const topics = d.topics.filter(t => t && String(t.subject || "") === subject && t.id && t.name && !/uncategorized|topic not assigned/i.test(String(t.name)));
        const completed = topics.filter(t => completedTopicIds.has(String(t.id))).length;
        const total = topics.length;
        const percent = total ? Math.round(completed / total * 100) : 0;
        const materialsCount = d.notes.filter(n => n.published && n.subject === subject && matchesSpace(n,"public")).length;
        const priority = !total ? "Topics coming soon" : percent < 40 ? "High priority — start studying" : percent < 80 ? "Keep studying" : "Maintain your strength";
        return { subject, completed, total, percent, materialsCount, priority };
      }).sort((x, y) => x.percent - y.percent);
      const progressSummary = { completed: recommendations.reduce((s, r) => s + r.completed, 0), total: recommendations.reduce((s, r) => s + r.total, 0) };
      progressSummary.percent = progressSummary.total ? Math.round(progressSummary.completed / progressSummary.total * 100) : 0;
      return json({
        user: publicUser(u),
        // Include plans used by the dashboard reminder to avoid a second database read.
        learningPlans: d.learningPlans.filter(x=>x.userId===u.id).sort((a,b)=>a.date.localeCompare(b.date)).map(x=>({id:x.id,title:x.title,date:x.date,time:x.time,subject:x.subject,completed:x.completed})),
        recommendations,
        progress: progressSummary,
        counts: { materials: d.notes.filter((n) => n.published && matchesSpace(n,"public") && allowedSubjects.includes(n.subject)).length, announcements: d.announcements.filter((a2) => a2.published).length, topics: d.topics.filter(t => t && t.name && !/uncategorized|topic not assigned/i.test(String(t.name))).length, questionBankQuestions: d.questionBank.length,
          battleQuestionCount: d.battleQuestions.length, cbtTests: d.cbtTests.filter(t => t.published && matchesSpace(t,"public") && allowedSubjects.includes(t.subject)).length, videos: d.videos.filter(v => v.published).length }
      });
    }
    if (m === "GET" && p === "/api/notes") {
      const a = await auth(request, "student");
      if (!a) return json({ error: "Authentication required." }, 401);
      const d = await load(), u = d.users.find(u2 => u2.id === a.sub), allowed = studentSubjects(u);
      const space = spaceAccessLevel(url,u);
      if (!space) return json({ error: "Premium space requires an activated account." }, 403);
      return json(d.notes.filter(n => n.published && allowed.includes(n.subject) && matchesSpace(n,space)).map(n => {
        const catalogue = materialCatalogueItem(n, u);
        if (catalogue.locked) return catalogue;
        const { body, ...meta } = catalogue;
        return { ...meta, hasBody: !!body };
      }));
    }
    if (m === "GET" && (p === "/api/materials" || p === "/api/notes/full")) {
      const a = await auth(request, "student");
      if (!a) return json({ error: "Authentication required." }, 401);
      const d = await load(), u = d.users.find(u2 => u2.id === a.sub), allowed = studentSubjects(u);
      const space = spaceAccessLevel(url,u);
      if (!space) return json({ error: "Premium space requires an activated account." }, 403);
      return json(d.notes.filter(n => n.published && allowed.includes(n.subject) && matchesSpace(n,space))
        .sort((x, y) => String(y.createdAt || "").localeCompare(String(x.createdAt || "")))
        .map(n => materialCatalogueItem(n, u)));
    }
    if (m === "GET" && /^\/api\/notes\/[^/]+$/.test(p)) {
      const a = await auth(request, "student");
      if (!a) return json({ error: "Authentication required." }, 401);
      const d = await load(), u = d.users.find(u2 => u2.id === a.sub), n = d.notes.find((n2) => n2.id === p.split("/").pop() && n2.published);
      if (!n) return json({ error: "Material not found." }, 404);
      const subjectGuard = assertUserSubject(u, n.subject); if (subjectGuard) return subjectGuard;
      if (!canAccessLevel(u, n.accessLevel)) return json({ error: "This learning material is reserved for activated accounts. Contact the administrator to activate your account." }, 403);
      return json(n);
    }
    if (m === "PATCH" && p === "/api/me") {
      const a = await auth(request, "student");
      if (!a) return json({ error: "Authentication required." }, 401);
      const x = await readJSON(request), d = await load(), u = d.users.find(u2 => u2.id === a.sub);
      if (!u) return json({ error: "Account unavailable." }, 401);
      const name = cleanString(x.name, 120), username = cleanString(x.username, 80), email = cleanString(x.email, 160).toLowerCase();
      if (username && !/^[a-zA-Z0-9._-]{3,80}$/.test(username)) return json({ error: "Username may only contain letters, numbers, dot, dash and underscore." }, 400);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
      if (username && d.users.some(v => v.id !== u.id && v.username.toLowerCase() === username.toLowerCase())) return json({ error: "That username is already in use." }, 409);
      if (email && d.users.some(v => v.id !== u.id && String(v.email || "").toLowerCase() === email)) return json({ error: "That email is already in use." }, 409);
      // Students manage their own four-subject selection; English remains compulsory.
      const subjectCheck = validateSelectedSubjects(
        x.selectedSubjects !== undefined ? x.selectedSubjects : u.selectedSubjects,
        platformSubjects(d)
      );
      if (subjectCheck.error) return json({ error: subjectCheck.error }, 400);
      if (isActivatedAccount(u) && x.selectedSubjects !== undefined &&
          JSON.stringify(subjectCheck.subjects.slice().sort()) !== JSON.stringify(studentSubjects(u).slice().sort()))
        return json({error:"To update your subjects, contact the administrator."},403);
      if (name) u.name = name;
      if (username) u.username = username;
      if (email) u.email = email;
      if(x.avatar!==undefined)u.avatar=validAvatar(x.avatar);
      u.selectedSubjects = subjectCheck.subjects;
      await save(d);
      await mirrorStudyStudentProfile(u);
      return json({ ok: true, user: publicUser(u) });
    }
    if (m === "POST" && p === "/api/me/password") {
      const a = await auth(request, "student");
      if (!a) return json({ error: "Authentication required." }, 401);
      if (!rateLimit(request, "pwd", 10, 9e5)) return json({ error: "Too many attempts. Try again later." }, 429);
      const x = await readJSON(request), d = await load();
      const u = d.users.find((u2) => u2.id === a.sub);
      if (!u) return json({ error: "Account unavailable." }, 401);
      const next = String(x.newPassword ?? x.password ?? "");
      if (next.length < 8) return json({ error: "The new password must be at least 8 characters." }, 400);
      if (!verifyPassword(String(x.currentPassword ?? ""), u)) return json({ error: "Your current password is not correct." }, 401);
      const ph = passwordHash(next);
      u.passwordHash = ph.hash;
      u.passwordSalt = ph.salt;
      await save(d);
      return json({ ok: true });
    }
    if (m === "POST" && p === "/api/me/delete") {
      const a = await auth(request, "student");
      if (!a) return json({ error: "Authentication required." }, 401);
      if (!rateLimit(request, "delete-account", 5, 9e5)) return json({ error: "Too many deletion attempts. Try again later." }, 429);
      const x = await readJSON(request), d = await load();
      const u = d.users.find((u2) => u2.id === a.sub);
      if (!u) return json({ error: "Account unavailable." }, 401);
      if (cleanString(x.username, 80).toLowerCase() !== String(u.username).toLowerCase() || !verifyPassword(String(x.password || ""), u))
        return json({ error: "The username or password is incorrect. Your account has not been deleted." }, 401);
      d.users = d.users.filter((x2) => x2.id !== u.id);
      d.results = d.results.filter((x2) => x2.userId !== u.id);
      // Purge external chat records first. If that request fails, do not
      // delete the login account and leave inaccessible private messages.
      if(env("GB_CHAT_BACKEND")==="supabase")await createStudyChatStore({GB_CHAT_BACKEND:env("GB_CHAT_BACKEND"),GB_CHAT_SUPABASE_URL:env("GB_CHAT_SUPABASE_URL"),GB_CHAT_SUPABASE_SECRET:env("GB_CHAT_SUPABASE_SECRET"),GB_CHAT_REALTIME_ENABLED:env("GB_CHAT_REALTIME_ENABLED"),GB_STUDY_DIRECTORY_BACKEND:env("GB_STUDY_DIRECTORY_BACKEND"),GB_STUDY_COMMUNITY_BACKEND:env("GB_STUDY_COMMUNITY_BACKEND")}).purgeUser(u.id);
      purgeStudentLearning(d, u.id);
      await save(d);
      await releaseUserUniqueKeys(u);
      return json({ ok: true, deletedUserId: u.id });
    }
    if (m === "GET" && p === "/api/announcements") {
      const a = await auth(request, "student");
      if (!a) return json({ error: "Authentication required." }, 401);
      const d=await load();
      const focus=String(url.searchParams.get('discussion')||'');
      return json(d.announcements.filter(item=>item.published&&(!focus||item.id===focus)).map(item=>({
        ...item,replyCount:(item.replies||[]).length,
        replies:Array.isArray(item.replies)?(focus?item.replies:item.replies.slice(0,5)):[]
      })));
    }
    if(m==="POST" && /^\/api\/announcements\/[^/]+\/replies$/.test(p)){
      const a=await auth(request,"student");
      if(!a)return json({error:"Authentication required."},401);
      if(!rateLimit(request,"announcement-reply:"+a.sub,15,3600000))return json({error:"You have sent several replies. Please try again later."},429);
      const d=await load(),user=d.users.find(u=>u.id===a.sub&&u.status==="active");
      if(!user)return json({error:"Student account unavailable."},403);
      const item=d.announcements.find(x=>x.id===p.split("/")[3]&&x.published);
      if(!item)return json({error:"Announcement not found."},404);
      const input=await readJSON(request);
      const body=cleanString(input.message,1500);
      if(body.length<2)return json({error:"Please write a reply of at least two characters."},400);
      if(!Array.isArray(item.replies))item.replies=[];
      const parentId=cleanString(input.parentId||"",100);
      if(parentId && !(item.replies||[]).some(r=>r.id===parentId))return json({error:"Parent reply not found."},404);
      const reply={id:crypto.randomUUID(),userId:user.id,name:cleanString(user.name||user.username||"Student",100),message:body,createdAt:new Date().toISOString(),parentId,likes:[]};
      item.replies.push(reply);
      if(item.replies.length>250)item.replies=item.replies.slice(-250);
      await save(d);return json({ok:true,reply},201);
    }
    // Nested announcement replies and likes. Access is restricted to active students,
    // and the likes array is keyed by authenticated user IDs (no repeat likes).
    if ((m === "POST" || m === "DELETE") && /^\/api\/announcements\/[^/]+\/replies\/[^/]+\/like$/.test(p)) {
      const authInfo=await auth(request,"student");if(!authInfo)return json({error:"Authentication required."},401);
      const d=await load(),usr=d.users.find(u=>u.id===authInfo.sub&&u.status==="active");
      if(!usr)return json({error:"Student account unavailable."},403);
      const pieces=p.split("/"),item=d.announcements.find(x=>x.id===pieces[3]&&x.published);
      const reply=(item?.replies||[]).find(r=>r.id===pieces[5]);
      if(!reply)return json({error:"Reply not found."},404);
      const likes=Array.isArray(reply.likes)?reply.likes:[];
      reply.likes=m==="POST"?[...new Set([...likes,usr.id])]:likes.filter(id=>id!==usr.id);
      await save(d);return json({ok:true,likes:reply.likes.length,liked:reply.likes.includes(usr.id)});
    }
    if(m==="DELETE"&&/^\/api\/announcements\/[^/]+\/replies\/[^/]+$/.test(p)){
      const student=await auth(request,"student");if(!student)return json({error:"Authentication required."},401);
      const d=await load(),u=d.users.find(x=>x.id===student.sub&&x.status==="active");if(!u)return json({error:"Student account unavailable."},403);
      const pieces=p.split("/"),a=d.announcements.find(x=>x.id===pieces[3]&&x.published),reply=(a?.replies||[]).find(x=>x.id===pieces[5]);
      if(!reply)return json({error:"Reply not found."},404);
      if(reply.userId!==u.id)return json({error:"You can only delete your own replies."},403);
      // Deleting your own reply must never delete another student's reply.
      // Lift direct responses into the removed reply's parent thread.
      for(const child of a.replies)if(child.parentId===reply.id)child.parentId=reply.parentId||"";
      a.replies=a.replies.filter(x=>x.id!==reply.id);
      await save(d);return json({ok:true,removed:1});
    }
    if (m === "POST" && p === "/api/feedback") {
      const a = await auth(request, "student");
      if (!a) return json({ error: "Authentication required." }, 401);
      if (!rateLimit(request, "feedback", 20, 36e5)) return json({ error: "You have sent several messages already. Please try again later." }, 429);
      const x = await readJSON(request), d = await load();
      const u = d.users.find((v) => v.id === a.sub);
      if (!u) return json({ error: "Account not found." }, 404);
      const rating = Math.round(Number(x.rating) || 0);
      const kind = ["feedback", "complaint", "suggestion"].includes(x.kind) ? x.kind : "feedback";
      const subject = cleanString(x.subject, 140);
      const message = cleanString(x.message, 4e3);
      if (rating < 1 || rating > 5) return json({ error: "Please tap between 1 and 5 stars." }, 400);
      if (message.length < 4) return json({ error: "Please tell us a little more so we can act on it." }, 400);
      const entry = {
        id: crypto.randomUUID(),
        userId: u.id,
        name: u.name,
        username: u.username,
        email: u.email || "",
        rating,
        kind,
        subject: subject || (kind === "complaint" ? "Complaint" : "Feedback"),
        message,
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        resolved: false
      };
      d.feedback.unshift(entry);
      if (d.feedback.length > 2e3) d.feedback.length = 2e3;
      await save(d);
      return json({ ok: true, entry, message: "Thank you \u2014 your feedback has reached the Gifted Brainz team." });
    }
    if (m === "GET" && p === "/api/feedback") {
      const a = await auth(request, "student");
      if (!a) return json({ error: "Authentication required." }, 401);
      const d = await load();
      const mine = d.feedback.filter((f) => f.userId === a.sub);
      const rated = d.feedback.filter((f) => Number(f.rating) > 0);
      const average = rated.length ? Math.round(rated.reduce((s, f) => s + Number(f.rating), 0) / rated.length * 10) / 10 : 0;
      const breakdown = [5, 4, 3, 2, 1].map((star) => ({ star, count: rated.filter((f) => Number(f.rating) === star).length }));
      return json({ mine, summary: { average, total: rated.length, breakdown } });
    }
    if (m === "GET" && p === "/api/push/public-key") {
      const d = await load();
      const before = JSON.stringify(d.settings.vapidPublicJwk || null);
      const st = ensureVapidKeys(d);
      if (JSON.stringify(st.vapidPublicJwk) !== before) await save(d);
      return json({ publicKey: vapidPublicRaw(st.vapidPublicJwk).toString("base64url") });
    }
    if (m === "POST" && p === "/api/push/subscribe") {
      const a = await auth(request, "student");
      if (!a) return json({ error: "Authentication required." }, 401);
      const x = await readJSON(request), d = await load();
      const endpoint = cleanString(x.endpoint, 2e3), keys = x.keys || {};
      if (!/^https?:\/\//i.test(endpoint) || !keys.p256dh || !keys.auth) return json({ error: "The device notification subscription is incomplete." }, 400);
      const id = crypto.createHash("sha256").update(endpoint).digest("hex");
      const existing = d.pushSubscriptions.find((s) => s.id === id);
      const row = { id, userId: a.sub, endpoint, p256dh: cleanString(keys.p256dh, 300), auth: cleanString(keys.auth, 300), keys: { p256dh: cleanString(keys.p256dh, 300), auth: cleanString(keys.auth, 300) }, createdAt: existing?.createdAt || (/* @__PURE__ */ new Date()).toISOString(), updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
      if (existing) Object.assign(existing, row);
      else d.pushSubscriptions.push(row);
      await save(d);
      return json({ ok: true, id });
    }
    if (m === "GET" && p === "/api/notifications") {
      const a = await auth(request, "student");
      if (!a) return json({ error: "Authentication required." }, 401);
      const d = await load();
      const unreadOnly = url.searchParams.get("unread") === "1";
      const mine = d.notifications.filter((n) => n.userId === a.sub && (!unreadOnly || !n.read)).sort((x, y) => String(y.createdAt || "").localeCompare(String(x.createdAt || ""))).slice(0, 100);
      return json({ items: mine, unread: mine.filter((n) => !n.read).length });
    }
    if (m === "POST" && p === "/api/notifications/read") {
      const a = await auth(request, "student");
      if (!a) return json({ error: "Authentication required." }, 401);
      const x = await readJSON(request), d = await load();
      const ids = Array.isArray(x.ids) ? new Set(x.ids.map(String)) : null;
      for (const n of d.notifications) if (n.userId === a.sub && (!ids || ids.has(String(n.id)))) n.read = true;
      await save(d);
      return json({ ok: true });
    }
    // Exchange a header-authenticated API token for a download-only cookie
    // ticket, so the browser can fetch media without a token in the URL.
    // Signing out drops the cookie immediately rather than leaving it to expire.
    if (m === "DELETE" && p === "/api/files/ticket")
      return json({ ok: true }, 200, { "set-cookie": downloadCookieHeader("", 0) });
    if (m === "POST" && p === "/api/files/ticket") {
      const d = await load();
      const headerToken = bearer(request);
      const studentTok = headerToken ? await verifyToken(headerToken, "student") : null;
      if (studentTok && studentTokenValid(d, studentTok)) {
        const ticket = await issueDownloadTicket(studentTok.sub, "student", studentTok.v || 1);
        return json({ ok: true, expiresIn: DOWNLOAD_TICKET_TTL }, 200, { "set-cookie": downloadCookieHeader(ticket, DOWNLOAD_TICKET_TTL) });
      }
      const adminTok = headerToken ? await verifyToken(headerToken, "admin") : null;
      if (adminTok && (adminTok.v || 1) === (d.settings.tokenVersion || 1)) {
        const ticket = await issueDownloadTicket("admin", "admin", adminTok.v || 1);
        return json({ ok: true, expiresIn: DOWNLOAD_TICKET_TTL }, 200, { "set-cookie": downloadCookieHeader(ticket, DOWNLOAD_TICKET_TTL) });
      }
      return json({ error: "Authentication required." }, 401);
    }
    if (p.startsWith("/api/files/")) {
      // Media is loaded by the browser itself (img/video/anchor), which cannot
      // send an Authorization header. Those requests are therefore authorised by
      // a short-lived, download-only cookie ticket issued by /api/files/ticket.
      //
      // A general API token is deliberately NOT accepted from the query string:
      // such a URL is kept in browser history, is copied whenever a link is
      // shared, and is commonly written to proxy and access logs, yet it would
      // grant every permission of that role until it expired.
      const d = await load();
      const headerToken = bearer(request);
      let student = headerToken ? await verifyToken(headerToken, "student") : null;
      let adminTok = student ? null : headerToken ? await verifyToken(headerToken, "admin") : null;
      if (student && !studentTokenValid(d, student)) student = null;
      if (adminTok && (adminTok.v || 1) !== (d.settings.tokenVersion || 1)) adminTok = null;
      if (!student && !adminTok) {
        const ticket = await verifyToken(cookieValue(request, DOWNLOAD_COOKIE), DOWNLOAD_ROLE);
        if (ticket?.role === DOWNLOAD_ROLE) {
          if (ticket.for === "admin") {
            if ((ticket.v || 1) === (d.settings.tokenVersion || 1)) adminTok = ticket;
          } else if (studentTokenValid(d, { sub: ticket.sub, v: ticket.v })) {
            student = ticket;
          }
        }
      }
      if (!student && !adminTok) return json({ error: "Authentication required." }, 401);
      const key = decodeURIComponent(p.slice("/api/files/".length));
      if (!/^uploads\/[A-Za-z0-9._()\- ]+$/.test(key)) return json({ error: "File not found." }, 404);
      // Access control also applies to direct attachment URLs, not only the
      // student material-list endpoints. This prevents Free accounts bypassing
      // a restriction by reusing a saved /api/files URL.
      if (student && !adminTok) {
        const currentStudent = d.users.find(u => u.id === student.sub);
        const protectedNote = d.notes.find(n => n.accessLevel === "restricted" && (
          (Array.isArray(n.attachments) && n.attachments.some(f => String(f.key || "") === key)) || String(n.fileKey || "") === key
        ));
        if (protectedNote && !isActivatedAccount(currentStudent)) return json({ error: "This file is reserved for activated accounts." }, 403);
      }
      if (d.appUpdate && d.appUpdate.fileKey === key && !adminTok)
        return json({ error: "This file is not available for download." }, 403);
      const meta = await store().get(`${key}.meta`, { type: "json" });
      if (!meta) return json({ error: "File not found." }, 404);
      const kind = mediaKind(meta?.contentType, meta?.fileName);
      const chunked = Number.isInteger(meta.parts) && Number(meta.parts) > 0;
      const partSize = Number(meta?.chunkSize) || 0;
      let totalSize = Number(meta?.size) || 0;
      // Older uploads may have incomplete metadata with size=0. Resolve the
      // size without ever returning the object body to the client.
      if (!totalSize && chunked && partSize > 0) {
        const lastIndex = Math.max(0, Number(meta.parts) - 1);
        const lastPart = await store().get(`${key}.part.${lastIndex}`, { type: "arrayBuffer" });
        if (lastPart) totalSize = lastIndex * partSize + lastPart.byteLength;
      } else if (!totalSize && !chunked) {
        const wholeForSize = await store().get(key, { type: "arrayBuffer" });
        if (wholeForSize) totalSize = wholeForSize.byteLength;
      }
      if (totalSize && Number(meta.size) !== totalSize) {
        // Persist the recovered size so subsequent HEAD requests are metadata-only.
        await store().setJSON(`${key}.meta`, { ...meta, size: totalSize });
      }
      const disposition = url.searchParams.get("inline") === "1" ? "inline" : "attachment";
      const baseHeaders = {
        "content-type": meta?.contentType || "application/octet-stream",
        "content-disposition": `${disposition}; filename="${String(meta?.fileName || "download").replace(/["\\\r\n]/g, "_")}"`,
        "cache-control": "private, max-age=0, must-revalidate",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "content-security-policy": "default-src 'none'; img-src 'self' data:; media-src 'self' blob:; style-src 'unsafe-inline'; frame-src 'self'"
      };
      const rangeHeader = request.headers.get("range") || "";
      // HEAD is metadata-only. Never read/return the full object for HEAD;
      // doing so can trigger EdgeOne's 6 MB client response limit before the
      // browser can even learn the file size.
      if (m === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { ...baseHeaders, "accept-ranges": "bytes", "content-length": String(totalSize) }
        });
      }
      // Cloud Functions cap client response bodies at 6 MB. Keep every ranged
      // response comfortably below that limit so large PDFs, images, audio and
      // video can still be read/viewed through the authenticated file route.
      const RANGE_MAX = 4 * 1024 * 1024;
      const canRange = totalSize > 0;
      if (canRange && /^bytes=\d*-\d*$/.test(rangeHeader)) {
        const [rawStart, rawEnd] = rangeHeader.replace("bytes=", "").split("-");
        let start = rawStart === "" ? Math.max(0, totalSize - Number(rawEnd || 0)) : Number(rawStart);
        let end = rawStart === "" ? totalSize - 1 : rawEnd === "" ? totalSize - 1 : Number(rawEnd);
        end = Math.min(end, totalSize - 1, start + RANGE_MAX - 1);
        if (!(start >= 0 && end >= start && start < totalSize))
          return new Response(null, { status: 416, headers: { "content-range": `bytes */${totalSize}`, "accept-ranges": "bytes" } });
        let body;
        if (chunked && partSize > 0) {
          const chunks = [];
          let cursor = start;
          while (cursor <= end) {
            const index = Math.floor(cursor / partSize);
            if (index >= meta.parts) break;
            const part = await store().get(`${key}.part.${index}`, { type: "arrayBuffer" });
            if (!part) break;
            const partStart = index * partSize;
            const from = cursor - partStart;
            const to = Math.min(part.byteLength, end - partStart + 1);
            if (to <= from) break;
            chunks.push(new Uint8Array(part).subarray(from, to));
            cursor = partStart + to;
          }
          if (cursor <= end) return new Response(null, { status: 500, headers: { ...baseHeaders, "cache-control": "no-store" } });
          body = Buffer.concat(chunks.map((c) => Buffer.from(c)));
        } else {
          const whole = await store().get(key, { type: "arrayBuffer" });
          if (!whole) return json({ error: "File not found." }, 404);
          const wholeBytes = new Uint8Array(whole);
          body = Buffer.from(wholeBytes.subarray(start, end + 1));
        }
        return new Response(body, {
          status: 206,
          headers: { ...baseHeaders, "accept-ranges": "bytes", "content-range": `bytes ${start}-${start + body.length - 1}/${totalSize}`, "content-length": String(body.length) }
        });
      }
      let obj = null;
      if (chunked) {
        const total = meta.parts;
        let i = 0;
        obj = new ReadableStream({
          async pull(c) {
            if (i >= total) {
              c.close();
              return;
            }
            const part = await store().get(`${key}.part.${i++}`, { type: "arrayBuffer" });
            c.enqueue(new Uint8Array(part || new ArrayBuffer(0)));
          }
        });
      } else {
        obj = await store().get(key, { type: "arrayBuffer" });
      }
      if (!obj) return json({ error: "File not found." }, 404);
      const length = totalSize || (obj instanceof ArrayBuffer ? obj.byteLength : 0);
      return new Response(obj, {
        status: 200,
        headers: { ...baseHeaders, ...canRange || length ? { "accept-ranges": "bytes", "content-length": String(length) } : {} }
      });
    }
    if (p.startsWith("/api/admin/")) {
      const d = await load();
      const a = await adminAuth(request, d);
      if (!a) return json({ error: "Authentication required." }, 401);
      if (p.startsWith("/api/admin/battle/")) return battleAdminHandler(request,d,p,m,url);
      if (m === "POST" && p === "/api/admin/jamb-countdown") {
        const x = await readJSON(request);
        const t = Date.parse(String(x.target || ""));
        if (!t) return json({ error: "Please choose a valid date and time." }, 400);
        d.settings.jambDate = new Date(t).toISOString();
        d.settings.jambLabel = cleanString(x.label || "JAMB UTME", 60) || "JAMB UTME";
        d.settings.jambUpdatedAt = (/* @__PURE__ */ new Date()).toISOString();
        await save(d);
        return json({ ok: true, target: d.settings.jambDate, label: d.settings.jambLabel, message: "JAMB countdown updated. Students will see the new date right away." });
      }
      
      // The one subject catalogue is shared by CBT, videos, materials and Battle Arena.
      if(m==="GET"&&p==="/api/admin/subjects")return json(d.battleSubjects);
      if(m==="POST"&&p==="/api/admin/subjects"){
        const x=await readJSON(request), name=cleanString(x.name,80);
        if(!name||platformSubjects(d).some(s=>s.toLowerCase()===name.toLowerCase()))return json({error:"Enter a unique subject name."},409);
        const subject={id:crypto.randomUUID(),name,emoji:subjectEmoji(x.emoji||"📚")};
        d.battleSubjects.push(subject);await save(d);return json(subject,201);
      }
      if(m==="PATCH"&&/^\/api\/admin\/subjects\/[^/]+$/.test(p)){
        const s=d.battleSubjects.find(s=>s.id===decodeURIComponent(p.split("/").pop()));if(!s)return json({error:"Subject not found."},404);
        const x=await readJSON(request);
        if(x.emoji!==undefined)s.emoji=subjectEmoji(x.emoji);
        if(x.name!==undefined){
          const next=cleanString(x.name,80),old=s.name;
          if(!next||platformSubjects(d).some(n=>n.toLowerCase()===next.toLowerCase()&&n!==old))return json({error:"Choose a unique subject name."},409);
          if(SUBJECTS.includes(old)&&next!==old)return json({error:"Default subject names cannot be renamed."},409);
          s.name=next;
          if(next!==old){
            for(const field of ["questionBank","battleQuestions","notes","cbtTests","videos","topics","progress","learningMistakes","learningSaved","learningPlans","learningAssessments"])
              for(const row of d[field]||[])if(row.subject===old)row.subject=next;
            for(const u of d.users||[])u.selectedSubjects=(u.selectedSubjects||[]).map(v=>v===old?next:v);
            for(const r of d.battleRooms||[])if(r.subject===old)r.subject=next;
          }
        }
        await save(d);return json(s);
      }
      if(m==="DELETE"&&/^\/api\/admin\/subjects\/[^/]+$/.test(p)){
        const s=d.battleSubjects.find(s=>s.id===decodeURIComponent(p.split("/").pop()));if(!s)return json({error:"Subject not found."},404);
        if(SUBJECTS.includes(s.name))return json({error:"Default subjects cannot be deleted."},409);
        const used=["questionBank","battleQuestions","notes","cbtTests","videos","topics","progress","battleRooms"].some(k=>(d[k]||[]).some(r=>r.subject===s.name)) || d.users.some(u=>(u.selectedSubjects||[]).includes(s.name));
        if(used)return json({error:"This subject has associated data. Move it before deleting."},409);
        d.battleSubjects=d.battleSubjects.filter(row=>row.id!==s.id);await save(d);return json({ok:true});
      }
      if(m==="GET"&&p==="/api/admin/preview-catalog"){
        // Privileged read-only projection; never impersonate a student or create progress.
        const project=rows=>rows.filter(x=>x.published).map(x=>({id:x.id,title:x.title||x.name||"Untitled",subject:x.subject||"All subjects",accessLevel:x.accessLevel||"public",body:x.body||"",description:x.description||"",youtubeUrl:x.youtubeUrl||"",linkUrl:x.linkUrl||"",attachments:x.attachments||[]}));
        return json({subjects:platformSubjects(d),topics:d.topics.map(x=>({id:x.id,subject:x.subject,name:x.name})),materials:project(d.notes),videos:project(d.videos),cbts:project(d.cbtTests)});
      }
      if (m === "GET" && p === "/api/admin/topics") {
        const subject=cleanString(url.searchParams.get("subject")||"",80);
        const wanted=String(subject||"").trim().replace(/\s+/g," ").toLowerCase();
        return json(d.topics.filter(t=>!subject||!t.subject||String(t.subject).trim().replace(/\s+/g," ").toLowerCase()===wanted).map(t=>publicTopic(t,d)));
      }
      if (m === "POST" && p === "/api/admin/topics") {
        const x=await readJSON(request), subject=cleanString(x.subject,80), name=cleanString(x.name,200).replace(/\s+/g," ").trim();
        if(!platformSubjects(d).includes(subject))return json({error:"Choose a valid subject."},400);
        if(!name)return json({error:"Topic name is required."},400);
        if(d.topics.some(t=>topicKey(t.subject,t.name)===topicKey(subject,name)))return json({error:"That topic already exists in this subject."},409);
        const t={id:crypto.randomUUID(),subject,name,slug:name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
        d.topics.push(t); await save(d); return json(publicTopic(t,d),201);
      }
      if (m === "PATCH" && /^\/api\/admin\/topics\/[^/]+$/.test(p)) {
        const id=decodeURIComponent(p.split("/").pop()), x=await readJSON(request), t=d.topics.find(v=>v.id===id);
        if(!t)return json({error:"Topic not found."},404);
        const name=cleanString(x.name,200).replace(/\s+/g," ").trim();
        if(!name)return json({error:"Topic name is required."},400);
        if(d.topics.some(v=>v.id!==id&&topicKey(v.subject,v.name)===topicKey(t.subject,name)))return json({error:"That topic already exists in this subject."},409);
        const oldName=t.name; t.name=name; t.slug=name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""); t.updatedAt=new Date().toISOString();
        d.questionBank.filter(q=>q.topicId===id).forEach(q=>q.topic=name);
        for(const field of ["battleQuestions","questionBank","notes","cbtTests","videos","learningMistakes","learningSaved","learningPlans"])
          for(const row of d[field]||[])if(row.subject===t.subject && row.topic===oldName)row.topic=name;
        d.battleQuestions.filter(q=>q.subject===t.subject&&q.topic===oldName).forEach(q=>q.topic=name);
        d.notes.filter(n=>n.topicId===id).forEach(n=>n.topicName=name);
        d.cbtTests.filter(c=>c.topicId===id).forEach(c=>c.topicName=name);
        await save(d); return json(publicTopic(t,d));
      }
      if (m === "DELETE" && /^\/api\/admin\/topics\/[^/]+$/.test(p)) {
        const id=decodeURIComponent(p.split("/").pop()), t=d.topics.find(v=>v.id===id); if(!t)return json({error:"Topic not found."},404);
        let fallback=d.topics.find(v=>v.subject===t.subject&&/uncategorized/i.test(v.name));
        if(!fallback){fallback={id:crypto.randomUUID(),subject:t.subject,name:"Uncategorized / Topic Not Assigned",slug:"uncategorized-topic-not-assigned",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};d.topics.push(fallback);}
        d.questionBank.filter(q=>q.topicId===id).forEach(q=>{q.topicId=fallback.id;q.topic=fallback.name;});
        d.battleQuestions.filter(q=>q.subject===t.subject&&q.topic===t.name).forEach(q=>q.topic=fallback.name);
        d.notes.filter(n=>n.topicId===id).forEach(n=>{n.topicId="";n.topicName="";});
        d.cbtTests.filter(c=>c.topicId===id).forEach(c=>{c.topicId="";c.topicName="";});
        d.topics=d.topics.filter(v=>v.id!==id); await save(d); return json({ok:true, reassignedTo:fallback.id});
      }
      if (m === "POST" && /^\/api\/admin\/question-bank\/[^/]+\/topic$/.test(p)) {
        const id=decodeURIComponent(p.split("/")[4]), x=await readJSON(request), q=d.questionBank.find(v=>v.id===id);
        if(!q)return json({error:"Question not found."},404);
        const t=topicFor(d,x.topicId,q.subject); if(!t)return json({error:"Choose a topic belonging to this question's subject."},400);
        q.topicId=t.id;q.topic=t.name;await save(d);return json(q);
      }
      if (m === "GET" && p === "/api/admin/overview") {
        return json({
          students: d.users.length,
          freeStudents: d.users.filter(u => (u.approval || "approved") === "approved" && (u.accountType || "free") === "free").length,
          activatedStudents: d.users.filter(u => (u.approval || "approved") === "approved" && u.accountType === "activated").length,
          topics: d.topics.filter(t => t && t.name && !/uncategorized|topic not assigned/i.test(String(t.name))).length,
          questionBankQuestions: d.questionBank.length,
          completedTopics: d.progress.filter(x => x && x.completed === true).length,
          notes: d.notes.length,
          announcements: d.announcements.length,
          pendingApprovals: 0,
          feedback: d.feedback.length,
          storage: storageReport(),
          rating: (() => {
            const r = d.feedback.filter((f) => Number(f.rating) > 0);
            return r.length ? Math.round(r.reduce((s, f) => s + Number(f.rating), 0) / r.length * 10) / 10 : 0;
          })()
        });
      }
      if (m === "GET" && p === "/api/admin/pending") return json({error:"Student verification has been retired."},410);
      if(false){
        const rows = d.users.filter((u) => (u.approval || "approved") !== "approved").sort((a2, b) => String(b.requestedAt || b.joined || "").localeCompare(String(a2.requestedAt || a2.joined || ""))).map((u) => ({ ...publicUser(u), joined: u.joined || null, requestedAt: u.requestedAt || u.joined || null }));
        return json(rows);
      }
      if (m === "POST" && /^\/api\/admin\/pending\/[^/]+\/(approve|reject)$/.test(p)) return json({error:"Student verification has been retired."},410);
      if(false){
        const bits = p.split("/");
        const action = bits.pop(), id = decodeURIComponent(bits.pop());
        const u = d.users.find((v) => v.id === id);
        if (!u) return json({ error: "That account no longer exists." }, 404);
        const approvalData = action === "approve" ? await readJSON(request) : {};
        if (action === "approve") {
          const chosenTier = String(approvalData.accountType || u.accountType || "free");
          if (!["free", "activated"].includes(chosenTier)) return json({ error: "Choose Free or Activated account access." }, 400);
          u.accountType = chosenTier;
        }
        if (u.approval !== (action === "approve" ? "approved" : "rejected")) revokeStudentTokens(u);
        u.approval = action === "approve" ? "approved" : "rejected";
        u.approved = u.approval === "approved";
        u.reviewedAt = (/* @__PURE__ */ new Date()).toISOString();
        d.notifications.unshift({
          id: crypto.randomUUID(),
          userId: u.id,
          type: "approval",
          title: action === "approve" ? "Account approved \u2705" : "Account review completed",
          message: action === "approve" ? "Your Gifted Brainz Tutorial account has been approved. You can log in now." : "Your account could not be approved. Please contact support from the Help page.",
          url: "/login.html",
          createdAt: (/* @__PURE__ */ new Date()).toISOString(),
          read: false
        });
        await save(d);
        return json({ ok: true, user: publicUser(u), message: action === "approve" ? `${u.name} can now log in.` : `${u.name}'s request was declined.` });
      }
      if (m === "GET" && p === "/api/admin/feedback") {
        const rated = d.feedback.filter((f) => Number(f.rating) > 0);
        const average = rated.length ? Math.round(rated.reduce((s, f) => s + Number(f.rating), 0) / rated.length * 10) / 10 : 0;
        return json({
          items: d.feedback,
          summary: {
            average,
            total: rated.length,
            complaints: d.feedback.filter((f) => f.kind === "complaint").length,
            unresolved: d.feedback.filter((f) => !f.resolved).length,
            breakdown: [5, 4, 3, 2, 1].map((star) => ({ star, count: rated.filter((f) => Number(f.rating) === star).length }))
          }
        });
      }
      if (m === "PATCH" && /^\/api\/admin\/feedback\/[^/]+$/.test(p)) {
        const id = decodeURIComponent(p.split("/").pop());
        const f = d.feedback.find((v) => v.id === id);
        if (!f) return json({ error: "Feedback not found." }, 404);
        const x = await readJSON(request);
        let replyNotification = null;
        if (x.resolved !== void 0) f.resolved = !!x.resolved;
        if (x.reply !== void 0) {
          const reply = cleanString(x.reply, 2e3);
          f.reply = reply;
          if (reply) {
            replyNotification = {
              id: crypto.randomUUID(),
              userId: f.userId,
              type: "feedback-reply",
              title: "The admin replied to your feedback",
              message: reply.slice(0, 180),
              url: "/feedback.html",
              createdAt: (/* @__PURE__ */ new Date()).toISOString(),
              read: false
            };
            d.notifications.unshift(replyNotification);
          }
        }
        await save(d);
        if (replyNotification) {
          const removed = await sendWebPushes(d, [replyNotification]);
          if (removed) await save(d);
        }
        return json(f);
      }
      if (m === "DELETE" && /^\/api\/admin\/feedback\/[^/]+$/.test(p)) {
        const id = decodeURIComponent(p.split("/").pop());
        const i = d.feedback.findIndex((v) => v.id === id);
        if (i < 0) return json({ error: "Feedback not found." }, 404);
        d.feedback.splice(i, 1);
        await save(d);
        return json({ ok: true, id });
      }
      if (m === "GET" && p === "/api/admin/account")
        return json({ username: adminUsername(d), email: adminEmail(d), custom: !!d.settings.adminPasswordHash, storage: storageReport() });
      if (m === "PATCH" && p === "/api/admin/account") {
        const x = await readJSON(request);
        if (!adminPasswordOk(d, String(x.currentPassword || "")))
          return json({ error: "Your current admin password is incorrect." }, 401);
        const email = cleanString(x.email, 160).toLowerCase();
        if (email) {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid admin email address." }, 400);
          d.settings.adminEmail = email;
        }
        const nextUsername = cleanString(x.username, 80);
        if (nextUsername) {
          if (!/^[A-Za-z0-9._-]{3,80}$/.test(nextUsername))
            return json({ error: "The admin username may only contain letters, numbers, dot, dash and underscore." }, 400);
          d.settings.adminUsername = nextUsername;
        }
        const next = String(x.password || "");
        if (next) {
          const classes = [/[A-Za-z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(next)).length;
          if (next.length < 8) return json({ error: "The new admin password must be at least 8 characters." }, 400);
          if (classes < 2) return json({ error: "The new admin password must mix at least two of: letters, numbers, symbols." }, 400);
          const ph = passwordHash(next);
          d.settings.adminPasswordHash = ph.hash;
          d.settings.adminPasswordSalt = ph.salt;
        }
        d.settings.adminCredentialsVersion = ADMIN_CREDENTIALS_VERSION;
        d.settings.tokenVersion = (d.settings.tokenVersion || 1) + 1;
        d.settings.updated = (/* @__PURE__ */ new Date()).toISOString();
        await save(d);
        return json({
          username: adminUsername(d),
          email: adminEmail(d),
          custom: !!d.settings.adminPasswordHash,
          token: await issue("admin", "admin", d.settings.tokenVersion)
        });
      }
      if (m === "GET" && p === "/api/admin/students") {
        return json(d.users.map(u => publicUser(u)));
      }
      if (m === "GET" && /^\/api\/admin\/students\/[^/]+\/progress$/.test(p)) {
        const u = d.users.find((u2) => u2.id === p.split("/")[4]);
        if (!u) return json({ error: "Student not found." }, 404);
        const allowedSubjects = studentSubjects(u);
        const checkedTopicIds = new Set(d.progress.filter(x => x.userId === u.id && x.completed === true).map(x => String(x.topicId)));
        const topicProgress = allowedSubjects.map(subject => {
          const topics = d.topics.filter(t => t && String(t.subject || "") === subject && t.id && t.name && !/uncategorized|topic not assigned/i.test(String(t.name)))
            .map(t => ({ id: String(t.id), name: String(t.name), completed: checkedTopicIds.has(String(t.id)) }));
          const completed = topics.filter(t => t.completed).length;
          return { subject, topics, completed, total: topics.length, percent: topics.length ? Math.round(completed / topics.length * 100) : 0 };
        });
        return json({
          student: publicUser(u),
          topicProgress,
          joined: u.joined || "",
          completedTopics: topicProgress.reduce((sum, row) => sum + row.completed, 0),
          totalTopics: topicProgress.reduce((sum, row) => sum + row.total, 0)
        });
      }
      if (m === "PATCH" && /^\/api\/admin\/students\/[^/]+$/.test(p)) {
        const x = await readJSON(request), u = d.users.find((u2) => u2.id === p.split("/").pop());
        if (!u) return json({ error: "Student not found." }, 404);
        // Any of these changes must take effect immediately rather than when
        // the student's current token happens to expire.
        if (x.status !== void 0) {
          const nextStatus = x.status === "suspended" ? "suspended" : "active";
          if (nextStatus !== u.status) revokeStudentTokens(u);
          u.status = nextStatus;
        }
        if (false && x.approval !== void 0 && ["pending", "approved", "rejected"].includes(x.approval)) {
          if (x.approval !== u.approval) revokeStudentTokens(u);
          u.approval = x.approval;
          u.approved = x.approval === "approved";
          u.reviewedAt = (/* @__PURE__ */ new Date()).toISOString();
        }
        if (x.accountType !== void 0) {
          const nextType = String(x.accountType);
          if (!["free", "activated"].includes(nextType)) return json({ error: "Account type must be Free or Activated." }, 400);
          u.accountType = nextType;
        }
        if (x.password !== void 0) {
          if (String(x.password).length < 8) return json({ error: "Password must be at least 8 characters." }, 400);
          const ph = passwordHash(x.password);
          u.passwordHash = ph.hash;
          u.passwordSalt = ph.salt;
          revokeStudentTokens(u);
        }
        if (x.selectedSubjects !== void 0) {
          if(!isActivatedAccount(u))return json({error:"Free students choose their subjects from My Account. Admin subject assignment is available for premium students only."},403);
          const subjectCheck = validateSelectedSubjects(x.selectedSubjects,platformSubjects(d));
          if (subjectCheck.error) return json({ error: subjectCheck.error }, 400);
          u.selectedSubjects = subjectCheck.subjects;
        }
        await save(d);
        await mirrorStudyStudentProfile(u);
        return json(publicUser(u));
      }
      if (m === "DELETE" && /^\/api\/admin\/students\/[^/]+$/.test(p)) {
        const id = p.split("/").pop(), i = d.users.findIndex((u) => u.id === id);
        if (i < 0) return json({ error: "Student not found." }, 404);
        const [removedUser] = d.users.splice(i, 1);
        d.results = d.results.filter((r) => r.userId !== id);
        if(env("GB_CHAT_BACKEND")==="supabase")await createStudyChatStore({GB_CHAT_BACKEND:env("GB_CHAT_BACKEND"),GB_CHAT_SUPABASE_URL:env("GB_CHAT_SUPABASE_URL"),GB_CHAT_SUPABASE_SECRET:env("GB_CHAT_SUPABASE_SECRET"),GB_CHAT_REALTIME_ENABLED:env("GB_CHAT_REALTIME_ENABLED"),GB_STUDY_DIRECTORY_BACKEND:env("GB_STUDY_DIRECTORY_BACKEND"),GB_STUDY_COMMUNITY_BACKEND:env("GB_STUDY_COMMUNITY_BACKEND")}).purgeUser(id);
        purgeStudentLearning(d, id);
        await save(d);
        // Free the username/email reservations so the details can be registered
        // again. CBT completion claims are scoped to individual sessions and
        // are no longer used to restrict a student to one test attempt.
        await releaseUserUniqueKeys(removedUser);
        return json({ ok: true, id });
      }
      // Retired activity-history endpoint: no historical session records are
      // exposed to the administration interface. Stored legacy data is retained
      // for recovery rather than being silently destroyed during deployment.
      if (m === "GET" && p === "/api/admin/results")
        return json({ error: "This activity-history endpoint has been retired." }, 410);
      if (m === "GET" && p === "/api/admin/notes") return json(d.notes);
      if (m === "POST" && p === "/api/admin/notes") {
        const x = await readJSON(request), title = cleanString(x.title, 200), subject = cleanString(x.subject, 80);
        if (!title || !platformSubjects(d).includes(subject)) return json({ error: "Title and subject are required." }, 400);
        // Notes are published directly under their subjects.
        const attachments = normaliseAttachments(x.attachments && x.attachments.length ? x.attachments : x.fileKey ? [{ key: x.fileKey, fileName: x.fileName, contentType: x.contentType }] : []);
        const n = {
          id: crypto.randomUUID(),
          title,
          subject,
          topic: "",
          topicId: "",
          topicName: "",
          body: richBody(x.body, 4e4),
          format: "html",
          attachments,
          fileUrl: attachments[0]?.url || "",
          fileKey: attachments[0]?.key || "",
          fileName: attachments[0]?.fileName || "",
          accessLevel: x.accessLevel === "restricted" ? "restricted" : "public",
          published: !!x.published,
          date: (/* @__PURE__ */ new Date()).toISOString(),
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        d.notes.unshift(n);
        await save(d);
        return json(n);
      }
      if (m === "PATCH" && /^\/api\/admin\/notes\/[^/]+$/.test(p)) {
        const x = await readJSON(request), n = d.notes.find((n2) => n2.id === p.split("/").pop());
        if (!n) return json({ error: "Material not found." }, 404);
        if (typeof x.published === "boolean") n.published = x.published;
        if (x.accessLevel !== void 0) n.accessLevel = x.accessLevel === "restricted" ? "restricted" : "public";
        if (x.title !== void 0) n.title = cleanString(x.title, 200) || n.title;
        if (x.subject !== void 0) {
          if (!platformSubjects(d).includes(x.subject)) return json({error:"Choose a valid subject."},400);
          n.subject=x.subject;
        }
        n.topic="";n.topicId="";n.topicName="";
        if (x.body !== void 0) {
          n.body = richBody(x.body, 4e4);
          n.format = "html";
        }
        n.bodyFormat = n.format;
        if (x.attachments !== void 0) {
          const old = n.attachments || [];
          n.attachments = normaliseAttachments(x.attachments);
          n.fileUrl = n.attachments[0]?.url || "";
          n.fileKey = n.attachments[0]?.key || "";
          n.fileName = n.attachments[0]?.fileName || "";
          const keep = new Set(n.attachments.map((f) => f.key));
          for (const f of old) if (f.key && !keep.has(f.key)) await deleteFile(f.key);
        }
        await save(d);
        return json(n);
      }
      if (m === "DELETE" && /^\/api\/admin\/notes\/[^/]+$/.test(p)) {
        const id = p.split("/").pop(), i = d.notes.findIndex((n) => n.id === id);
        if (i < 0) return json({ error: "Material not found." }, 404);
        const [removed] = d.notes.splice(i, 1);
        await save(d);
        for (const f of removed.attachments || []) await deleteFile(f.key);
        if (removed.fileKey && !(removed.attachments || []).some((f) => f.key === removed.fileKey)) await deleteFile(removed.fileKey);
        return json({ ok: true, id });
      }
      if (m === "POST" && p === "/api/admin/upload/init") {
        const x = await readJSON(request);
        const safe = (cleanString(x.fileName || x.name, 180) || "file").replace(/[^a-zA-Z0-9._() \-]/g, "_") || "file";
        const uploadId = crypto.randomUUID();
        const key = `uploads/${Date.now()}-${crypto.randomBytes(8).toString("hex")}-${safe}`;
        const declaredSize = Number(x.size);
        if (!Number.isFinite(declaredSize) || declaredSize < 0 || declaredSize > 2 * 1024 * 1024 * 1024)
          return json({ error: "File size must be between 0 and 2 GB." }, 413);
        const chunkSize = Math.min(MAX_CHUNK, Math.max(1, Number(x.chunkSize) || 1024 * 1024));
        const declaredType = cleanString(x.contentType || x.type, 160);
        const guessed = declaredType || guessContentType(safe);
        await store().setJSON(`sessions/${uploadId}`, {
          key,
          fileName: safe,
          contentType: guessed || "application/octet-stream",
          size: declaredSize,
          chunkSize,
          received: 0,
          parts: 0,
          created: Date.now()
        });
        return json({ uploadId, key, chunkSize });
      }
      if (m === "POST" && p === "/api/admin/upload/chunk") {
        const isBinary = (request.headers.get("content-type") || "").toLowerCase().startsWith("application/octet-stream");
        let x, bytes;
        if (isBinary) {
          x = {
            uploadId: request.headers.get("x-upload-id") || "",
            index: request.headers.get("x-chunk-index") || ""
          };
          bytes = await readRawBody(request);
        } else {
          // Keep accepting the JSON/base64 format for older deployed clients.
          x = await readJSON(request);
          bytes = Buffer.from(String(x.data || ""), "base64");
        }
        const s = await store().get(`sessions/${String(x.uploadId || "").replace(/[^a-zA-Z0-9-]/g, "")}`, { type: "json" });
        if (!s) return json({ error: "Upload session not found. Please start the upload again." }, 404);
        if (!s.created || Date.now() - s.created > 60 * 60 * 1e3) {
          await store().delete(`sessions/${String(x.uploadId || "").replace(/[^a-zA-Z0-9-]/g, "")}`).catch(() => {
          });
          return json({ error: "Upload session expired. Please start the upload again." }, 410);
        }
        const index = Number(x.index);
        if (!Number.isInteger(index) || index < 0) return json({ error: "Invalid chunk index." }, 400);
        if (!bytes.length) return json({ error: "Chunk data is required." }, 400);
        if (bytes.length > MAX_CHUNK) return json({ error: "Chunk too large." }, 413);
        await store().set(`${s.key}.part.${index}`, bytes);
        const seen = Array.isArray(s.chunkSizes) ? s.chunkSizes : [];
        seen[index] = bytes.length;
        const received = seen.reduce((t, n) => t + (Number(n) || 0), 0);
        await store().setJSON(`sessions/${String(x.uploadId).replace(/[^a-zA-Z0-9-]/g, "")}`, { ...s, chunkSizes: seen, received, parts: Math.max(Number(s.parts) || 0, index + 1) });
        return json({ ok: true, index, size: bytes.length, received });
      }
      if (m === "POST" && p === "/api/admin/upload/complete") {
        const x = await readJSON(request);
        const id = String(x.uploadId || "").replace(/[^a-zA-Z0-9-]/g, "");
        const s = await store().get(`sessions/${id}`, { type: "json" });
        if (!s) return json({ error: "Upload session not found. Please start the upload again." }, 404);
        const parts = Number(x.parts);
        if (!Number.isInteger(parts) || parts < 0 || parts > 4096) return json({ error: "Invalid upload." }, 400);
        if (Date.now() - Number(s.created || 0) > 60 * 60 * 1e3) {
          await store().delete(`sessions/${id}`).catch(() => {
          });
          return json({ error: "Upload session expired. Please start the upload again." }, 410);
        }
        const declaredSize = Number(s.size) || 0;
        const sizes = Array.isArray(s.chunkSizes) ? s.chunkSizes : [];
        for (let i = 0; i < parts; i++) {
          if (!Number.isFinite(Number(sizes[i])) || Number(sizes[i]) <= 0) {
            const part = await store().get(`${s.key}.part.${i}`, { type: "arrayBuffer" });
            if (!part) return json({ error: `Upload is incomplete: chunk ${i + 1} is missing. Please try the upload again.` }, 409);
            sizes[i] = part.byteLength;
          }
        }
        const actualSize = sizes.slice(0, parts).reduce((t, n) => t + (Number(n) || 0), 0);
        if (declaredSize && actualSize !== declaredSize)
          return json({ error: `The upload did not finish cleanly (expected ${declaredSize} bytes, received ${actualSize}). Please check your connection and upload the file again.` }, 409);
        await store().setJSON(`${s.key}.meta`, { fileName: s.fileName, contentType: s.contentType, parts, size: actualSize || declaredSize, chunkSize: Number(s.chunkSize) || 1024 * 1024 });
        await store().delete(`sessions/${id}`).catch(() => {
        });
        return json({ fileKey: s.key, fileUrl: "/api/files/" + encodeURIComponent(s.key), fileName: s.fileName, contentType: s.contentType, kind: mediaKind(s.contentType, s.fileName), parts, size: actualSize || declaredSize });
      }
      if (m === "GET" && p === "/api/admin/cbt-tests") {
        const subject = cleanString(url.searchParams.get("subject") || "", 80);
        return json(d.cbtTests.filter(t => !subject || t.subject === subject).sort((x, y) => x.subject.localeCompare(y.subject) || String(x.title).localeCompare(String(y.title))));
      }
      if (m === "POST" && p === "/api/admin/cbt-tests") {
        const x = await readJSON(request), subject = cleanString(x.subject, 80), title = cleanString(x.title, 200);
        if (!platformSubjects(d).includes(subject)) return json({ error: "Choose a valid subject." }, 400);
        if (!title) return json({ error: "A title is required." }, 400);
        const linkUrl = cleanString(x.linkUrl || "", 1000);
        if (linkUrl && !/^https?:\/\//i.test(linkUrl)) return json({ error: "The link must start with http:// or https://." }, 400);
        const performanceUrl = cleanString(x.performanceUrl || "", 1000);
        if (performanceUrl && !/^https?:\/\//i.test(performanceUrl)) return json({ error: "Performance link must start with http:// or https://." }, 400);
        const now = (/* @__PURE__ */ new Date()).toISOString();
        const t = {
          id: crypto.randomUUID(),
          subject,
          title,
          topicId:"",
          topicName:"",
          writeup: richBody(plainToRichParagraphs(x.writeup || ""), 2e4),
          linkUrl,
          linkLabel: cleanString(x.linkLabel || "", 80) || "Start Assessment",
          performanceUrl,
          performanceLabel: cleanString(x.performanceLabel || "", 80) || "Check Performance",
          accessLevel: x.accessLevel === "restricted" ? "restricted" : "public",
          published: !!x.published,
          createdAt: now,
          updatedAt: now
        };
        d.cbtTests.unshift(t);
        await save(d);
        return json(t, 201);
      }
      if (m === "PATCH" && /^\/api\/admin\/cbt-tests\/[^/]+$/.test(p)) {
        const id = decodeURIComponent(p.split("/").pop()), x = await readJSON(request), t = d.cbtTests.find(v => v.id === id);
        if (!t) return json({ error: "CBT test not found." }, 404);
        if (x.subject !== void 0) {
          if (!platformSubjects(d).includes(x.subject)) return json({ error: "Choose a valid subject." }, 400);
          t.subject = x.subject;
        }
        if (x.title !== void 0) {
          const title = cleanString(x.title, 200);
          if (!title) return json({ error: "A title is required." }, 400);
          t.title = title;
        }
        if (x.writeup !== void 0) t.writeup = richBody(plainToRichParagraphs(x.writeup || ""), 2e4);
        if (x.linkUrl !== void 0) {
          const linkUrl = cleanString(x.linkUrl || "", 1000);
          if (linkUrl && !/^https?:\/\//i.test(linkUrl)) return json({ error: "The link must start with http:// or https://." }, 400);
          t.linkUrl = linkUrl;
        }
        if (x.linkLabel !== void 0) t.linkLabel = cleanString(x.linkLabel || "", 80) || "Start Assessment";
        if (x.performanceUrl !== void 0) {
          const performanceUrl = cleanString(x.performanceUrl || "", 1000);
          if (performanceUrl && !/^https?:\/\//i.test(performanceUrl)) return json({ error: "Performance link must start with http:// or https://." }, 400);
          t.performanceUrl = performanceUrl;
        }
        if (x.performanceLabel !== void 0) t.performanceLabel = cleanString(x.performanceLabel || "", 80) || "Check Performance";
        if (x.accessLevel !== void 0) t.accessLevel = x.accessLevel === "restricted" ? "restricted" : "public";
        if (typeof x.published === "boolean") t.published = x.published;
        t.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        await save(d);
        return json(t);
      }
      if (m === "DELETE" && /^\/api\/admin\/cbt-tests\/[^/]+$/.test(p)) {
        const id = decodeURIComponent(p.split("/").pop()), i = d.cbtTests.findIndex(t => t.id === id);
        if (i < 0) return json({ error: "CBT test not found." }, 404);
        d.cbtTests.splice(i, 1);
        await save(d);
        return json({ ok: true, id });
      }
      if (m === "GET" && p === "/api/admin/videos") {
        const subject = cleanString(url.searchParams.get("subject") || "", 80);
        return json(d.videos.filter(v => !subject || v.subject === subject).sort((x, y) => x.subject.localeCompare(y.subject) || String(x.title).localeCompare(String(y.title))));
      }
      if (m === "POST" && p === "/api/admin/videos") {
        const x = await readJSON(request), subject = cleanString(x.subject, 80), title = cleanString(x.title, 200);
        if (!platformSubjects(d).includes(subject)) return json({ error: "Choose a valid subject." }, 400);
        if (!title) return json({ error: "A title is required." }, 400);
        const youtubeUrl = cleanString(x.youtubeUrl || "", 1000);
        if (!youtubeUrl || !/^https?:\/\/(www\.)?(youtube\.com|youtu\.be|m\.youtube\.com)\//i.test(youtubeUrl)) return json({ error: "Enter a valid YouTube link." }, 400);
        const now = (/* @__PURE__ */ new Date()).toISOString();
        const v = {
          id: crypto.randomUUID(),
          subject,
          title,
          description: richBody(plainToRichParagraphs(x.description || ""), 2e4),
          youtubeUrl,
          published: !!x.published,
          createdAt: now,
          updatedAt: now
        };
        d.videos.unshift(v);
        await save(d);
        return json(v, 201);
      }
      if (m === "PATCH" && /^\/api\/admin\/videos\/[^/]+$/.test(p)) {
        const id = decodeURIComponent(p.split("/").pop()), x = await readJSON(request), v = d.videos.find(r => r.id === id);
        if (!v) return json({ error: "Video not found." }, 404);
        if (x.subject !== void 0) {
          if (!platformSubjects(d).includes(x.subject)) return json({ error: "Choose a valid subject." }, 400);
          v.subject = x.subject;
        }
        if (x.title !== void 0) {
          const title = cleanString(x.title, 200);
          if (!title) return json({ error: "A title is required." }, 400);
          v.title = title;
        }
        if (x.description !== void 0) v.description = richBody(plainToRichParagraphs(x.description || ""), 2e4);
        if (x.youtubeUrl !== void 0) {
          const youtubeUrl = cleanString(x.youtubeUrl || "", 1000);
          if (!youtubeUrl || !/^https?:\/\/(www\.)?(youtube\.com|youtu\.be|m\.youtube\.com)\//i.test(youtubeUrl)) return json({ error: "Enter a valid YouTube link." }, 400);
          v.youtubeUrl = youtubeUrl;
        }
        if (typeof x.published === "boolean") v.published = x.published;
        v.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        await save(d);
        return json(v);
      }
      if (m === "DELETE" && /^\/api\/admin\/videos\/[^/]+$/.test(p)) {
        const id = decodeURIComponent(p.split("/").pop()), i = d.videos.findIndex(v => v.id === id);
        if (i < 0) return json({ error: "Video not found." }, 404);
        d.videos.splice(i, 1);
        await save(d);
        return json({ ok: true, id });
      }
      if(m==="DELETE"&&/^\/api\/admin\/announcements\/[^/]+\/replies\/[^/]+$/.test(p)){
        const parts=p.split("/"),item=d.announcements.find(x=>x.id===parts[4]);
        if(!item||!(item.replies||[]).some(r=>r.id===parts[6]))return json({error:"Reply not found."},404);
        const removed=new Set([parts[6]]);let changed=true;
        while(changed){changed=false;for(const r of item.replies)if(r.parentId&&removed.has(r.parentId)&&!removed.has(r.id)){removed.add(r.id);changed=true;}}
        item.replies=item.replies.filter(r=>!removed.has(r.id));await save(d);return json({ok:true,removed:removed.size});
      }
      if (m === "GET" && p === "/api/admin/announcements") return json(d.announcements);
      if (m === "POST" && p === "/api/admin/announcements") {
        const x = await readJSON(request);
        const body = richBody(x.body, 4e4);
        const media = normaliseAttachments(x.media && x.media.length ? x.media : x.attachments);
        if (!cleanString(x.title, 200) || !body.replace(/<[^>]*>/g, "").trim() && !media.length)
          return json({ error: "A title and either a message or an attached picture/video are required." }, 400);
        const a2 = {
          id: crypto.randomUUID(),
          title: cleanString(x.title, 200),
          body,
          format: "html",
          media,
          published: !!x.published,
          date: (/* @__PURE__ */ new Date()).toISOString(),
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        a2.attachments = a2.media;
        a2.bodyFormat = a2.format;
        d.settings.deletedAnnouncementIds = (d.settings.deletedAnnouncementIds || []).filter((v) => String(v) !== String(a2.id));
        d.announcements.unshift(a2);
        await save(d);
        return json(a2);
      }
      if (m === "PATCH" && /^\/api\/admin\/announcements\/[^/]+$/.test(p)) {
        const x = await readJSON(request), a2 = d.announcements.find((a3) => a3.id === p.split("/").pop());
        if (!a2) return json({ error: "Announcement not found." }, 404);
        d.settings.deletedAnnouncementIds = (d.settings.deletedAnnouncementIds || []).filter((v) => String(v) !== String(a2.id));
        if (typeof x.published === "boolean") a2.published = x.published;
        if (x.title !== void 0) a2.title = cleanString(x.title, 200) || a2.title;
        if (x.body !== void 0) {
          a2.body = richBody(x.body, 4e4);
          a2.format = "html";
        }
        if (x.media !== void 0 || x.attachments !== void 0) {
          const old = Array.isArray(a2.media) && a2.media.length ? a2.media : Array.isArray(a2.attachments) ? a2.attachments : [];
          a2.media = normaliseAttachments(x.media !== void 0 ? x.media : x.attachments);
          const keep = new Set(a2.media.map((f) => f.key));
          for (const f of old) if (f.key && !keep.has(f.key)) await deleteFile(f.key);
        }
        a2.attachments = a2.media;
        a2.bodyFormat = a2.format;
        await save(d);
        return json(a2);
      }
      if (m === "DELETE" && /^\/api\/admin\/announcements\/[^/]+$/.test(p)) {
        const id = p.split("/").pop(), i = d.announcements.findIndex((a2) => a2.id === id);
        if (i < 0) return json({ error: "Announcement not found." }, 404);
        const [removed] = d.announcements.splice(i, 1);
        d.settings.deletedAnnouncementIds = Array.isArray(d.settings.deletedAnnouncementIds) ? d.settings.deletedAnnouncementIds : [];
        if (!d.settings.deletedAnnouncementIds.includes(String(id))) d.settings.deletedAnnouncementIds.push(String(id));
        if (d.settings.deletedAnnouncementIds.length > 5e3) d.settings.deletedAnnouncementIds = d.settings.deletedAnnouncementIds.slice(-5e3);
        await save(d);
        for (const f of removed.media || removed.attachments || []) await deleteFile(f.key);
        return json({ ok: true, id });
      }
      return json({ error: "Admin endpoint not found." }, 404);
    }
    return json({ error: "API endpoint not found." }, 404);
  } catch (e) {
    console.error("API failure", p, e);
    return json({
      error: "The server could not complete that request. Reason: " + (e?.message || "unknown error"),
      path: p,
      storage: storageReport(),
      requestId: crypto.randomUUID(),
      retryable: true
    }, e?.storageUnavailable || e?.status === 503 ? 503 : e?.badRequest ? 400 : 500);
  }
}

/* The default export is the platform-agnostic request handler. EdgeOne Node
 * Function entry points (node-functions/api/*.js) bind the request context and
 * then delegate to it, and the in-app runtime updater validates that a
 * published api-core.js still exposes it.
 */
export default handler;
export { handler };
