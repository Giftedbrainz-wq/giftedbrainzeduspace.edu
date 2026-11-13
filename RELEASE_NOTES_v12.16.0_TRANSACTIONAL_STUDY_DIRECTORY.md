# EduSpace v12.16.0 — Transactional Study Partners directory

This release preserves Plus Jakarta Sans, compact mobile layouts, CBT, the actual YouTube video thumbnails, Arena, announcements, Study Partners and Study Communities. Assessment Hub is unchanged.

### Added (off by default)
- Separate SQL student directory with server-filtered, paginated Explore Students responses and SQL online status.
- Postgres-transactional partnership requests, accept/decline, removal and blocking; unique unordered partner pairs, per-pair advisory locks, 30-partner limit and room access revocation.
- SQL Study Partners chat-list source; SQL-based permissions for messages and WebSocket tickets once explicitly enabled.
- One-row SQL presence updates instead of repeated whole-application Blob writes.
- Guarded migration/backfill, staging load probe, and fail-closed SQL outage behaviour.
- Public profile mirroring for registration, login and profile edits without copying private account credentials.

### Safeguards
- New relationship source requires `GB_STUDY_DIRECTORY_BACKEND=supabase` **and** `GB_STUDY_DIRECTORY_CUTOVER_APPROVED=true`, in addition to the existing SQL chat backend.
- Historical Blob relationship and message records are preserved; no live system has been migrated from this ZIP.
- Never turn off SQL authority after live writes without reconciled rollback.

### Verification
Local test suite, new mocked end-to-end relationship tests, schema-policy assertions, JS syntax and asset build were run. Live Supabase migration execution, WebSocket handshakes, actual p95 latency and high-concurrency behaviour are **not verified** here.

See `INFRASTRUCTURE_SETUP_v12.16.0.md` before applying the migration.
