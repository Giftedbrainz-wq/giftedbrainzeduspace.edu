# v12.17.0 — Transactional Study Communities

- Added opt-in SQL-authoritative community creation, discovery, pending requests, joins, removals, Community Lead transfers and leave/dissolve operations.
- Member limits and room-authorisation changes are enforced inside SQL transactions, not unlocked shared-Blob updates.
- Added account-deletion cleanup for SQL memberships and optional staging backfill with strict preflight and no production writes.
- Added tests for SQL cutover gating, role permissions, non-Blob community mutation, SQL failure behaviour and migration guards.
- Retained v12.16 messaging, student partnerships and all previously approved mobile/CBT/YouTube layouts.
- **Disabled by default:** requires v12.14-v12.17 migrations, validated staging backfill, and server-only environment variables.
- No production database has been migrated or load-tested by this release.
