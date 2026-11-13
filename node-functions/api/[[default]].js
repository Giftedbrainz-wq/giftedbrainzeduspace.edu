/* ------------------------------------------------------------------
   EdgeOne Pages Node Function — catch-all API entry point.

   File-based routing: the `[[default]]` segment makes this function handle
   every path under /api/ that no more specific file matches (for example
   /api/login, /api/dashboard, /api/files/uploads/x.png).

   All application logic lives in ../lib/api-core.js. Files inside
   node-functions/lib/ do not export an `onRequest` handler, so EdgeOne treats
   them as plain modules rather than routes.
------------------------------------------------------------------- */
import handler, { runWithContext } from "../lib/api-core.js";

export async function onRequest(context) {
  // Hand the platform context (env vars, client IP, blob binding) to the core
  // before it runs, since Node Functions expose them per request rather than
  // through a global process environment.
  return runWithContext(context, () => handler(context.request, context));
}
