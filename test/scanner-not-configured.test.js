const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');

// Deliberately never created, to exercise the "no title folder mounted" path.
process.env.TITLES_DIR = path.join(os.tmpdir(), `stl-missing-${Date.now()}-${Math.random().toString(16).slice(2)}`);

const scanner = require('../lib/scanner');

test('isConfigured is false when TITLES_DIR does not exist', () => {
  assert.equal(scanner.isConfigured(), false);
});

test('scanLibrary returns an empty array when not configured', () => {
  assert.deepEqual(scanner.scanLibrary(), []);
});

test('getDiagnostics reports exists:false when not configured', () => {
  assert.deepEqual(scanner.getDiagnostics(), {
    titlesDir: scanner.TITLES_DIR,
    exists: false,
    totalFiles: 0,
    matchedFiles: 0,
  });
});
