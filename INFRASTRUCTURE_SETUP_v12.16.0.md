# Gifted Brainz EduSpace v12.16.0 — SQL study-directory cutover (staging only)

**Deploy status:** Source only; no migration has been run on the live Supabase project. **The new SQL authority is OFF by default.** This release does not migrate passwords/login sessions, completed CBTs or all Study Communities. It moves the **Study Partners directory, partnership mutations, blocks and opt-in online presence** onto SQL when the explicit cutover setting is enabled. Legacy data is retained.

## What changes

- SQL becomes the authoritative source for accepted/pending/declined Study Partnerships and blocks, rather than shared-Blob arrays, once enabled. Requests, acceptance, declines, removals and blocks run through one Postgres transaction using locks and a uniqueness constraint. Revoked partner rooms lose SQL Realtime entitlement in the same transaction.
- Explore Students reads public-only student directory fields with SQL pagination and excludes blocked profiles; chat list partners and online indicators read SQL rows. Presence updates one student row instead of rewriting the whole Blob.
- Account registration, login and profile updates mirror *public* directory attributes (no email, passwords, WhatsApp or tokens). Mirror failures are logged for reconciliation and do not misrepresent a successful account registration as a failure.
- Student login, account-status enforcement, legacy chat history and some shared learning/Study Community features still load their original Blob state. These are future migration stages; don't delete those arrays yet.
- No live latency or concurrency claims are made by local mocked tests.

## Prerequisites and order

1. **Freeze study partnership mutations** during the export/backfill/cutover maintenance window. Back up the original EduSpace EdgeOne Blob JSON, SQL database, and deployment variables. Treat exported student records as confidential; never upload them to this chat, source repo or public ZIP. Use a staging Supabase project for the trial.
2. Run the prior migrations in order in the **EduSpace Supabase SQL Editor** (not the Assessment Hub project):
   1. `database/20261111_study_message_store.sql` (v12.14)
   2. `database/20261111_study_realtime_and_directory.sql` (v12.15)
   3. `database/20261111_study_directory_cutover.sql` (**NEW v12.16**)

   The new migration **intentionally refuses** to create its unordered-pair uniqueness index if older data contains duplicate partner pairs; review them manually instead of dropping records automatically. Existing rows, messages and community history are not deleted by this migration. All new RPCs are `SECURITY INVOKER` and executable only by `service_role`; the study block table has RLS enabled.
3. Before importing, test for duplicate unordered partnerships:

   ```sql
   select least(from_id,to_id) as student_a, greatest(from_id,to_id) as student_b,
          count(*) as duplicate_count
   from public.gb_study_partnerships
   group by 1,2 having count(*)>1;
   ```

   Resolve duplicates with a reviewed data-reconciliation plan, never by blanket deletion.
4. Validate your *offline, authorised* Blob JSON export:

   ```bash
   node scripts/backfill-study-directory-v1216.mjs --file=/secure/export.json
   ```

   If it reports skipped or duplicate pairs, do not apply or enable cutover.
5. Import into a staging SQL project with explicit write protection:

   ```bash
   GB_STUDY_BACKFILL_TARGET=STAGING node scripts/backfill-study-directory-v1216.mjs \
      --file=/secure/export.json --apply --staging
   ```

   Run the **v12.15 community/room backfill** for community membership if not done already. The new importer adds public student profiles, partnerships and blocks and revokes blocked partner room subscriptions. It does **not** drop historical data. Do not run this importer after live SQL writes have started: an older snapshot can recreate removed partnerships.
6. Check counts and missing users:

   ```sql
   select (select count(*) from public.gb_study_students) as students,
          (select count(*) from public.gb_study_partnerships) as partnerships,
          (select count(*) from public.gb_study_blocks) as blocks;

   select count(*) as orphaned_pairs from public.gb_study_partnerships p
    where not exists(select 1 from public.gb_study_students s where s.id=p.from_id)
       or not exists(select 1 from public.gb_study_students s where s.id=p.to_id);

   select relrowsecurity from pg_class where oid='public.gb_study_blocks'::regclass;
   ```

   `orphaned_pairs` should be zero, and `relrowsecurity` true. Compare row counts **and representative IDs/statuses** to the authorised export; counts alone do not establish correctness. Verify the `gb_study_partner_mutate` and `gb_study_student_search` functions and their grants.
7. Deploy v12.16.0 code to an isolated **EdgeOne staging environment** initially using:

   ```text
   GB_CHAT_BACKEND=supabase
   GB_CHAT_SUPABASE_URL=https://<STAGING_PROJECT>.supabase.co
   GB_CHAT_SUPABASE_SECRET=<STAGING server-only secret key>
   GB_STUDY_DIRECTORY_BACKEND=legacy
   GB_STUDY_DIRECTORY_CUTOVER_APPROVED=false
   ```

   Check that the baseline user experience still works. Then, **after backups and SQL reconciliation**, turn on only for staging:

   ```text
   GB_STUDY_DIRECTORY_BACKEND=supabase
   GB_STUDY_DIRECTORY_CUTOVER_APPROVED=true
   ```

   `GB_CHAT_REALTIME_ENABLED=true` is optional and requires the prior v12.15 JWT/Realtime setup; SQL partnerships work without a WebSocket. Keep all secrets server-side. **Don't put any Supabase service key or database password in frontend files.**
8. With two staging student accounts, verify these flows: Explore Students search/pagination/online status, request → accept → chat, opposite-direction duplicate request, rejected invitation, unblock policy, block → immediate message denial → no new WebSocket ticket, removal, login/profile name update, and student deletion. Run the provided scripted mock regression suite first:

   ```bash
   npm ci
   npm run build:assets
   npm run test:all
   ```

9. Measure actual backend latency with dedicated **staging accounts** (not real learners):

   ```bash
   GB_STUDY_STAGING_URL=https://your-staging-site.example \
   GB_STUDY_TEST_TOKENS='["TEST_TOKEN_1","TEST_TOKEN_2"]' \
   node scripts/study-directory-staging-load.mjs
   ```

   The script rejects non-staging hostnames and measures p50/p95/p99 **HTTP response** latency and failures for chat-list and directory reads. It does not claim to measure end-to-end WebSocket latency or true 1,000-user scale. Increase staging test accounts in controlled increments after checking rate limits and backend quotas.

## Release rules and recovery

- **Never switch directly on the live website.** Until SQL backfill/acceptance have passed, leave `GB_STUDY_DIRECTORY_BACKEND=legacy`. The default behaviour matches v12.15.
- If SQL is down *after* cutover, Study Partner actions **fail closed**. This is intentional: falling back to stale Blob partnerships would allow revoked users to re-enter conversations. Return an error and resolve SQL connectivity.
- Once SQL-authoritative writes have begun, **do not simply change the flag back to `legacy`**. That would hide newer SQL relationships and could resurrect removed partnerships. A proper rollback needs a brief maintenance window plus a validated SQL → Blob relationship reconciliation (not provided as an automatic button in this release). You can separately disable `GB_CHAT_REALTIME_ENABLED` to revert from WebSockets to authenticated incremental polling while preserving SQL authority.
- Never remove `users`, `learningPartners`, `learningBlocks`, `learningCommunities`, `learningCommunityMessages` or other legacy arrays from existing production data during this migration.
- Existing Assessment Hub linking and data are not modified by this release.

## Remaining infrastructure work

Student authentication and role changes are still Blob-backed; full transactional identity cutover needs a separate design and security review, including safe password migration, session revocation, user deletion reconciliation and account uniqueness. Study Communities still use original authoritative membership storage. Load-test real Supabase Realtime channels, reconnect handling, DB indexes and provider quotas on staging before promising high concurrency.
