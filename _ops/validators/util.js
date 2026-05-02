const fs = require('fs');
const path = require('path');
function read(file){ return fs.readFileSync(path.join(process.cwd(), file), 'utf8'); }
function exists(file){ return fs.existsSync(path.join(process.cwd(), file)); }
function fail(message){ console.error(message); process.exit(1); }
module.exports = { read, exists, fail, fs, path };
