const fs = require('fs');
const path = require('path');
const { fail } = require('../validation/protocol');
function read(file){ return fs.readFileSync(path.join(process.cwd(), file), 'utf8'); }
function exists(file){ return fs.existsSync(path.join(process.cwd(), file)); }
module.exports = { read, exists, fail, fs, path };
