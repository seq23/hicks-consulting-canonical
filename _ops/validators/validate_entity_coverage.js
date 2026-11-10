// validate:entities (restored 10 Nov 2026, hostile review: identity claims only).
//  - the canonical Person is "Monika Hicks, LCSW" (her licensed credential, as she states it);
//  - sameAs carries only verified profiles: the Person's verified LinkedIn, the Organization's
//    verified Instagram and Facebook, never Monika's profiles or editorial evidence on the
//    Organization, and never the noncanonical Mississippi Psychology Today duplicate.
const { read, fail } = require('./util');
function parse(file){ try { return JSON.parse(read(file)); } catch(error){ fail(`${file} is not valid JSON: ${error.message}`); } }
const person = parse('data/entities/person_schema.json');
const orgSchema = parse('data/entities/org_schema.json');
const VERIFIED_PERSON_SAMEAS = new Set(['https://www.linkedin.com/in/monika-hicks-lcsw-8168b6b0/']);
const VERIFIED_ORG_SAMEAS = new Set(['https://www.instagram.com/hicksconsulting', 'https://www.facebook.com/profile.php?id=61563824221571']);
const MS_DUPLICATE = /psychologytoday\.com\/us\/therapists\/monika-hicks-olive-branch-ms\/1663504/;
if(person['@type'] !== 'Person') fail('Monika person schema must be a schema.org Person.');
if(person.name !== 'Monika Hicks, LCSW') fail(`Monika canonical Person name is "${person.name}", not "Monika Hicks, LCSW".`);
const personSameAs = person.sameAs || [];
if(!personSameAs.length) fail('Monika Person sameAs is empty; the verified LinkedIn profile belongs there.');
for(const url of personSameAs) if(!VERIFIED_PERSON_SAMEAS.has(url)) fail(`Monika Person sameAs carries an unverified profile: ${url}`);
const orgSameAs = orgSchema.sameAs || [];
if(!orgSameAs.length) fail('Hicks Consulting Organization sameAs is empty; the verified social profiles belong there.');
for(const url of orgSameAs) if(!VERIFIED_ORG_SAMEAS.has(url)) fail(`Hicks Consulting Organization sameAs carries an unverified or person/editorial profile: ${url}`);
for(const item of [...(person.subjectOf || []), ...personSameAs.map(url => ({ url }))]) if(item && MS_DUPLICATE.test(item.url || '')) fail('Noncanonical Mississippi Psychology Today profile must not be promoted into the Person.');
console.log(`Entity coverage OK (Person "${person.name}"; ${personSameAs.length} + ${orgSameAs.length} sameAs, all verified)`);
