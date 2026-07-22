const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tempDir } = require('./helpers');

const titlesDir = tempDir('stl-titles-');
process.env.TITLES_DIR = titlesDir;

const scanner = require('../lib/scanner');

test('extractTitleId finds a bracketed 16-hex id', () => {
  assert.equal(scanner.extractTitleId('Game Name [0100ABCD00000000][v0].nsp'), '0100ABCD00000000');
});

test('extractTitleId is case-insensitive and uppercases the result', () => {
  assert.equal(scanner.extractTitleId('game [0100abcd00000000][v0].nsp'), '0100ABCD00000000');
});

test('extractTitleId returns null when no id tag is present', () => {
  assert.equal(scanner.extractTitleId('Game Name.nsp'), null);
});

test('extractVersion finds a bracketed version tag', () => {
  assert.equal(scanner.extractVersion('Game [0100ABCD00000000][v65536].nsp'), '65536');
});

test('extractVersion returns null when no version tag is present', () => {
  assert.equal(scanner.extractVersion('Game [0100ABCD00000000].nsp'), null);
});

test('isConfigured is true when TITLES_DIR exists', () => {
  assert.equal(scanner.isConfigured(), true);
});

test('scanLibrary recursively finds only supported extensions', () => {
  fs.writeFileSync(path.join(titlesDir, 'Base Game [0100000000000000][v0].nsp'), '');
  fs.writeFileSync(path.join(titlesDir, 'ignore-me.txt'), '');
  const sub = path.join(titlesDir, 'sub');
  fs.mkdirSync(sub);
  fs.writeFileSync(path.join(sub, 'Nested [0100000000000001][v65536].xci'), '');

  const results = scanner.scanLibrary();
  const paths = results.map((r) => r.path).sort();
  assert.deepEqual(paths, [
    'Base Game [0100000000000000][v0].nsp',
    path.join('sub', 'Nested [0100000000000001][v65536].xci'),
  ]);

  const nested = results.find((r) => r.fileName.startsWith('Nested'));
  assert.equal(nested.titleId, '0100000000000001');
  assert.equal(nested.version, '65536');

  assert.equal(results.every((r) => !r.fileName.includes('ignore-me')), true);
});

test('getDiagnostics reports matched vs total files once the library has content', () => {
  const diag = scanner.getDiagnostics();
  assert.equal(diag.exists, true);
  assert.equal(diag.totalFiles, 3); // 2 supported + 1 .txt
  assert.equal(diag.matchedFiles, 2);
});
