# Gifted Brainz EduSpace v12.18.0 — Targeted correction release

Starting source: **EduSpace_v12_17_GitHub.zip** (GitHub → EdgeOne Pages). This release implements the current 32-item change request, not an unrelated redesign.

## Corrections included

1–6. Welcome intro auto-exit (no Skip Intro), remove Install App controls, editable email-based name suggestion without sending email, optional secure 30-day remembered sign-in and logout, remove homepage Need Help/visible number, standalone support page with green WhatsApp button. `GB_SUPPORT_WHATSAPP_NUMBER` may be set to the intended international-format WhatsApp number on **EdgeOne server-side**.

7–8. Distinguish Arena team icons using varied colours/shapes; show five recent matches and a dedicated expanded history screen. Retain leaderboard.

9. PDF material viewer uses continuous page flow with responsive PDF.js canvases and no card-per-page overlap.

10–12. Five announcement replies in the feed, dedicated full discussion, authenticated reply likes, and threaded replies. These announcement likes do not apply to private chats.

13–14. Simplify linked Learning Centre loading and make mobile notification drawer fill the viewport.

15–21. Compact Study Partners messages; remove chat reactions, hide deleted message bubbles, full-screen student details, presence heartbeat and 🟢/⚪ indicators, compressed WebP student and Community Lead photo uploads with server-side size/type checks. Messages retained as moderation evidence remain visible only to authorised moderation workflows.

22–29. Compact admin student records, minimal free-account data, activated/premium subjects controlled by administrator and enforced on server, expandable subject/topic progress, report-only private-message moderation, professional suspended-account prompt and session revocation, natural interface wording.

30–32. Retain optional SQL infrastructure and legacy feature flags, improve mobile CSS, protect previously accepted pages and Assessment Hub integration.

## Important deployment and security notes

- This **source package does not deploy itself**. Use your existing GitHub → EdgeOne pipeline.
- For image assets: `npm ci`; `node scripts/build-assets.mjs && node scripts/verify-edgeone.mjs`; output `public`. The source package excludes generated `public/assets` copies.
- New infrastructure SQL flags stay at their previous safe settings; **do not switch from legacy to Supabase without backfill/reconciliation**.
- The remembered-login cookie is HttpOnly, Secure, SameSite=Strict and expires after 30 days. Its actual persistence and sign-out revocation must be verified on your deployed domain.
- Support phone is not rendered in visible page markup; WhatsApp itself may display the destination number. Server code includes an existing support-number fallback; override with `GB_SUPPORT_WHATSAPP_NUMBER` in EdgeOne if necessary.
- Uploaded profile/community photos are deliberately publicly addressable via their app image endpoint to let other students see avatars; advise students not to upload confidential photos.
- The full test suite depends on `@edgeone/pages-blob` and the live EdgeOne runtime and **could not be executed in this sandbox**. Local static/regression suites and syntax/build checks passed, but live account, concurrency, PDF and mobile browser checks still need staging QA.
- Changes to admin authorisation, photo storage, suspended sessions and chat report visibility should be tested with two student accounts and one administrator before production deployment.
