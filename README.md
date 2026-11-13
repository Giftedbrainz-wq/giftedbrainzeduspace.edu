## Current release: v12.18.0

See `INFRASTRUCTURE_SETUP_v12.18.0.md` and `RELEASE_NOTES_v12.18.0_TRANSACTIONAL_COMMUNITIES.md`. Transactional community SQL mode is opt-in; existing behaviour remains the default.

# Gifted Brainz EduSpace — v12.16.0

This is **EduSpace**, not Assessment Hub. Frontend source is in `public/`, EdgeOne API handlers in `node-functions/`, source graphics in `assets/` and SQL migrations in `database/`. The existing student design, learning materials, CBT, video previews, chat, communities and Battle Arena are preserved.

**Default behaviour stays unchanged.** The new transactional SQL Study Partners directory is a **staging-gated opt-in**, not activated in the live application. It requires v12.14 and v12.15 SQL migrations, the new v12.16 SQL migration, a private student directory backfill and two explicit environment switches.

**Read [`INFRASTRUCTURE_SETUP_v12.16.0.md`](INFRASTRUCTURE_SETUP_v12.16.0.md) before deployment.** Do not delete student or chat records or publish database secrets. Typical local checks: `npm ci`, `npm run build:assets`, `npm run test:all`.
