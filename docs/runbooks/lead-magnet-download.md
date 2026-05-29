# Lead Magnet Download Runbook — Stress Management Made Simple

## Purpose

This runbook covers the Hicks Consulting lead magnet funnel for the free Stress Management Made Simple worksheet.

## Public surfaces

- Landing page: `/stress-management-worksheet/`
- Homepage spotlight: `/` section `#stress-worksheet-home`
- Resources spotlight: `/resources/` section `#stress-worksheet-resources`
- PDF asset: `/assets/downloads/stress-management-made-simple.pdf`
- API endpoint: `/api/lead-magnet`

## Email capture behavior

The landing page form collects:

- first name
- email
- optional stress context
- consent checkbox
- hidden lead magnet key: `stress-management-made-simple`

After a successful submission, the page reveals the PDF download link. The API must fail closed: the download link is only returned after the webhook receiver returns JSON with `ok: true`.

## FORM DATABASE Google Sheet receiver

The client uses one existing Google Sheet named `FORM DATABASE` for all inquiry storage. The lead magnet should append to a third tab in that spreadsheet named:

- `Lead Magnet Leads`

Existing tabs:

- `Training Inquiries`
- `Group Inquiries`

The Apps Script deployment must route payloads with `inquiryType: lead-magnet` into `Lead Magnet Leads`.

Required lead magnet tab headers:

- `Submitted At`
- `Status`
- `First Name`
- `Email`
- `Lead Magnet`
- `Stress Context`
- `Consent`
- `Source Page`
- `User Agent`
- `Submission ID`
- `Notes`
- `Follow-Up Owner`
- `Follow-Up Date`
- `Outcome`

The Apps Script response must return JSON shaped like:

```json
{ "ok": true, "submissionId": "..." }
```

If Apps Script returns `{ "ok": false }`, invalid JSON, an HTTP failure, or an empty response, the site must not reveal the download link.

## Environment variables

Preferred dedicated variables:

- `LEAD_MAGNET_WEBHOOK_URL`
- `LEAD_MAGNET_SHARED_SECRET`

Fallback variables, if the same webhook system is intentionally reused:

- `TRAINING_INQUIRY_WEBHOOK_URL`
- `TRAINING_INQUIRY_SECRET`
- `INQUIRY_SHARED_SECRET`

For the current v1 setup, Cloudflare should use:

- `LEAD_MAGNET_WEBHOOK_URL`: the Google Apps Script `/exec` URL for the `FORM DATABASE` receiver.
- `LEAD_MAGNET_SHARED_SECRET`: the same value as the existing `TRAINING_INQUIRY_SECRET`, unless the client intentionally creates a separate lead magnet secret.

Apps Script should either define `LEAD_MAGNET_SHARED_SECRET` with the same value or fall back to `TRAINING_INQUIRY_SECRET`.

Do not put real webhook URLs or secrets in source files.

## Webhook payload

The endpoint forwards:

- `secret`
- `inquiryType: lead-magnet`
- `leadMagnet`
- `submissionId`
- `submittedAt`
- `sourcePage`
- `userAgent`
- `fields`

## Updating the PDF

1. Replace `assets/downloads/stress-management-made-simple.pdf` with the new PDF.
2. Keep the filename stable unless the validator and config are updated together.
3. Run `npm run build`.
4. Run `npm run validate:lead-magnet`.
5. Run `npm run validate:all`.

## Copy and compliance boundaries

Use:

- free worksheet
- educational download
- simple stress-management reflection tool
- IEMM method: Identify, Eliminate, Minimize, Manage

Do not promise:

- therapy outcomes
- symptom relief
- diagnosis
- treatment
- crisis support
- guaranteed stress reduction

## Manual QA checklist

- Landing page loads.
- Homepage links to the landing page.
- Resources page links to the landing page.
- Form blocks missing first name, email, or consent.
- Successful submission reveals the download panel.
- PDF opens.
- Existing therapy, training, and group inquiry links still work.
