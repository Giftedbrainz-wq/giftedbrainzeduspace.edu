# EduSpace v12.15.0 — Real-time messaging infrastructure (staged)

- Added read-only private WebSocket change notifications for Study Partners and Study Communities, delivered via Supabase Realtime Broadcast. Existing authenticated HTTP API remains the source of message content.
- Added short-lived authenticated Realtime tickets and restricted topic membership SQL RLS, revoked on partnership/community membership mutations.
- Added SQL directory/partnership/community metadata mirror tables and a staged, opt-in backfill utility; the original Blob remains the login/permission authority until the final identity cutover.
- Added more efficient statement-level database broadcasts, a 45-second reconciliation fallback while connected, and 3.5-second polling when the WebSocket is unavailable.
- Did not change Assessment Hub, video thumbnails, CBT visual design, or font.
- New infrastructure is disabled until the new SQL migration is run, directory backfill reviewed, and EdgeOne secrets are configured. Tested locally with simulated Supabase REST and Phoenix WebSocket behaviour; live verification remains outstanding.

See `INFRASTRUCTURE_SETUP_v12.15.0.md` for the migration, rollback, safety and testing checklist.
