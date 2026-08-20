const { read, fail } = require('./util');
function parse(file){ try { return JSON.parse(read(file)); } catch(error){ fail(`${file} is not valid JSON: ${error.message}`); } }
const entities = parse('data/entities/entity_registry.json');
const author = parse('data/entities/author_profile.json');
const org = parse('data/entities/org_profile.json');
const person = parse('data/entities/person_schema.json');
const orgSchema = parse('data/entities/org_schema.json');
const authority = parse('data/entities/external_authority_registry.json');
const recognition = parse('data/entities/entity_recognition_baseline.json');
const recognitionQueries = parse('data/entities/entity_recognition_queries.json');
if(!entities.organization?.name || !entities.organization?.url) fail('Entity registry missing organization name/url.');
if(!entities.provider?.name || !entities.provider?.role) fail('Entity registry missing provider name/role.');
if(!Array.isArray(entities.services) || entities.services.length < 4) fail('Entity registry must define therapy, coaching, groups, and organizational training services.');
if(!entities.domain?.canonicalDomain) fail('Entity registry missing canonical domain.');
if(!author.name || !author.organization || !author.bio) fail('Author profile incomplete.');
if(!org.name || !org.url || !Array.isArray(org.sameAs)) fail('Org profile incomplete.');
if(org.name !== entities.organization.name) fail('Org profile name must match entity registry organization name.');
if(author.organization !== entities.organization.name) fail('Author organization must match entity registry organization name.');
if(person['@context'] !== 'https://schema.org' || person['@type'] !== 'Person') fail('Monika person schema must be a schema.org Person.');
if(person['@id'] !== 'https://www.hicksconsulting.org/about/#monika-hicks') fail('Monika canonical Person @id is incorrect.');
if(person.name !== 'Monika Hicks, LCSW') fail('Monika canonical Person name is incorrect.');
if(person.worksFor?.['@id'] !== 'https://www.hicksconsulting.org/#organization') fail('Monika worksFor must reference the canonical Hicks Consulting organization id.');
if(entities.provider.canonicalId !== person['@id']) fail('Entity registry provider canonicalId must match Person @id.');
if(author.canonicalPersonId !== person['@id']) fail('Author profile canonicalPersonId must match Person @id.');
const sameAs = new Set(person.sameAs || []);
if(!sameAs.has('https://www.linkedin.com/in/monika-hicks-lcsw-8168b6b0/')) fail('Monika Person sameAs must include the verified LinkedIn profile.');
const education = new Set((person.alumniOf || []).map(item => item && item.name));
if(!education.has('Middle Tennessee State University') || !education.has('University of Tennessee, Knoxville')) fail('Monika Person education relationships are incomplete.');
const subjects = person.subjectOf || [];
if(!subjects.some(item => item && /memphisvoyager\.com/.test(item.url || ''))) fail('Monika Person must include the verified Memphis Voyager subjectOf evidence.');
if(!subjects.some(item => item && /psychologytoday\.com\/us\/therapists\/monika-t-hicks-brentwood-tn\/1357023/.test(item.url || ''))) fail('Monika Person must include the preferred verified Tennessee Psychology Today profile.');
if(subjects.some(item => item && /psychologytoday\.com\/us\/therapists\/monika-hicks-olive-branch-ms\/1663504/.test(item.url || ''))) fail('Noncanonical Mississippi Psychology Today profile must not be promoted into Person subjectOf.');
if(!subjects.some(item => item && /growtherapy\.com/.test(item.url || ''))) fail('Monika Person must include Grow Therapy external evidence.');
if(!subjects.some(item => item && /eventbrite\.com/.test(item.url || ''))) fail('Monika Person must include current speaking-event evidence.');
if(/\b\d+\s+years?\s+(?:of\s+)?experience\b/i.test(person.description || '')) fail('Person description must not encode a precise years-of-experience claim without explicit verification.');
if(orgSchema['@context'] !== 'https://schema.org' || orgSchema['@type'] !== 'Organization') fail('Hicks Consulting schema must be a schema.org Organization.');
if(orgSchema['@id'] !== 'https://www.hicksconsulting.org/#organization') fail('Hicks Consulting canonical Organization @id is incorrect.');
if(orgSchema.name !== 'Hicks Consulting') fail('Hicks Consulting canonical Organization name is incorrect.');
if(orgSchema.employee?.['@id'] !== person['@id']) fail('Hicks Consulting Organization must reference Monika canonical Person as employee/lead.');
if(entities.organization.canonicalId !== orgSchema['@id']) fail('Entity registry organization canonicalId must match Organization @id.');
if(org.canonicalId !== orgSchema['@id']) fail('Org profile canonicalId must match Organization @id.');
if(org.employeeCanonicalPersonId !== person['@id']) fail('Org profile must reciprocally reference Monika canonical Person id.');
const orgSameAs = new Set(orgSchema.sameAs || []);
if(!orgSameAs.has('https://www.instagram.com/hicksconsulting') || !orgSameAs.has('https://www.facebook.com/profile.php?id=61563824221571')) fail('Hicks Consulting Organization sameAs must include verified organization social profiles.');
for(const url of orgSameAs){ if(/psychologytoday\.com|therapyforblackgirls\.com|memphisvoyager\.com|linkedin\.com\/in\//.test(url)) fail('Organization sameAs must not contain Monika profiles or editorial evidence.'); }
const orgSubjects = orgSchema.subjectOf || [];
if(!orgSubjects.some(item => item && /memphisvoyager\.com/.test(item.url || ''))) fail('Hicks Consulting Organization must include Memphis Voyager subjectOf evidence.');
if(!orgSubjects.some(item => item && /eventbrite\.com/.test(item.url || ''))) fail('Hicks Consulting Organization must include independent speaking-event evidence.');
if(!orgSubjects.some(item => item && /healthprovidersdata\.com/.test(item.url || ''))) fail('Hicks Consulting Organization must include institutional provider evidence.');
if(authority.canonicalPersonId !== person['@id'] || authority.canonicalOrganizationId !== orgSchema['@id']) fail('External authority registry canonical IDs must match entity schemas.');
if(!Array.isArray(authority.evidence) || authority.evidence.length < 5) fail('External authority registry must include the verified Phase 5 evidence set.');
const conflicts = new Map((authority.conflicts || []).map(item => [item.id, item]));
if(conflicts.get('psychology-today-mississippi-duplicate')?.status !== 'external_review_required') fail('Duplicate Psychology Today profile must remain explicitly tracked for external review.');
if(conflicts.get('headway-experience-count')?.status !== 'external_review_required') fail('Headway experience-count conflict must remain explicitly tracked for external review.');
if(authority.guardrails?.preciseYearsOfExperience !== 'prohibited_without_explicit_verification') fail('Authority registry must guard precise years-of-experience claims.');
if(recognition.canonicalPersonId !== person['@id'] || recognition.canonicalOrganizationId !== orgSchema['@id']) fail('Recognition baseline canonical IDs must match entity schemas.');
if(recognition.entities?.person?.expectedOrganizationId !== orgSchema['@id']) fail('Recognition baseline Person must point to canonical Organization.');
if(recognition.entities?.organization?.expectedPersonId !== person['@id']) fail('Recognition baseline Organization must point to canonical Person.');
const recognitionConflictIds = new Set(recognition.entities?.person?.knownConflictIds || []);
for(const id of ['psychology-today-mississippi-duplicate','headway-experience-count']) if(!recognitionConflictIds.has(id)) fail(`Recognition baseline missing known conflict: ${id}`);
const kp = recognition.recognitionState?.googleKnowledgePanel || {};
if(!['unverified','verified_present','verified_absent'].includes(kp.person)) fail('Person Knowledge Panel state invalid.');
if(!['unverified','verified_present','verified_absent'].includes(kp.organization)) fail('Organization Knowledge Panel state invalid.');
if((kp.person !== 'unverified' || kp.organization !== 'unverified') && !(Array.isArray(kp.evidence) && kp.evidence.length > 0 && kp.lastVerifiedAt)) fail('Verified Knowledge Panel state requires dated evidence.');
const ai = recognition.recognitionState?.aiRecognition || {};
if(!['unverified','verified'].includes(ai.status)) fail('AI recognition state invalid.');
if(ai.status === 'verified' && !(Array.isArray(ai.providersTested) && ai.providersTested.length > 0 && Array.isArray(ai.evidence) && ai.evidence.length > 0 && ai.lastVerifiedAt)) fail('Verified AI recognition requires providers, dated evidence, and observations.');
const requiredQueries = [
  'Monika Hicks','Monika Hicks LCSW','Monika Hicks Hicks Consulting','Monika Hicks consultant','Monika Hicks speaker','Hicks Consulting','Hicks Consulting Memphis','Hicks Consulting Monika Hicks'
];
const queryMap = new Map((recognitionQueries.queries || []).map(item => [item.query, item]));
for(const query of requiredQueries){
  const item = queryMap.get(query);
  if(!item) fail(`Recognition query registry missing query: ${query}`);
  if(!Array.isArray(item.expectedAssertions) || item.expectedAssertions.length === 0) fail(`Recognition query missing expected assertions: ${query}`);
}
if(queryMap.size !== requiredQueries.length) fail('Recognition query registry must contain exactly the locked Phase 6A query set.');
const assertionKeys = new Set(Object.keys(recognitionQueries.assertions || {}));
for(const item of queryMap.values()) for(const assertion of item.expectedAssertions) if(!assertionKeys.has(assertion)) fail(`Recognition query references undefined assertion: ${assertion}`);
const offers = new Set((orgSchema.makesOffer || []).map(item => item?.itemOffered?.name));
const serviceNames = new Set(entities.services.map(s => s.name));
const requiredServices = [
  {label:'Virtual therapy', test:(name)=>/^Virtual therapy/i.test(name)},
  {label:'Virtual coaching', test:(name)=>name==='Virtual coaching'},
  {label:'Virtual support groups', test:(name)=>name==='Virtual support groups'},
  {label:'Organizational trainings', test:(name)=>name==='Organizational trainings'}
];
for(const required of requiredServices){
  const registryMatch = [...serviceNames].find(required.test);
  if(!registryMatch) fail(`Missing required service entity: ${required.label}`);
  if(!offers.has(registryMatch)) fail(`Organization makesOffer missing required service: ${required.label}`);
}
console.log('Entity coverage OK');
