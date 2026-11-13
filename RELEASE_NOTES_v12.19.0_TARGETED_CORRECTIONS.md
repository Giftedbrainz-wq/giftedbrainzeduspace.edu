# Gifted Brainz EduSpace v12.19.0 — targeted corrections

Base: v12.18.0 GitHub ZIP. Only changes from the November 12 correction round are included.

- Study chat: dynamically sized conversation panel based on available visual viewport height; composer moves towards the bottom and resizes when mobile keyboard appears. Smaller message bubbles, visible date labels and a compact, accessible message-options menu instead of permanent Reply/Edit/Delete toolbars. Online/offline convention (🟢/⚪) retained.
- Chat links: escaped, HTTP(S)-only URL linkification, including study-community invite parameters, in private/community messages. Links open with `noopener noreferrer`.
- Material PDFs: PDF.js rendering now separates CSS scale from physical canvas pixels, preserves page proportions and uses vertical document flow. Browser-native reader remains the fallback if PDF.js cannot be loaded. Mobile device testing required.
- Remember Me: homepage student-login button directs an existing remembered session to the dashboard without displaying the login form first. Backend session validation and redirect to login remain required for stale sessions.
- Assessment Hub: existing signed event synchronisation now accepts two independently linked browser devices under one EduSpace account. Link-code generation no longer replaces the previous active device record. Generates only one outstanding code at a time and refuses a third link. Integration status returns linkedDevices and maxDevices. Each linked browser can use Assessment Hub's existing unlink mechanism. Existing data and sign-in secrets unchanged.

**Important limits:** the two-link check currently runs in the existing EduSpace storage operation and must be stress-tested under simultaneous linking; no Supabase-level atomic constraint on the EduSpace user ID is added in this release. Realtime, email and Blob-storage cutovers are NOT enabled. No migrations are required for this change, provided the v2 linking table and the server-to-server shared secret already exist.

**Staging checklist:** On a 320px/375px Android or iPhone browser, open chats and keyboard, verify message bottom area, send a community invitation link, preview a multi-page PDF, sign in with Remember Me then revisit, link a second Hub browser and attempt a third, submit distinct CBTs on both and confirm Learning Centre results/available corrections. Check that logout/suspended sessions still require login. Do not deploy production without staging verification.
