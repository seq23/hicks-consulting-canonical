# Form Button Data Trace — Hicks Consulting

Status: active
Scope: all site form/CTA paths that submit data or route users into a conversion form.

## Hostile finding fixed

The prior implementation used background dispatch (`waitUntil`) for the form database. That meant the browser could see `ok:true` before Google Apps Script confirmed the spreadsheet row was written. This was unsafe for all three data-capture flows, and especially unsafe for the lead magnet because it could reveal the PDF while no email was captured.

The repo now requires the Apps Script response body to be JSON with `ok:true` before the user sees a success message or the lead magnet download panel.

## Captured form flows

| Public surface | Form ID | Client JS | Endpoint | Server behavior | Spreadsheet tab |
|---|---|---|---|---|---|
| `/organizational-training-inquiry/` | `training-inquiry-form` | `wireTrainingInquiryForm()` | `/api/training-inquiry` | synchronous Apps Script confirmation required | `Training Inquiries` |
| `/groups/` | `group-inquiry-form` | `wireGroupsInquiryForm()` | `/api/groups-inquiry` | synchronous Apps Script confirmation required | `Group Inquiries` |
| `/stress-management-worksheet/` | `stress-worksheet-form` | `wireLeadMagnetForm()` | `/api/lead-magnet` | synchronous Apps Script confirmation required before PDF reveal | `Lead Magnet Leads` |

## Data path

1. User clicks CTA or lands on form page.
2. User submits the form.
3. `assets/js/site.js` validates required visible fields.
4. Client posts JSON to the matching `/api/...` endpoint.
5. Cloudflare Function or Advanced Mode Worker validates payload.
6. Server posts to Apps Script webhook.
7. Apps Script validates shared secret and appends the row.
8. Apps Script returns `{ "ok": true }`.
9. Server returns `{ "ok": true }` to browser.
10. Browser shows success message. Lead magnet flow reveals the PDF only after step 9.

## Runtime guardrail

A Google Apps Script response is not trusted just because the HTTP status is 200. The server parses the response body and requires:

```json
{ "ok": true }
```

If Apps Script returns `{ "ok": false }`, invalid JSON, empty body, redirect failure, or a non-2xx response, the user sees the form error and no success/download state is shown.

## Lead magnet env priority

The lead magnet route prefers:

1. `LEAD_MAGNET_WEBHOOK_URL`
2. `FORM_DATABASE_WEBHOOK_URL`
3. `TRAINING_INQUIRY_WEBHOOK_URL`

and secret priority:

1. `LEAD_MAGNET_SHARED_SECRET`
2. `FORM_DATABASE_SHARED_SECRET`
3. `TRAINING_INQUIRY_SECRET`
4. `INQUIRY_SHARED_SECRET`

This prevents the lead magnet from accidentally using an older training webhook deployment when both old and new Cloudflare variables exist.

## Group inquiry field compatibility

The live group form uses:

- `phone`
- `groupInterest`
- `supportNeed`
- `availability`
- `message`

The Apps Script sheet historically expected `preferredAvailability` and `message`. The server now forwards compatibility fields:

- `preferredAvailability` = `availability`
- `message` = combined support need, availability, phone, and additional message
- `referral` = blank unless later added

This preserves current form data without requiring an immediate sheet schema migration.

## Failure behavior

| Failure | Browser result |
|---|---|
| Missing required fields | inline error, no submit |
| Invalid email | server error, no success |
| Missing webhook URL/secret | server error, no success |
| Apps Script unauthorized | server error, no success |
| Apps Script returns `ok:false` | server error, no success |
| Lead magnet spreadsheet failure | no PDF reveal |

## Validation commands

```bash
npm run build
npm run validate:lead-magnet
npm run validate:training-inquiry
npm run validate:form-database
NODE_OPTIONS="--max-old-space-size=3072" npm run validate:all
```

## Runtime trace performed

A Node runtime trace imported `worker/_worker.js`, mocked Apps Script responses, and tested all three routes:

- `/api/training-inquiry`
- `/api/groups-inquiry`
- `/api/lead-magnet`

Each route passed both lanes:

- Apps Script `{ ok:true }` -> browser response succeeds
- Apps Script `{ ok:false }` -> browser response fails closed

