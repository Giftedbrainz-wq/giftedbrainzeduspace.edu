# EduSpace v12.14.0 — Messaging infrastructure foundation

- Added optional server-side Supabase/PostgreSQL store for private chats and Study Communities, isolating new message writes from the shared Blob record.
- Included RLS-protected SQL schema, indexes, server-side RPCs, atomic receipts, reactions and idempotent sends.
- Changed chat refresh to request new or changed messages rather than repeatedly transfer entire conversation history; full reconciliation remains for recovery.
- Preserved historic Blob conversations, existing memberships, blocking and Community Lead permissions, plus all the v12.13.0 mobile layouts and fonts.
- Added server-only feature flag/configuration, authenticated readiness endpoint, integration tests and a staging-only latency harness.
- **Not live:** The SQL and environment settings must be deployed and tested separately. This stage does not yet implement WebSockets, transactional identity storage or demonstrated 1,000-user capacity.
- Read `INFRASTRUCTURE_SETUP_v12.14.0.md` before enabling the optional backend.
