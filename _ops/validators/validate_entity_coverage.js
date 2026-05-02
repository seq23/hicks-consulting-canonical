const { read, fail } = require('./util');
const entities = JSON.parse(read('data/entities/entity_registry.json'));
if(!entities.organization?.name || !entities.provider?.name || !entities.services?.length) fail('Entity registry incomplete');
console.log('Entity coverage OK');
