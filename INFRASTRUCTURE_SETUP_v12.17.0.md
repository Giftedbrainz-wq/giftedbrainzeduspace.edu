# Gifted Brainz EduSpace v12.17.0 — Study Community transactional SQL cutover

**Release scope:** Complete source-code implementation of opt-in transactional Study Community membership, join requests, Community Lead transfers, room-access revocation, and account-deletion cleanup. All features retain their v12.16 legacy behaviour unless a verified staging cutover is explicitly enabled. **No live Supabase database was accessed or modified.** Student passwords/login sessions are still stored by the existing authentication backend, and this release makes no claims of thousands-user capacity.

## What is included

- Atomic Supabase RPC `gb_study_community_mutate`: create, join/request, approve/reject, remove, leadership transfer and leave/dissolve. Postgres row locks prevent two concurrent students from taking the last free place; maximum **20 members**. Limit **five communities led per student**.
- `gb_study_community_snapshot` supplies filtered community discovery, membership details and pending requests through the authenticated EduSpace API. Private invitation codes are not included for non-members. Students cannot grant themselves Community Lead access by changing request bodies.
- Room entitlements are granted/revoked in the same SQL transactions as membership changes. Messaging and Realtime checks use SQL community membership after cutover; an SQL outage fails closed rather than trusting stale Blob relationships.
- `gb_study_community_purge_student` cleans up memberships and pending requests when accounts are deleted, transferring leadership where possible.
- One-time guarded **offline export importer** for staging; no live student exports or credentials are packaged.
- A read-only staging load probe reporting p50/p95/p99 HTTP latencies (not a proof of WebSocket latency or production capacity).

## Activation prerequisites — execute in this order

1. Back up the current EdgeOne Blob data, live Supabase database and current EdgeOne environment configuration. **Freeze Study Community membership modifications** during export/backfill. Use a separate staging database and staging deployment; never upload production student exports into this conversation or repository.
2. Apply these SQL migrations **in the EduSpace Supabase project** in order (the Assessment Hub Supabase project is separate):

   ```text
   database/20261111_study_message_store.sql
   database/20261111_study_realtime_and_directory.sql
   database/20261111_study_directory_cutover.sql
   database/20261111_study_community_transactions.sql
   ```

   This fourth migration does not drop any tables. It enables RLS for pending requests, revokes anonymous access and grants RPC execution only to `service_role`. Verify it in **staging** first. The SQL has not been executed on a real Supabase instance in this environment.
3. Run an *offline dry-run* against a backed-up JSON export of the current EduSpace Blob:

   ```bash
   node scripts/backfill-study-directory-v1216.mjs --file=/secure/offline-export.json
   node scripts/backfill-study-communities-v1217.mjs --file=/secure/offline-export.json
   ```

   Do **not** import if there are duplicate, orphaned, invalid or over-capacity records. Review and fix them in a copy of the export; do not delete real student records blindly.
4. Import **to staging only** after the earlier directory and message imports are complete:

   ```bash
   GB_STUDY_BACKFILL_TARGET=STAGING node scripts/backfill-study-directory-v1216.mjs --file=/secure/offline-export.json --apply --staging
   GB_STUDY_BACKFILL_TARGET=STAGING node scripts/backfill-study-communities-v1217.mjs --file=/secure/offline-export.json --apply --staging
   ```

   Do not re-import the same older snapshot after SQL-authoritative writes have begun. The imports do not delete legacy Blob arrays or message histories.
5. In the **staging** EdgeOne server-side environment, configure:

   ```text
   GB_CHAT_BACKEND=supabase
   GB_CHAT_SUPABASE_URL=https://<STAGING_PROJECT>.supabase.co
   GB_CHAT_SUPABASE_SECRET=<STAGING_SERVER_SECRET>
   GB_STUDY_DIRECTORY_BACKEND=supabase
   GB_STUDY_DIRECTORY_CUTOVER_APPROVED=true
   GB_STUDY_COMMUNITY_BACKEND=supabase
   GB_STUDY_COMMUNITY_CUTOVER_APPROVED=true
   ```

   The flags `GB_STUDY_COMMUNITY_BACKEND=legacy` (default) and `GB_STUDY_COMMUNITY_CUTOVER_APPROVED` absent/false keep the old behaviour. **Never put the Supabase service secret into frontend JS, static files or .env files committed to source control.** Optional Realtime settings and JWT compatibility are documented in `INFRASTRUCTURE_SETUP_v12.15.0.md`.
6. In staging, verify these scenarios with dedicated test accounts: create a public and a private community; request approval; send invalid invite code; accept/reject; 20-member limit under two simultaneous joins; member removal; transfer Community Lead; leave/dissolve; message access revoked immediately; delete member/leader; revoke and reconnect a WebSocket; preserve old messages and successful login. Check that a newly created community **does not** appear as a new entry in the legacy Blob `learningCommunities` array.
7. Verify database counts, membership/room permission symmetry and pending requests using SQL:

   ```sql
   select count(*) from public.gb_study_community_directory;
   select count(*) from public.gb_study_community_members;
   select count(*) from public.gb_study_community_requests;
   select community_id,count(*) from public.gb_study_community_members
    group by community_id having count(*)>20;
   select c.id from public.gb_study_community_directory c
    where not exists(select 1 from public.gb_study_community_members m
      where m.community_id=c.id and m.user_id=c.lead_id and m.role='lead');
   select m.community_id,m.user_id from public.gb_study_community_members m
    where not exists(select 1 from public.gb_study_room_members r
      where r.room_key='c:'||m.community_id and r.user_id=m.user_id);
   ```

   All queries for over-capacity, missing leads and missing room permissions should return **zero rows**. Reconcile counts and representative IDs against the authorised offline export.
8. Run the local checks and the **read-only staging** load probe:

   ```bash
   npm ci
   npm run build:assets
   npm run test:all
   GB_STUDY_STAGING_URL=https://your-staging-site.example \
   GB_STUDY_TEST_TOKENS='["TEST_TOKEN_1","TEST_TOKEN_2"]' \
   npm run test:study:communities:staging
   ```

   Test realistic device networks, WebSocket disconnect/reconnect and server errors separately. These tests do not establish production capacity; increase concurrent staging accounts gradually and watch database quotas and p95 latency.

## Rollback and data safety

- Before enabling SQL authority, a normal code rollback is safe. Once students create/edit communities in SQL, **do not simply revert the flag to `legacy`**: doing so would discard newer SQL relationships and could restore revoked permissions. Freeze mutations and reconcile SQL → Blob with an audited procedure first.
- If the SQL database becomes unavailable after cutover, Study Community permissions must **fail closed**. You may disable `GB_CHAT_REALTIME_ENABLED` and return to authenticated polling without switching the directory's data authority.
- **Do not delete** `users`, `learningCommunities`, `learningCommunityMessages` or other legacy Blob arrays before separate authentication, history migration and retention review.
- The Assessment Hub app and its Supabase tables are not modified by v12.17.

## Still required before calling the whole platform infrastructure finished

This ZIP finishes the **code-side Study Community SQL migration stage**. The full infrastructure work cannot responsibly be marked complete without a real Supabase migration, backfill reconciliation, EdgeOne staging deployment, permission testing, load tests and monitoring. Student authentication/role records remain authoritative in legacy storage, and converting passwords/sessions needs a separately audited identity migration, not a blind automated transfer. The system is deliberately not switched over on production by this release.
