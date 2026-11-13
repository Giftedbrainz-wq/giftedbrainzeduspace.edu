# Gifted Brainz EduSpace v12.15.0 — Authenticated WebSocket delivery and SQL directory

**Status:** Source implementation only. The new transport is OFF by default. Nothing changes on the live website until the SQL migrations are successfully deployed, validated, and the new environment switch is enabled. Assessment Hub is unaffected.

## What's new

- Supabase private Realtime Broadcast over TLS WebSockets (browser → Supabase, **not** through an EdgeOne serverless WebSocket).
- Every Realtime subscription obtains a **short-lived, HMAC-signed student subscriber JWT** from the authenticated EduSpace server. Never send service/secret keys to the browser.
- WebSocket topics are scoped to accepted, unblocked private partnerships and members of a Study Community. Revoked memberships are removed in SQL and new tickets are refused.
- SQL database triggers send **only a change notification**. Actual message text, edits, reactions and receipts are fetched through EduSpace's authenticated API. Bulk read receipt updates broadcast once per room/statement, not once per row.
- Missing notifications, mobile sleep and reconnects are repaired by periodic HTTP reconciliation; the existing 3.5-second incremental polling remains as a fallback when Realtime is unavailable.
- New SQL tables mirror student directory profiles, partnership relationships, community metadata, memberships and allowed room subscribers. A staging-only import utility is included to backfill these from an authorised export.

**What is not yet migrated:** EduSpace account login, authoritative partnership/community writes and legacy history still reside in the original Blob-backed application data. This release prepares the transactional separation, but it does not claim a complete identity/relationship cutover. Keep existing Blob data and backups.

## Migration order — STAGING first

1. Back up the existing EdgeOne Blob application dataset and the existing Supabase messaging database. Keep the source export PRIVATE; it may contain personal data and authentication hashes. Do not attach it to tickets, commit it, or ship it inside a ZIP.
2. Deploy this v12.15.0 **source code to a staging EdgeOne Pages environment** with `GB_CHAT_REALTIME_ENABLED` unset.
3. In Supabase SQL Editor, first run the previous base migration:
   `database/20261111_study_message_store.sql` (if it has not already run).
4. Next run **`database/20261111_study_realtime_and_directory.sql`** in the **same Supabase project**. This adds new tables, service-only RPCs, private-topic RLS and database broadcast triggers. Realtime's `realtime.messages` table already has RLS; do not try to enable it manually.
5. In Supabase **Realtime Settings**, turn off **Allow public access**. Realtime private channels must be authorised using the RLS policy from the new migration.
6. Check these SQL queries:

   ```sql
   select to_regclass('public.gb_study_messages') as messages,
          to_regclass('public.gb_study_students') as students,
          to_regclass('public.gb_study_partnerships') as partnerships,
          to_regclass('public.gb_study_community_members') as community_members,
          to_regclass('public.gb_study_room_members') as realtime_rooms;

   select policyname from pg_policies where schemaname='realtime'
     and tablename='messages' and policyname='gb_study_receive_v1215';

   select relrowsecurity from pg_class
     where oid='public.gb_study_room_members'::regclass;
   ```

   All five relations must exist, the policy must be present, and `relrowsecurity` must be `true`.
7. On a secure computer containing a **staging copy** of the original application Blob JSON export, preview the import (dry-run):

   ```bash
   node scripts/backfill-study-directory.mjs --file=/secure/location/export.json
   ```

   After checking its counts, set **staging Supabase** server credentials and run:

   ```bash
   GB_CHAT_BACKFILL_TARGET=STAGING node scripts/backfill-study-directory.mjs \
     --file=/secure/location/export.json --apply --staging
   ```

   The tool is idempotent and will sync student directory entries, partnerships, community listings and private room access. It **does not erase original EduSpace accounts or chat history**. Never run it against production without a separately reviewed cutover plan.
8. Set the following variables in **staging EdgeOne server-side environment settings** (not in static files):

   ```text
   GB_CHAT_BACKEND=supabase
   GB_CHAT_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   GB_CHAT_SUPABASE_SECRET=<server-only Supabase secret key>
   GB_CHAT_REALTIME_ENABLED=true
   GB_CHAT_REALTIME_PUBLISHABLE_KEY=<Supabase publishable key>
   GB_CHAT_REALTIME_JWT_SECRET=<server-only Supabase HS256 JWT signing secret>
   ```

   **Critical signing restriction:** `GB_CHAT_REALTIME_JWT_SECRET` must be the signing secret for the *same* Supabase project, **not** a newly invented random string, and **not** the service/secret API key. This implementation signs HS256 JWTs; if your project only supports asymmetric JWT signing keys, **do not enable this flag** until the token signer is adapted to that signing-key mechanism. A mismatched secret will cause `InvalidJWT` join failures. Only `GB_CHAT_REALTIME_PUBLISHABLE_KEY` may be returned to the browser.
9. Redeploy staging. As a signed-in student, check `GET /api/learning/messaging/status` for `backend:"supabase"` and `transport:"websocket"`. In the browser developer tools, open a valid Study Chat and verify a `wss://...supabase.co/realtime/v1/websocket` connection and a successful `phx_join` to a **private** topic.
10. **Security acceptance tests:** two accepted partners must receive updates; an unrelated account, blocked account, unaccepted request, or removed community member must be refused a new ticket and unable to join a new channel. Check community access and the 20-member limit. Test message sends, edits, reactions, deletions and receipts on two browsers. Test background/foreground, disconnect/reconnect, and a phone network switch.
11. Test actual latency on staging (`scripts/chat-staging-load.mjs`) before planning a production cutover. The client receives a change event and performs an authenticated delta fetch; measured time therefore includes both WebSocket push and the API round trip.

## Security and rollback

- The source app continues to validate account sessions and every message operation server-side. The WebSocket is a **read-only change notification** channel; browsers cannot publish database broadcasts or read database messages.
- Subscriber tokens last **120 seconds** and refresh every ~55 seconds. Realtime can cache per-connection RLS until refresh, so a removed member may remain connected for a short period after revocation. This is NOT immediate socket termination; test it and consider shorter TTL if necessary. API requests are authorised independently.
- If staging Realtime is unavailable, browsers fall back to authenticated incremental HTTP polling. Never set `GB_CHAT_BACKEND=legacy` after storing live SQL messages without first migrating that history, or users will lose visibility of new chat data.
- SQL metadata is **mirrored**, not the authoritative record for account login or membership mutations in this version. Do not delete `learningPartners`, `learningCommunities`, `users` or their historical data from Blob.
- Rate limits, private-relationship checks and student IDs remain validated in the authenticated EdgeOne API, never by user-supplied room strings.
- Keep Supabase secret API keys, JWT signing keys, and the original data export outside public source and logs. Use a dedicated staging project when possible.

## Tests and limitations

Local tests:

```bash
npm run test:all
npm run test:chat:realtime
npm run build:assets
```

These are simulated backend and browser-protocol checks. They do **not** execute your SQL in a live Supabase instance, verify a real WebSocket handshake, or establish capacity for thousands of concurrent users. Cloud costs, quotas, connection limits and real latency must be measured on staging with your actual provider settings before a production rollout.
