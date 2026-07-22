const fs = require('fs');
const os = require('os');
const path = require('path');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJSON(dir, name, data) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
}

module.exports = { tempDir, writeJSON };
