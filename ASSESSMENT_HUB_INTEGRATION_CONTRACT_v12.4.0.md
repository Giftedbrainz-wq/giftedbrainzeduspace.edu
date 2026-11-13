# Gifted Brainz EduSpace ↔ Assessment Hub integration contract

**EduSpace release:** v12.4.0 (EduSpace side implemented). **Assessment Hub side: NOT YET MODIFIED.** Existing EduSpace CBT entries remain links to Assessment Hub. Do not interpret this document as evidence that cross-platform results are already synchronising.

## What EduSpace supports now

All six new student features work without Assessment Hub: a manual Mistake Notebook, Personalised Study Planner with existing CBT/video/material links, Saved Questions (manual and finished Battle Arena), verifiable Academic Achievement Badges, opt-in Study Partners (approval, private text messages, shared goals, report/block), and an Ask for Explanation panel that shows available question explanations. The student dashboard has an in-app due/overdue study-plan reminder.

When Hub is connected later, EduSpace can additionally receive *signed* account links, completed CBT attempts with wrong-answer details, and question bookmark events. EduSpace deliberately **does not** attempt to scrape results from CBT links or infer a student's Hub identity from their username/email.

## Deployment and secret setup

Set a high-entropy shared environment variable `ASSESSMENT_HUB_SYNC_SECRET` on BOTH servers, containing the **same** randomly generated value of at least 32 characters. Keep the value in each platform's server-side secret manager. Never expose the secret in HTML, JavaScript, links, public configuration, or logs. With no configured secret, EduSpace's Hub linking and event receiver remain disabled (HTTP 503). Learning Centre and Study Partners continue to operate.

Use HTTPS for both deployed services. Implement a durable datastore and appropriate read/write concurrency controls on EduSpace before high-scale operation; successful local tests are not proof of 600-user capacity.

## Account linking (user-initiated)

1. Student signs in to **EduSpace**, opens **My Learning Centre**, selects **Generate one-time link code**. The button is shown only after EduSpace has its server-side integration secret configured and before the accounts are linked.
2. `POST /api/learning/integration/link-code` with the student's normal EduSpace auth returns `{ "code": "...", "expiresInSeconds": 900 }`. The code is displayed once; only the SHA-256 hash is stored in EduSpace.
3. In a future Hub account-linking page, the same student signs in to their **Assessment Hub** account and enters that one-time code. The Hub server (not the browser) sends a signed event to EduSpace as described below with type `account.linked`, the Hub's own stable student ID and the entered code.
4. EduSpace consumes the code, creates a one-to-one binding, and returns HTTP 200 `{ "ok": true }`. The code expires after 15 minutes and may not be used again.
5. A second Assessment Hub account cannot be linked to another student's EduSpace profile using the same Hub user ID. For account-switching, a separate verified unlink/relink feature would need to be designed; it is not provided in this release.

Students and administrators should not manually share or exchange login credentials between applications.

## Signed server-to-server events

**Receiver:** `POST https://<eduspace-host>/api/integrations/assessment-hub/events` (or `/link`; both use the same signed receiver).

**Headers:**
- `Content-Type: application/json`
- `X-GB-Hub-Timestamp: <Unix seconds>` (a ten-digit integer within ±300 seconds of EduSpace's clock)
- `X-GB-Hub-Signature: sha256=<hex HMAC-SHA256>`

**Signature input:** `timestamp + "." + the exact UTF-8 request body bytes`.

**Signature construction (Node.js, Hub server):**
```js
import crypto from 'node:crypto';
const timestamp = String(Math.floor(Date.now() / 1000));
const body = JSON.stringify(event);
const digest = crypto.createHmac('sha256', process.env.ASSESSMENT_HUB_SYNC_SECRET)
  .update(timestamp + '.')
  .update(Buffer.from(body, 'utf8'))
  .digest('hex');
const headers = {
  'content-type': 'application/json',
  'x-gb-hub-timestamp': timestamp,
  'x-gb-hub-signature': 'sha256=' + digest,
};
// POST body exactly as signed: body (no re-serialisation)
```

**Event identity and replay protection:** Each event uses a globally unique `eventId` (e.g., a UUID). EduSpace deduplicates received event IDs. Retry with the SAME `eventId` on transient network failures. The timestamp window prevents an old signed request from being replayed indefinitely; the `eventId` prevents duplicates within the retained event log. For long-term cross-platform operation, a dedicated durable idempotency store should replace the bounded log.

### A. Account linked
```json
{
  "eventId": "uuid-1",
  "type": "account.linked",
  "externalUserId": "stable-hub-student-id",
  "linkCode": "ONE_TIME_CODE_FROM_STUDENT"
}
```
Only a valid, unexpired and unused EduSpace code may establish a linkage.

### B. CBT completed
Send this event **only after the assessment is officially submitted and its answers are released for review**. Do not send correct answers from an active/unfinished examination.
```json
{
  "eventId": "uuid-2",
  "type": "cbt.completed",
  "externalUserId": "stable-hub-student-id",
  "attemptId": "stable-hub-attempt-id",
  "subject": "Chemistry",
  "questions": [
    {
      "questionId": "stable-hub-question-id",
      "subject": "Chemistry",
      "topic": "Acids",
      "question": "Which reaction can release hydrogen gas?",
      "options": ["Metal + dilute acid", "Salt + water", "Metal + neutral gas"],
      "correctIndex": 0,
      "selectedIndex": 1,
      "explanation": "Certain metals react with dilute acids to release hydrogen."
    }
  ]
}
```
**Rules:** `correctIndex` and `selectedIndex` are ZERO-based integers. Send all reviewed questions in an attempt for accuracy reporting; EduSpace saves only the incorrect ones to the Mistake Notebook. Up to 250 questions may be sent per event (request body ≤300 KB). Each question needs a stable ID, subject, question text (at least eight characters), answer options and valid indices. A question can be saved at most once per student and source question; a repeated wrong answer refreshes the entry. EduSpace records an aggregate attempt summary internally, not a complete second copy of the Hub examination engine.

### C. Question bookmarked / unbookmarked
```json
{
  "eventId": "uuid-3",
  "type": "question.bookmarked",
  "externalUserId": "stable-hub-student-id",
  "questionId": "stable-hub-question-id",
  "subject": "Mathematics",
  "topic": "Indices",
  "question": "Simplify 2³ × 2².",
  "options": ["8", "16", "32", "64"],
  "correctIndex": 2,
  "explanation": "Add powers with the same base: 2⁵ = 32."
}
```
For removal, send `type: "question.unbookmarked"` with `eventId`, `externalUserId`, and `questionId`.

## Privacy and safety controls

- All student-facing endpoints require an active EduSpace account and a valid auth token. Student A cannot read Student B's notebook, bookmarks, plans or messages.
- **Study Partners require both-party approval** before messaging, with block, report and admin review actions. Partners are searchable by username; email addresses are not exposed.
- Premium CBT and material URLs are omitted for Free accounts; displaying a locked resource does not unlock it.
- Completed Battle Arena questions may be saved only by users who actually participated in that finished match.
- EduSpace clears Learning Centre, partnership and Hub-link records when a student account is deleted.
- Connection status can be retrieved from `GET /api/learning/integration/status` for the signed-in EduSpace student.
- Do not log student link codes, signatures, plaintext question responses, or private messages in ordinary application logs.

## Hub implementation still required

Add the linking interface to Hub, add secure outbound event delivery/queues with retries, send question bookmarks and completed CBT attempts from the actual Hub database, support secure unlinking/account recovery, validate assessment completion server-side, and perform real end-to-end and performance/security testing after both platforms are deployed. Until this work is done, students use EduSpace's manual notebook and bookmarks; automatic Hub sync is not operational.
