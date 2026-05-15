const { read, fail } = require('./util');
function parse(file){ try { return JSON.parse(read(file)); } catch(error){ fail(`${file} is not valid JSON: ${error.message}`); } }
const entities = parse('data/entities/entity_registry.json');
const author = parse('data/entities/author_profile.json');
const org = parse('data/entities/org_profile.json');
if(!entities.organization?.name || !entities.organization?.url) fail('Entity registry missing organization name/url.');
if(!entities.provider?.name || !entities.provider?.role) fail('Entity registry missing provider name/role.');
if(!Array.isArray(entities.services) || entities.services.length < 4) fail('Entity registry must define therapy, coaching, groups, and organizational training services.');
if(!entities.domain?.canonicalDomain) fail('Entity registry missing canonical domain.');
if(!author.name || !author.organization || !author.bio) fail('Author profile incomplete.');
if(!org.name || !org.url || !Array.isArray(org.sameAs)) fail('Org profile incomplete.');
if(org.name !== entities.organization.name) fail('Org profile name must match entity registry organization name.');
if(author.organization !== entities.organization.name) fail('Author organization must match entity registry organization name.');
const serviceNames = new Set(entities.services.map(s => s.name));
for(const required of ['Virtual therapy in Tennessee','Virtual coaching','Virtual support groups','Organizational trainings']){
  if(!serviceNames.has(required)) fail(`Missing required service entity: ${required}`);
}
console.log('Entity coverage OK');
