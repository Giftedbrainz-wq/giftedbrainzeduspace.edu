GIFTED BRAINZ EDUSPACE v12.18.0 — GitHub → EdgeOne source release

1. Back up your currently deployed GitHub branch.
2. Extract this source ZIP and copy the contents (not an enclosing folder) to your existing repository checkout.
3. Commit/push to a NEW STAGING BRANCH. Do not push directly to your live branch yet.
4. EdgeOne Git build configuration: install `npm ci`, build `node scripts/build-assets.mjs && node scripts/verify-edgeone.mjs`, output `public`.
5. Preserve existing EdgeOne environment variables, especially server secrets and any Supabase settings. Do not put them into GitHub.
6. Test `/api/ping`, registration, login and Remember Me, admin log-in/actions, support, Arena, PDFs, announcements, Study Partners, uploads, suspension and Assessment Hub linking on staging.
7. Do not enable Supabase SQL cutover without validated backfill and staging reconciliation.
8. Once verified, merge the staging branch through your normal deployment process.
Read RELEASE_NOTES_v12.18.0_CORRECTIONS.md for limitations and changes.
