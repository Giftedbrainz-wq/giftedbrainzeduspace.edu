/* ------------------------------------------------------------------
   EdgeOne Pages Node Function — bare /api entry point.

   A `[[default]]` catch-all does not match the parent path itself, so /api
   needs its own file. It delegates to exactly the same handler, which replies
   with the API index/health payload.
------------------------------------------------------------------- */
import handler, { runWithContext } from "../lib/api-core.js";

export async function onRequest(context) {
  return runWithContext(context, () => handler(context.request, context));
}
