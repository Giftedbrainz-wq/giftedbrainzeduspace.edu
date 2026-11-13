# Gifted Brainz EduSpace v12.13.0 — Study Partners and mobile organisation

## Changes in this release

- Study Partners now opens a compact conversation list, pending partnerships and joined Study Communities. Explore Students remains a separate directory page.
- Private conversations open on a dedicated full-page messaging screen. Sent messages appear immediately with an in-progress state; the server supplies authoritative confirmation.
- Timestamp format uses hours/minutes only, with Today/Yesterday/calendar date separators.
- Delivery states: sent, delivered when the recipient visits Study Partners, and read when the recipient opens the conversation. Read ticks are green.
- Private messages can be replied to, reacted to, edited (within 15 minutes), deleted locally, or withdrawn for everyone (within 48 hours). Reporting and blocking remain available.
- Conversations retrieve recent messages first, with an option to load older messages.
- Study Communities can be created as public/private and open/approval-based, with a maximum of 20 members including the creator. The creator is called the Community Lead. Leads can accept/reject requests, remove members and transfer leadership. Members can share an invitation link and leave a community.
- Members can exchange messages and reactions inside Study Communities. Leads may moderate messages.
- Mobile headers no longer wrap the full name and Log out button onto a second line. Mobile announcements have compact copy, clearer replies and a short inline reply field. Desktop styles are largely unchanged.
- Source retains Plus Jakarta Sans, real YouTube thumbnails, subject emoji CBT cards, Arena code and earlier performance work.

## Deployment and verification

1. Back up live EduSpace code and data. Install dependencies via `npm ci` and build `node scripts/build-assets.mjs`.
2. Deploy `public/` and `node-functions/` together, with the existing EdgeOne credentials. Do not replace or reset existing student data.
3. The `normalise` step adds empty `learningCommunities` and `learningCommunityMessages` collections to older stored data; no separate SQL migration is required for the existing EduSpace Blob backend.
4. Test with two student accounts: request/accept a partnership, send/read/edit/delete/react to messages, join by invitation, reject unauthorised access, and test a group at 20 members.
5. Verify announcement cards and header at 320px, 375px and desktop. Refresh cached sites after deployment.
6. Keep the Assessment Hub integration secret, environment configuration and separately deployed Hub unchanged unless you are also deploying v50.9.0 for font parity.

## Important capacity limitation

Messaging currently uses the existing EdgeOne Blob-backed API with short-interval polling when chat is open, not a dedicated WebSocket/realtime messaging infrastructure. The first messages render optimistically, but delivery to other users still depends on API response time and polling. This is suitable for a staged feature trial, not a validated promise of thousands of simultaneous real-time chat users. Before high-volume rollout, migrate message storage to an indexed database/realtime transport and load-test concurrency, duplicate prevention, rate limits and the 20-member limit.

## Checks

- Existing EduSpace test suite (`npm run test:all`).
- New Study Partners/community backend tests (`npm run test:messaging`).
- Frontend markup and mobile-layout regression checks (`npm run test:typography`).
- Static layout render checked at 320px, 375px, 768px, 1366px, without horizontal page overflow. Live signed-in browser behaviour still requires deployed test accounts.
