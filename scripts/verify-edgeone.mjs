/* ------------------------------------------------------------------
   Fails the EdgeOne Pages build early if the deployment layout is wrong.

   Nothing here compiles anything: this project ships plain ES modules. The
   check exists because the two most common EdgeOne Pages misconfigurations —
   an output directory that does not point at public/, and Node Function entry
   files that were not committed — both produce a site that loads but answers
   every /api/ request with HTML, which is confusing to diagnose in the browser.
------------------------------------------------------------------- */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const required = [
  "edgeone.json",
  "package.json",
  // Node Function routes. Only files that export onRequest become routes, so
  // the catch-all and the bare /api entry both have to exist.
  "node-functions/api/[[default]].js",
  "node-functions/api/index.js",
  "node-functions/api/ping.js",
  // Shared modules imported by the routes above (not routes themselves).
  "node-functions/lib/api-core.js",
  "node-functions/lib/seed.js",
  // Static site.
  "public/index.html",
  "public/login.html",
  "public/api.js",
  "public/sw.js"
];

const missing = required.filter((p) => !fs.existsSync(path.join(root, p)));
if (missing.length) {
  console.error("Gifted Brainz EdgeOne deploy check failed. Missing:");
  for (const p of missing) console.error(" - " + p);
  process.exit(1);
}

let config;
try {
  config = JSON.parse(fs.readFileSync(path.join(root, "edgeone.json"), "utf8"));
} catch (e) {
  console.error("Gifted Brainz deploy check failed: edgeone.json is not valid JSON — " + e.message);
  process.exit(1);
}

const output = String(config.outputDirectory || "").replace(/^\.\//, "").replace(/\/$/, "");
if (output !== "public") {
  console.error(`Gifted Brainz deploy check failed: edgeone.json outputDirectory must be "public" (found "${config.outputDirectory}").`);
  process.exit(1);
}

// The single-page fallback must be written exactly like this, because EdgeOne
// special-cases this precise rule so that static files and function routes are
// matched first. Any other form would be treated as an ordinary rewrite and
// would answer /api/* with index.html.
const spa = (config.rewrites || []).some((r) => r && r.source === "/*" && r.destination === "/index.html");
if (!spa) {
  console.error('Gifted Brainz deploy check failed: edgeone.json needs the SPA fallback rewrite {"source":"/*","destination":"/index.html"}.');
  process.exit(1);
}

// Leftovers from the previous Netlify layout would be ignored by EdgeOne but
// are a reliable sign that a deploy is being made from a stale tree.
const stale = ["netlify.toml", "netlify", "public/_redirects", "public/_headers"].filter((p) => fs.existsSync(path.join(root, p)));
if (stale.length) {
  console.error("Gifted Brainz deploy check failed: remove leftover Netlify configuration:");
  for (const p of stale) console.error(" - " + p);
  process.exit(1);
}

// The runtime updater rejects a published bundle whose core has no default
// export, so catch that here rather than after an upload.
const core = fs.readFileSync(path.join(root, "node-functions/lib/api-core.js"), "utf8");
if (!/export\s+default\s+handler/.test(core)) {
  console.error("Gifted Brainz deploy check failed: node-functions/lib/api-core.js must export the handler as its default export.");
  process.exit(1);
}

console.log("Gifted Brainz EdgeOne deploy check passed: static site in public/, Node Functions in node-functions/, SPA fallback configured.");
