# Gifted Brainz EduSpace 12.21.0 — Battle Arena bank browser and branding

Based on full supplied EduSpace 12.20.0 source. An update package, not an already deployed site.

## Fixes
- Admin Brainz Battle Arena question bank now supports search, subject filter, subject-count chips, 25-question pages, and one-click expand/collapse question previews (including passage, options, answer, explanation, diagram).
- Admin-only bulk deletion: selected subject or ALL Battle Arena questions. Explicit phrase confirmation required, with confirmation enforced on the server. Existing regular EduSpace question bank and battle match history are unaffected. **Deletion is irreversible. Back up storage before use.**
- My Learning Centre continues to show one-time link creation while the user has fewer than two active Assessment Hub device links. The actual link endpoint continues enforcing a two-device maximum.
- Subtle navy, white and restrained gold branding across student and admin pages.
- Browser cache-busting asset URLs updated to 12.21.0. Outdated published API runtimes older than 12.21.0 are not allowed to override these fixes.

## Deployment
1. Back up EduSpace storage, EdgeOne deployment and environment configuration.
2. Deploy this entire source ZIP to the *existing* EduSpace EdgeOne application, preserving secrets and storage. Keep npm dependency installation as in your EdgeOne project. Never publish the `node_modules` local test stub.
3. Test login, admin Battle question viewing and filtering, single-question edit, subject-only deletion on **test records**, whole-bank deletion on **test records**, My Learning Centre linking of 0, 1 and 2 devices and branded views on phone/laptop.
4. Do not assume production testing or a live database migration was performed in this editing environment. This release adds no new SQL migrations.

The bulk-delete implementation operates on **Brainz Battle Arena questions**, not the separate EduSpace study Question Bank.
