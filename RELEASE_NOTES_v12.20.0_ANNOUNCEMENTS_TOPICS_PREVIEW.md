# Gifted Brainz EduSpace 12.20.0 — targeted corrections

Based on v12.19.0.

- The blue Learning Materials folio/card receives rounded corners on narrow phone screens. Existing desktop layout unchanged.
- Announcement reply hearts have larger touch targets and appear red when liked. Thread replies have a visual connector.
- Students can delete their own replies, while authenticated admins can delete any announcement reply; student deletion preserves other students’ responses by reparenting them; admin deletion removes the selected thread. Both permissions are enforced in server routes.
- Subject selection now combines built-in subjects, custom subjects and subjects referenced by existing content/topics so archived subjects are less likely to disappear; the Topics view refreshes the selector. If the original records were previously physically deleted, recovery requires a backup.
- The Student View link in the admin console opens a new authenticated read-only administrator catalogue preview with all subjects and published public/premium resources. It does not impersonate a student, submit CBTs, or alter student scores.
- Asset and service-worker versions bumped for mobile cache refresh.

## Staging validation
Test with a real admin account and two student accounts: reply authorisation; admin reply removal; subject catalogue values; preview of premium document attachments; mobile corner curvature.
No SQL migration is required for these changes. Preserve existing EdgeOne environment variables.
