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

The website validates the form and queues the Apps Script dispatch in the background. Apps Script should still return `{ "ok": true }` so Cloudflare logs can distinguish recorded submissions from background receiver failures.

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
- queue the form database webhook dispatch in the request context with `waitUntil` when available
- return user-facing success after local validation and successful queueing, without blocking the visitor on Google Apps Script
- handle Google Apps Script redirects safely by preserving POST behavior in the background dispatcher
- log background receiver failures when Apps Script does not return JSON body `ok: true`
- return controlled JSON errors instead of Cloudflare-level crashes

## Lead magnet response rule

The lead magnet validates required fields, email format, and consent before revealing the PDF. After validation, the Cloudflare route queues the FORM DATABASE dispatch in the background and immediately returns the PDF path.

This protects the visitor experience from Google Apps Script redirect/runtime instability while keeping one spreadsheet receiver as the operational database. Background failures should be checked in Cloudflare logs and corrected at the Apps Script/config layer.

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
{ "ok": true, "submissionId": "...", "queued": true, "downloadPath": "/assets/downloads/stress-management-made-simple.pdf" }
```

If the response is a controlled JSON error before queueing, inspect Cloudflare env vars and required fields.

If the response succeeds but no row appears, inspect Cloudflare background logs, Apps Script properties, Apps Script deployment access, and spreadsheet tab/header handling.

If the response is a Cloudflare plain-text `error code: 502`, inspect the Worker/Pages deployment and route runtime before the background dispatcher is scheduled.

## Failure recovery

If a form fails after deployment:

1. Confirm `FORM_DATABASE_WEBHOOK_URL` is set in Cloudflare Production.
2. Confirm `FORM_DATABASE_SHARED_SECRET` is set in Cloudflare Production.
3. Confirm Apps Script has the same secret value.
4. Confirm Apps Script deployment access is set to Web app and accessible by Anyone.
5. Confirm Apps Script returns `{ ok: true }` for a valid payload.
6. Confirm the expected tab exists or can be created by `ensureSheet`.
7. Confirm GitHub Actions on `main` are green.

## Form capture hardening note

Current repo behavior: Cloudflare must receive Apps Script JSON `{ "ok": true }` before returning browser success. Background queueing is not allowed for these forms because it can show a success state before the spreadsheet capture is proven. Lead magnet downloads are revealed only after confirmed Apps Script receipt.
