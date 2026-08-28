#!/usr/bin/env node
import { validateDraft, localRepairDraft, SAFE_HARBOR_DECISIONS, plainTextFromDraft, isStructuredDraftShape, DEFAULT_DISCLAIMER } from '../../../scripts/autonomy/lib/safe_harbor.mjs';
import { cadenceMatches, nextAvailableSlot } from '../../../scripts/autonomy/lib/cadence.mjs';
import { emitFinding } from '../../validation/protocol.js';
const errors=[];
const base={title:'Understanding emotional overload',description:'A practical educational guide to recognizing emotional overload and choosing grounded next steps.',shortAnswer:'Emotional overload can make ordinary decisions feel harder. A useful first step is to slow the pace, name what is happening, and choose one source of support.',sections:[{heading:'What this can look like',body:'Emotional overload may show up as irritability, difficulty concentrating, trouble resting, or feeling responsible for everything. These experiences can have many causes and do not create a diagnosis on their own. '.repeat(35),bullets:['Notice the pattern','Reduce one demand','Ask for support']}],sources:[],internalLinks:['/therapy/','/resources/'],disclaimer:'This educational resource does not provide diagnosis or individualized medical advice.'};
let result=validateDraft(base,{minimumWords:300}); if(result.decision!=='SAFE_AUTOPUBLISH')errors.push(`safe-draft:${result.decision}`);
const unsafe=structuredClone(base);unsafe.sections[0].body+=' This will cure anxiety and guarantee results.';result=validateDraft(unsafe,{minimumWords:300});if(result.decision!=='REPAIR_REQUIRED')errors.push(`repair-decision:${result.decision}`);const repaired=localRepairDraft(unsafe,result.findings);result=validateDraft(repaired,{minimumWords:300});if(!['SAFE_AUTOPUBLISH'].includes(result.decision))errors.push(`repair-failed:${result.decision}`);
const protectedDraft=structuredClone(base);protectedDraft.sections[0].body+=' The fee is $150 and appointments are available this week.';result=validateDraft(protectedDraft,{minimumWords:300});if(result.decision!=='SKIPPED_UNSUPPORTED_CLAIM')errors.push(`protected-fact:${result.decision}`);
result=validateDraft(base,{minimumWords:300,existingDocuments:[{route:'/existing/',text:plainTextFromDraft(base)}]});if(result.decision!=='SKIPPED_DUPLICATE_INTENT')errors.push(`duplicate:${result.decision}`);
if(!SAFE_HARBOR_DECISIONS.includes('SYSTEM_BLOCKED')||!SAFE_HARBOR_DECISIONS.includes('SKIPPED_PROTECTED_OWNER'))errors.push('decision-enum');
const manifest=[{id:'existing',contentType:'articles',scheduledAt:'2027-01-05T13:00:00.000Z'}];const slot=nextAvailableSlot('articles',manifest,'2027-01-06T00:00:00.000Z');if(!cadenceMatches('articles',slot))errors.push(`cadence-slot:${slot}`);

// A repair may never introduce a finding the repair cannot clear. The default
// disclaimer used to contain the word "guarantee" and was assigned after the
// sanitizer ran, so a draft that merely arrived without a disclaimer came back out
// of localRepairDraft carrying a fresh GUARANTEE finding.
const noDisclaimer=structuredClone(base);delete noDisclaimer.disclaimer;delete noDisclaimer.description;delete noDisclaimer.shortAnswer;delete noDisclaimer.internalLinks;
const backfilled=localRepairDraft(noDisclaimer,validateDraft(noDisclaimer,{minimumWords:300}).findings);
if(!backfilled.disclaimer)errors.push('default-disclaimer-missing');
const backfilledCodes=validateDraft(backfilled,{minimumWords:300}).findings.map(f=>f.code);
for(const injected of ['GUARANTEE','DIAGNOSE_READER','BEST_RANKING','CRISIS_PROMISE','MEDICAL_DIRECTIVE'])if(backfilledCodes.includes(injected))errors.push(`repair-injected-finding:${injected}`);
for(const missing of ['MISSING_DESCRIPTION','MISSING_SHORTANSWER'])if(backfilledCodes.includes(missing))errors.push(`repair-did-not-backfill:${missing}`);
if(validateDraft({title:'x',sections:[{heading:'h',body:DEFAULT_DISCLAIMER}]},{minimumWords:0}).findings.some(f=>['GUARANTEE','DIAGNOSE_READER','BEST_RANKING','CRISIS_PROMISE','MEDICAL_DIRECTIVE'].includes(f.code)))errors.push('default-disclaimer-trips-a-prohibited-phrase-check');

// Only a real draft may replace a draft. Anything else - a wrapper object, a partial
// object, a string, an array - must be rejected so run_cycle keeps what it already has.
if(!isStructuredDraftShape(base))errors.push('shape-check-rejects-a-valid-draft');
for(const [label,value] of [['null',null],['string','{}'],['array',[{heading:'h',body:'b'}]],['wrapper',{draft:base}],['partial',{title:'Only a title'}],['empty-sections',{title:'t',sections:[]}],['sectionless-body',{title:'t',sections:[{heading:'h'}]}],['blank-title',{title:'   ',sections:[{heading:'h',body:'b'}]}]]){
  if(isStructuredDraftShape(value))errors.push(`shape-check-accepts-non-draft:${label}`);
}

if(errors.length){emitFinding(errors);process.exit(1);}console.log('Safe Harbor behavior OK (safe publish, bounded repair, protected-fact skip, duplicate skip, cadence-compliant scheduling, a default disclaimer that trips no prohibited-phrase check, and a draft-shape check that only accepts real drafts).');
