# Hicks Consulting FORM DATABASE Webhook Runbook

## Purpose

Hicks Consulting uses one Google Sheet named `FORM DATABASE` as the operational database for website form submissions.

The architecture is intentionally one-lane:

```text
Website form → Cloudflare endpoint → one Apps Script web app → FORM DATABASE spreadsheet → tab selected by inquiryType
```

Do not create a new Apps Script deployment, webhook URL, or secret for every new tab. Add new tabs by extending the form registry and Apps Script routing.

## Current spreadsheet tabs

The current spreadsheet has three active tabs:

```text
Training Inquiries
Group Inquiries
Lead Magnet Leads
```

## Current website endpoints

```text
/api/training-inquiry → inquiryType: training → Training Inquiries
/api/groups-inquiry → inquiryType: groups → Group Inquiries
/api/lead-magnet → inquiryType: lead-magnet → Lead Magnet Leads
```

## Canonical Cloudflare environment variables

Set these in Cloudflare Pages project settings for Production:

```text
FORM_DATABASE_WEBHOOK_URL = the Google Apps Script web app URL ending in /exec
FORM_DATABASE_SHARED_SECRET = the shared secret stored in Apps Script properties
```

Legacy variables may remain during migration:

```text
TRAINING_INQUIRY_WEBHOOK_URL
TRAINING_INQUIRY_SECRET
INQUIRY_SHARED_SECRET
LEAD_MAGNET_WEBHOOK_URL
LEAD_MAGNET_SHARED_SECRET
```

The repo prefers the canonical variables first, then falls back to legacy values so existing training and group forms do not break during transition.

## Apps Script properties

In Apps Script, set these script properties:

```text
SHEET_ID = the spreadsheet ID for FORM DATABASE
NOTIFY_EMAIL = the notification email address
TRAINING_INQUIRY_SECRET = existing shared secret, if already used
FORM_DATABASE_SHARED_SECRET = preferred canonical shared secret
LEAD_MAGNET_SHARED_SECRET = optional legacy alias during transition
```

For the cleanest setup, `FORM_DATABASE_SHARED_SECRET`, `TRAINING_INQUIRY_SECRET`, and `LEAD_MAGNET_SHARED_SECRET` may all use the same value during v1.

## Apps Script contract

Apps Script must accept JSON shaped like:

```json
{
  "secret": "shared-secret-value",
  "inquiryType": "lead-magnet",
  "formType": "lead-magnet",
  "submissionId": "form_...",
  "submittedAt": "2026-05-29T00:00:00.000Z",
  "sourcePage": "/stress-management-worksheet/",
  "userAgent": "...",
  "leadMagnet": "stress-management-made-simple",
  "fields": {}
}
```

Apps Script must return:

```json
{ "ok": true, "submissionId": "..." }
```

If Apps Script returns `{ "ok": false }`, invalid JSON, an empty body, or an HTTP failure, the website treats the submission as failed.

## Full Apps Script routing model

Keep one `doPost(e)` and route by `inquiryType`:

```javascript
const TRAINING_SHEET_NAME = 'Training Inquiries';
const GROUPS_SHEET_NAME = 'Group Inquiries';
const LEAD_MAGNET_SHEET_NAME = 'Lead Magnet Leads';

function doPost(e) {
  const payload = JSON.parse(e.postData.contents || '{}');
  const inquiryType = String(payload.inquiryType || payload.formType || 'training').toLowerCase();

  if (inquiryType === 'groups') {
    // append to Group Inquiries
  } else if (inquiryType === 'lead-magnet') {
    // append to Lead Magnet Leads
  } else {
    // append to Training Inquiries
  }

  return jsonOutput({ ok: true, submissionId: payload.submissionId || '' });
}
```

## Adding a new spreadsheet tab

When adding a new tab, do this in order:

1. Add the tab name and headers in Apps Script.
2. Add an `inquiryType` branch in Apps Script.
3. Add the form type to `FORM_DATABASE_FORMS` in `worker/_worker.js`.
4. Add or update the matching `functions/api/*.js` wrapper if Pages Functions are still kept.
5. Add frontend form wiring in `assets/js/site.js`.
6. Add the public page/form HTML.
7. Extend `validate:form-database` so the new form cannot drift.
8. Run `npm run build`.
9. Run `npm run validate:form-database`.
10. Run `npm run validate:all`.

Do not add a new per-form webhook URL unless the Owner explicitly approves a separate external system.

## Runtime behavior

All form endpoints must:

- reject non-POST requests
- reject invalid JSON
- sanitize text fields
- validate required fields
- validate email fields
- generate a submission ID without relying only on `crypto.randomUUID()`
- forward to the form database webhook
- handle Google Apps Script redirects safely by preserving POST behavior
- require Apps Script JSON body `ok: true`
- return controlled JSON errors instead of Cloudflare-level crashes

## Lead magnet fail-closed rule

The lead magnet form must not reveal the PDF unless the spreadsheet receiver confirms `{ "ok": true }`.

This protects the client from silent download traffic with no captured email.

## Manual tests

Training missing-field test:

```bash
curl -i -sS -X POST "https://www.hicksconsulting.org/api/training-inquiry" \
  -H "content-type: application/json" \
  --data '{"email":"test@example.com"}'
```

Lead magnet success-path test:

```bash
curl -i -sS -X POST "https://www.hicksconsulting.org/api/lead-magnet" \
  -H "content-type: application/json" \
  --data '{"firstName":"Test","email":"test@example.com","leadMagnet":"stress-management-made-simple","stressContext":"Testing setup","consent":"yes","sourcePage":"/stress-management-worksheet/","submittedAtClient":"manual-test"}'
```

Expected success body:

```json
{ "ok": true, "submissionId": "...", "downloadPath": "/assets/downloads/stress-management-made-simple.pdf" }
```

If the response is a controlled JSON error, inspect Cloudflare env vars and Apps Script properties.

If the response is a Cloudflare plain-text `error code: 502`, inspect the Worker deployment and route runtime.

## Failure recovery

If a form fails after deployment:

1. Confirm `FORM_DATABASE_WEBHOOK_URL` is set in Cloudflare Production.
2. Confirm `FORM_DATABASE_SHARED_SECRET` is set in Cloudflare Production.
3. Confirm Apps Script has the same secret value.
4. Confirm Apps Script deployment access is set to Web app and accessible by Anyone.
5. Confirm Apps Script returns `{ ok: true }` for a valid payload.
6. Confirm the expected tab exists or can be created by `ensureSheet`.
7. Confirm GitHub Actions on `main` are green.
