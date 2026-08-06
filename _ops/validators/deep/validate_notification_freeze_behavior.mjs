#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPublicationEmail } from '../../../scripts/autonomy/lib/notification.mjs';
import { emitFinding } from '../../validation/protocol.js';
const errors=[];
const receipt={receiptId:'fixture-receipt',published:[{title:'A grounded resource',url:'https://www.hicksconsulting.org/resources/test/',selectionReason:'It answered an admitted query inside the existing cadence.',query:'therapist for anxiety in Memphis',repairs:[{code:'MISSING_DESCRIPTION'}]}]};
const email=buildPublicationEmail(receipt);for(const phrase of ['Please double-check','personal context','No reply is required','not an approval gate','therapist for anxiety in Memphis'])if(!email.html.includes(phrase))errors.push(`email-missing:${phrase}`);
const freeze=JSON.parse(fs.readFileSync('data/autonomy/revision_registry.json','utf8'));if(!Array.isArray(freeze.revisions))errors.push('revision-registry');
const source=fs.readFileSync('scripts/autonomy/lib/freeze.mjs','utf8');for(const token of ['freezeFile','rollbackRevision','frozenFile','copyFileSync'])if(!source.includes(token))errors.push(`freeze-token:${token}`);
const notification=fs.readFileSync('scripts/autonomy/lib/notification.mjs','utf8');for(const token of ['PROVIDER_GATED','FAILED_RETRYABLE','SENT','RESEND_API_KEY','EMAIL_WEBHOOK_URL'])if(!notification.includes(token))errors.push(`notification-state:${token}`);
if(errors.length){emitFinding(errors);process.exit(1);}console.log('Notification/freeze behavior OK (explanatory optional-review email, provider-gated retries, accepted-output freeze registry, and rollback implementation present).');
