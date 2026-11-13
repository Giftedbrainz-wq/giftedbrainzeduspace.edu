# EduSpace v12.14.0 — Study Partners / Study Communities infrastructure

## What changed
The original system stored all private/community messages, edits, reactions and read receipts inside one large EdgeOne Blob record. That is costly under concurrent activity. This release introduces an **optional, separately indexed PostgreSQL messaging backend** (Supabase REST), retaining the existing EdgeOne Blob implementation by default.

The new backend supports private conversations and Study Communities using server-validated permissions, database-side message idempotency, atomic reactions and read receipts, edit/delete actions, a per-partner inbox, and fast indexed incremental updates. Client refresh now requests message deltas and uses a periodic full reconciliation; chats still use polling, not WebSockets. Existing historical Blob messages remain visible through a compatibility read path. **Do not delete the old Blob chat data during rollout.**

## Safe activation — do this in staging FIRST

1. Deploy this source project to a **staging** EdgeOne Pages environment. Do not alter production settings yet. Keep a backup of the existing EdgeOne Blob data and preserve current environment values.
2. In a separate or existing **trusted Supabase project**, open **SQL Editor** and run `database/20261111_study_message_store.sql`. This creates `public.gb_study_messages`, indexes, five server-only RPC functions and RLS restrictions. It does **not** modify the Assessment Hub `eduspace_device_links` table.
3. Verify in Supabase SQL Editor:

   ```sql
   select to_regclass('public.gb_study_messages');
   select relrowsecurity from pg_class where oid='public.gb_study_messages'::regclass;
   ```

   Expected: a non-null table name and `true` for RLS. Use the Supabase secret/service-role key only in **server-side EdgeOne environment secrets**, never in source code, static pages, client local storage, logging or this ZIP.
4. Configure these EdgeOne **server-side** environment variables on the *staging EduSpace deployment*:

   ```text
   GB_CHAT_BACKEND=supabase
   GB_CHAT_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   GB_CHAT_SUPABASE_SECRET=<server-only Supabase secret/service-role key>
   ```

   Production is unchanged until you explicitly apply equivalent settings there. With `GB_CHAT_BACKEND` unset, legacy Blob chat remains active.
5. Redeploy staging and sign in with a staging student. Visit authenticated `GET /api/learning/messaging/status`. It should return `backend: "supabase"` and `ready: true`. If the SQL schema/permissions or credentials are incorrect, this request fails rather than silently treating messages as saved.
6. Use two staging student accounts to verify private-chat consent, send/receive, duplicate send prevention, edits, reactions, read receipts, delete-for-me/everyone, messages on two devices, blocked/unfriended access and Study Community membership (including Community Lead moderation and the 20-member limit). Test with existing older messages from the Blob record too.
7. Measure latency using staging only; a safe load harness is in `scripts/chat-staging-load.mjs`. This harness does not run automatically and requires *staging-specific* tokens and user IDs. It refuses obvious production URLs.

## Security and data precautions

- The browser calls only the authenticated EduSpace API. It never receives the Supabase secret, and private/community access continues to be checked by EduSpace before database operations.
- Supabase has RLS enabled and no `anon`/`authenticated` table or function access. The server-only credential carries elevated privileges; it must be managed as a sensitive secret and rotated if disclosed.
- Querying messages is indexed by conversation, time and mutation time. Duplicate sends are blocked by a database unique constraint on `(room_key, sender_id, client_id)`.
- Account deletion removes SQL messages as well as existing Blob learning records. Community dissolution removes that community's SQL messages after the owner is authorised.
- Historical messages are **not automatically migrated or erased**; older messages remain in Blob and new ones go to SQL after activation. This avoids data loss during cutover, but leaves a finite legacy-data cost.
- **Do not switch `GB_CHAT_BACKEND` off after real users have sent new SQL-backed messages** without a verified migration/backup plan. New SQL messages would no longer be displayed by the legacy-only version. If staging fails, correct the SQL/setup before production activation.
- Export/back up the Supabase messaging table and the existing Blob data regularly before enabling live traffic. Apply appropriate retention rules and privacy policies.

## Remaining work / limitations

- This release **does not provide WebSocket push or true instant real-time delivery**. The UI uses incremental polling, typically every 3.5 seconds while visible, plus reconciliation, and optimistically shows outbound messages immediately. A dedicated authenticated real-time transport will need separate infrastructure and security testing.
- Authentication and partnership/community membership still read the shared EduSpace Blob data record. Large-scale concurrent users will require moving identity/membership metadata to a transactional store and testing expiry/revocation rules.
- `npm run test:all` covers local regression, simulated database integration and the legacy fallback. It **cannot validate real Supabase connectivity, credentials, SQL compilation, cold starts, network latency or support for thousands of concurrent users**. The SQL should be executed and validated in staging before production.
- If connecting to the *existing Assessment Hub* Supabase project, do not expose its key to frontend code; use the EduSpace server environment only. Both apps remain independently deployable.
