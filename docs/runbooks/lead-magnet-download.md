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
- optional broad stress context
- consent checkbox
- hidden lead magnet key: `stress-management-made-simple`

After local validation succeeds, the API queues the FORM DATABASE webhook dispatch in the background and reveals the PDF download link. The visitor must not be blocked by Google Apps Script redirect/runtime instability.

## FORM DATABASE receiver

The lead magnet uses the unified FORM DATABASE pipeline documented in:

```text
docs/runbooks/form-database-webhook.md
```

It does not need a separate spreadsheet, separate Apps Script deployment, or separate webhook lane.

The lead magnet routes as:

```text
/api/lead-magnet → inquiryType: lead-magnet → Lead Magnet Leads
```

## Required Lead Magnet Leads tab headers

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

## Environment variables

Preferred canonical Cloudflare variables:

- `FORM_DATABASE_WEBHOOK_URL`
- `FORM_DATABASE_SHARED_SECRET`

Legacy fallbacks retained during transition:

- `TRAINING_INQUIRY_WEBHOOK_URL`
- `TRAINING_INQUIRY_SECRET`
- `INQUIRY_SHARED_SECRET`
- `LEAD_MAGNET_WEBHOOK_URL`
- `LEAD_MAGNET_SHARED_SECRET`

Do not create a new webhook URL for every new spreadsheet tab.

## Webhook payload

The endpoint forwards:

- `secret`
- `inquiryType: lead-magnet`
- `formType: lead-magnet`
- `leadMagnet`
- `submissionId`
- `submittedAt`
- `sourcePage`
- `userAgent`
- `fields`

The dispatch is backgrounded with `waitUntil` when available. Apps Script should return `{ "ok": true }` for observability, but the user-facing response does not wait on Apps Script.

## Updating the PDF

1. Replace `assets/downloads/stress-management-made-simple.pdf` with the new PDF.
2. Keep the filename stable unless the validator and config are updated together.
3. Run `npm run build`.
4. Run `npm run validate:lead-magnet`.
5. Run `npm run validate:form-database`.
6. Run `npm run validate:all`.

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
- Successful submission records a row in `Lead Magnet Leads`.
- Successful submission reveals the download panel.
- PDF opens.
- Existing training and group inquiry forms still submit through the same FORM DATABASE lane.
