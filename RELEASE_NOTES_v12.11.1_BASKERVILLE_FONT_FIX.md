# Gifted Brainz EduSpace v12.11.1 — Baskerville Old Face font parity

**Cause identified:** The earlier release declared `Baskerville Old Face` in CSS but did not load the Google-hosted `Baskervville` fallback that Assessment Hub uses. Devices without the proprietary Baskerville Old Face installed therefore rendered Georgia or Times New Roman. This made the websites look different.

**Fix:** All EduSpace HTML screens now load the same Baskervville web stylesheet and connection hints as the Assessment Hub. The font stack retains `Baskerville Old Face` first, followed by Baskerville, Baskervville and Georgia. Typography selectors cover headings, labels, controls and cards. KaTeX mathematical rendering and code monospacing are retained. No font binaries are included.

**Cache refresh:** Service worker, page script versions, API version and project manifest are updated to 12.11.1, and `/styles.css` now uses `?v=12.11.1` so previously cached CSS should not mask the change after deployment.

**Important:** Exact Baskerville Old Face rendering depends on that font being installed on the student's device or a properly licensed webfont being hosted by the operator. On other devices, Google-hosted Baskervville provides the same fallback behaviour as Assessment Hub. If Google Fonts is blocked or offline, the browser will fall back to Georgia.

**Scope:** Typography and release-version changes only; CBT, Arena, chat, video-thumbnail previews, channel prompts, and integrations are preserved.
