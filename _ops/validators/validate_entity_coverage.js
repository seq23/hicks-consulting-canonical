const { read, fail } = require('./util');
function parse(file){ try { return JSON.parse(read(file)); } catch(error){ fail(`${file} is not valid JSON: ${error.message}`); } }
const entities = parse('data/entities/entity_registry.json');
const author = parse('data/entities/author_profile.json');
const org = parse('data/entities/org_profile.json');
const person = parse('data/entities/person_schema.json');
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
if(!subjects.some(item => item && /psychologytoday\.com/.test(item.url || ''))) fail('Monika Person must include the verified Psychology Today profile evidence.');
const serviceNames = new Set(entities.services.map(s => s.name));
const requiredServices = [
  {label:'Virtual therapy', test:(name)=>/^Virtual therapy/i.test(name)},
  {label:'Virtual coaching', test:(name)=>name==='Virtual coaching'},
  {label:'Virtual support groups', test:(name)=>name==='Virtual support groups'},
  {label:'Organizational trainings', test:(name)=>name==='Organizational trainings'}
];
for(const required of requiredServices){
  if(![...serviceNames].some(required.test)) fail(`Missing required service entity: ${required.label}`);
}
console.log('Entity coverage OK');
