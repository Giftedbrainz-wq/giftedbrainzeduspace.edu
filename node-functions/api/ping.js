/* ------------------------------------------------------------------
   EdgeOne Pages Node Function — dependency-free deployment probe.

   This route imports nothing, so a successful response proves that Node
   Functions are deployed and routing correctly even when storage or
   environment configuration is broken. A static file name takes precedence
   over the [[default]] catch-all, so /api/ping always lands here.
------------------------------------------------------------------- */
export function onRequest() {
  return new Response(
    JSON.stringify({ ok: true, functions: true, runtime: "edgeone-node-function", time: Date.now() }),
    { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }
  );
}
