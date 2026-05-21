# Hicks Consulting Inquiry Google Sheet Pipeline

## Purpose

The Training Inquiry and Groups Inquiry forms use a free Google Sheet pipeline so Hicks Consulting can review, organize, and follow up without paid form software.

These forms are for business, training, and group-interest inquiries. They are not clinical intake forms.

## Frontend form behavior

Both forms submit through Cloudflare Pages Functions. No form uses `mailto` as its submission action.

After a successful submission:

```txt
form hides
thank-you message appears
refreshing the page shows the form again
```

If submission fails, the form remains visible and the visitor sees a fallback message to try again or email `info@hicksconsulting.org`.

## Locked visible Training Inquiry fields

Do not remove or rename these fields without updating the validator and backend mapping:

1. `firstName`
2. `lastName`
3. `company`
4. `email`
5. `services`
6. `eventDate`
7. `honorarium`
8. `referral`
9. `eventDetails`

## Locked visible Groups Inquiry fields

Do not remove or rename these fields without updating the validator and backend mapping:

1. `firstName`
2. `lastName`
3. `email`
4. `groupInterest`
5. `preferredAvailability`
6. `referral`
7. `message`

The validator `npm run validate:training-inquiry` traces both forms through:

```txt
HTML form → assets/js/site.js payload → Cloudflare Pages Function → Apps Script payload contract
```

## Data flow

```txt
Visitor submits inquiry form
→ Cloudflare Pages Function
→ Google Apps Script Web App
→ Google Sheet row
→ notification email to info@hicksconsulting.org
→ frontend hides form and shows thank-you message
```

## Google Sheet setup

Create a Google Sheet named:

```txt
Hicks Consulting - Inquiries
```

Create two tabs:

```txt
Training Inquiries
Group Inquiries
```

### Training Inquiries header row

```txt
Submitted At
Status
First Name
Last Name
Email
Company / Organization
Services Interested In
Event Date
Speaking Honorarium Budget
How Did You Hear About Us
Event Details / Expectations
Source Page
User Agent
Submission ID
Notes
Follow-Up Owner
Follow-Up Date
Outcome
```

### Group Inquiries header row

```txt
Submitted At
Status
First Name
Last Name
Email
Group Interest
Preferred Availability
How Did You Hear About Us
Message
Source Page
User Agent
Submission ID
Notes
Follow-Up Owner
Follow-Up Date
Outcome
```

## Cloudflare Pages environment variables

The historical names are kept so you do not need another secret setup.

```txt
TRAINING_INQUIRY_WEBHOOK_URL = [Apps Script Web App URL]
TRAINING_INQUIRY_SECRET = [same long random secret]
```

The same webhook and secret support both Training and Groups inquiries.

## Apps Script setup

In the Google Sheet:

```txt
Extensions → Apps Script
```

Paste this script:

```javascript
const TRAINING_SHEET_NAME = 'Training Inquiries';
const GROUPS_SHEET_NAME = 'Group Inquiries';

const TRAINING_HEADERS = [
  'Submitted At',
  'Status',
  'First Name',
  'Last Name',
  'Email',
  'Company / Organization',
  'Services Interested In',
  'Event Date',
  'Speaking Honorarium Budget',
  'How Did You Hear About Us',
  'Event Details / Expectations',
  'Source Page',
  'User Agent',
  'Submission ID',
  'Notes',
  'Follow-Up Owner',
  'Follow-Up Date',
  'Outcome'
];

const GROUPS_HEADERS = [
  'Submitted At',
  'Status',
  'First Name',
  'Last Name',
  'Email',
  'Group Interest',
  'Preferred Availability',
  'How Did You Hear About Us',
  'Message',
  'Source Page',
  'User Agent',
  'Submission ID',
  'Notes',
  'Follow-Up Owner',
  'Follow-Up Date',
  'Outcome'
];

function getProp(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error(`Missing script property: ${name}`);
  return value;
}

function ensureSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);

  const firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const hasHeaders = firstRow.some(value => String(value || '').trim());
  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function doPost(e) {
  const expectedSecret = getProp('TRAINING_INQUIRY_SECRET');
  const notifyEmail = getProp('NOTIFY_EMAIL');
  const sheetId = getProp('SHEET_ID');

  let payload;
  try {
    payload = JSON.parse(e.postData.contents || '{}');
  } catch (error) {
    return jsonOutput({ ok: false, error: 'Invalid JSON' });
  }

  if (payload.secret !== expectedSecret) {
    return jsonOutput({ ok: false, error: 'Unauthorized' });
  }

  const fields = payload.fields || {};
  const inquiryType = String(payload.inquiryType || 'training').toLowerCase();
  const ss = SpreadsheetApp.openById(sheetId);

  let sheet;
  let subject;
  let body;
  let row;

  if (inquiryType === 'groups') {
    sheet = ensureSheet(ss, GROUPS_SHEET_NAME, GROUPS_HEADERS);
    row = [
      payload.submittedAt || new Date().toISOString(),
      'New',
      fields.firstName || '',
      fields.lastName || '',
      fields.email || '',
      fields.groupInterest || '',
      fields.preferredAvailability || '',
      fields.referral || '',
      fields.message || '',
      payload.sourcePage || '',
      payload.userAgent || '',
      payload.submissionId || '',
      '',
      '',
      '',
      ''
    ];

    subject = `New Group Inquiry - ${fields.firstName || ''} ${fields.lastName || ''}`.trim();
    body = [
      'A new group inquiry was submitted.',
      '',
      `Name: ${fields.firstName || ''} ${fields.lastName || ''}`,
      `Email: ${fields.email || ''}`,
      `Group Interest: ${fields.groupInterest || ''}`,
      `Preferred Availability: ${fields.preferredAvailability || ''}`,
      `Referral Source: ${fields.referral || ''}`,
      '',
      'Message:',
      fields.message || '',
      '',
      `Submission ID: ${payload.submissionId || ''}`,
      `Submitted At: ${payload.submittedAt || ''}`,
      '',
      `Sheet: ${ss.getUrl()}`
    ].join('\n');
  } else {
    sheet = ensureSheet(ss, TRAINING_SHEET_NAME, TRAINING_HEADERS);
    row = [
      payload.submittedAt || new Date().toISOString(),
      'New',
      fields.firstName || '',
      fields.lastName || '',
      fields.email || '',
      fields.company || '',
      fields.services || '',
      fields.eventDate || '',
      fields.honorarium || '',
      fields.referral || '',
      fields.eventDetails || '',
      payload.sourcePage || '',
      payload.userAgent || '',
      payload.submissionId || '',
      '',
      '',
      '',
      ''
    ];

    subject = `New Organizational Training Inquiry - ${fields.company || 'Hicks Consulting'}`;
    body = [
      'A new organizational training inquiry was submitted.',
      '',
      `Name: ${fields.firstName || ''} ${fields.lastName || ''}`,
      `Email: ${fields.email || ''}`,
      `Company / Organization: ${fields.company || ''}`,
      `Services Interested In: ${fields.services || ''}`,
      `Event Date: ${fields.eventDate || ''}`,
      `Honorarium Budget: ${fields.honorarium || ''}`,
      `Referral Source: ${fields.referral || ''}`,
      '',
      'Event Details / Expectations:',
      fields.eventDetails || '',
      '',
      `Submission ID: ${payload.submissionId || ''}`,
      `Submitted At: ${payload.submittedAt || ''}`,
      '',
      `Sheet: ${ss.getUrl()}`
    ].join('\n');
  }

  sheet.appendRow(row);
  MailApp.sendEmail(notifyEmail, subject, body);

  return jsonOutput({ ok: true, submissionId: payload.submissionId || '' });
}

function jsonOutput(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
```

## Apps Script properties

Set script properties:

```txt
SHEET_ID = [Google Sheet ID only, not the full URL]
NOTIFY_EMAIL = info@hicksconsulting.org
TRAINING_INQUIRY_SECRET = [same long random secret used in Cloudflare]
```

## Deploy Apps Script

```txt
Deploy → New deployment → Web app
Execute as: Me
Who has access: Anyone
```

Copy the Web App URL and use it as `TRAINING_INQUIRY_WEBHOOK_URL` in Cloudflare Pages.

## Validation

Run:

```bash
npm run validate:training-inquiry
npm run validate:all
```

## Operational notes

- These forms are not therapy intake forms.
- Do not ask for diagnosis, symptoms, insurance information, clinical history, crisis details, or protected health information here.
- Therapy/client intake should remain in SimplePractice or another appropriate client-care platform.
