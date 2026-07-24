const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tempDir, writeJSON } = require('./helpers');

const dataDir = tempDir('stl-data-');
const titlesDir = tempDir('stl-titles-');
const stagingDir = tempDir('stl-staging-');
process.env.DATA_DIR = dataDir;
process.env.TITLES_DIR = titlesDir;
process.env.STAGING_DIR = stagingDir;

const REGION = 'US.en.json';
const BASE_ID = '0100000000020000';

writeJSON(dataDir, REGION, {
  1: { id: BASE_ID, name: 'Staging Base Game', nsuId: 1, iconUrl: 'icon1' },
});

const decisions = require('../lib/decisions');
const scanner = require('../lib/scanner');
const organize = require('../lib/organize');

const stagedFile = 'Staging Base Game [0100000000020000][v0].nsp';
fs.writeFileSync(path.join(stagingDir, stagedFile), '');

test('isStagingConfigured / scanStaging find files under STAGING_DIR, separate from TITLES_DIR', () => {
  assert.equal(scanner.isStagingConfigured(), true);
  const results = scanner.scanStaging();
  assert.equal(results.length, 1);
  assert.equal(results[0].path, stagedFile);
  assert.equal(results[0].titleId, BASE_ID);
  // TITLES_DIR is untouched.
  assert.deepEqual(scanner.scanLibrary(), []);
});

test('staging decisions live in a separate namespace from library decisions of the same path', () => {
  decisions.setDecision(stagedFile, { status: 'accepted', titleId: BASE_ID, region: REGION }, 'staging');
  decisions.setDecision(stagedFile, { status: 'rejected', titleId: BASE_ID, region: REGION }, 'library');

  assert.equal(decisions.readAllFor('staging')[stagedFile].status, 'accepted');
  assert.equal(decisions.readAllFor('library')[stagedFile].status, 'rejected');

  decisions.clearDecision(stagedFile, 'library');
  assert.equal(decisions.readAllFor('library')[stagedFile], undefined);
  assert.equal(decisions.readAllFor('staging')[stagedFile].status, 'accepted');
});

test('buildStagingPlan computes a destination inside TITLES_DIR', () => {
  const { plan, skipped } = organize.buildStagingPlan(REGION);
  assert.equal(skipped.length, 0);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].path, stagedFile);
  assert.equal(plan[0].to, path.join('Staging Base Game[0100000000020000]', 'Staging Base Game [0100000000020000][v0].nsp'));
});

test('applyStagingPlan moves the file from STAGING_DIR into TITLES_DIR and re-keys the decision into the library namespace', () => {
  const { moved, errors } = organize.applyStagingPlan(REGION, [stagedFile]);
  assert.equal(errors.length, 0);
  assert.equal(moved.length, 1);

  assert.equal(fs.existsSync(path.join(stagingDir, stagedFile)), false);
  const destFull = path.join(titlesDir, moved[0].to);
  assert.equal(fs.existsSync(destFull), true);

  assert.equal(decisions.readAllFor('staging')[stagedFile], undefined);
  assert.equal(decisions.readAllFor('library')[moved[0].to].titleId, BASE_ID);

  // A subsequent staging scan no longer finds it; a library scan would.
  assert.deepEqual(scanner.scanStaging(), []);
});

test('applyStagingPlan removes an empty Staging subfolder (and empty parents) after moving its last file, but never STAGING_DIR itself', () => {
  const nestedDir = path.join(stagingDir, 'DropFolder', 'Nested');
  fs.mkdirSync(nestedDir, { recursive: true });
  const nestedFile = path.join('DropFolder', 'Nested', 'Nested Game [0100000000020000][v1].nsp');
  fs.writeFileSync(path.join(stagingDir, nestedFile), '');
  decisions.setDecision(nestedFile, { status: 'accepted', titleId: BASE_ID, region: REGION }, 'staging');

  const { moved, errors } = organize.applyStagingPlan(REGION, [nestedFile]);
  assert.equal(errors.length, 0);
  assert.equal(moved.length, 1);

  assert.equal(fs.existsSync(path.join(stagingDir, 'DropFolder', 'Nested')), false);
  assert.equal(fs.existsSync(path.join(stagingDir, 'DropFolder')), false);
  assert.equal(fs.existsSync(stagingDir), true);
});

test('applyStagingPlan leaves a Staging subfolder in place if it still has other files', () => {
  const dir = path.join(stagingDir, 'MixedFolder');
  fs.mkdirSync(dir, { recursive: true });
  const targetFile = path.join('MixedFolder', 'Target Game [0100000000020000][v2].nsp');
  fs.writeFileSync(path.join(stagingDir, targetFile), '');
  fs.writeFileSync(path.join(dir, 'leftover.txt'), '');
  decisions.setDecision(targetFile, { status: 'accepted', titleId: BASE_ID, region: REGION }, 'staging');

  const { moved, errors } = organize.applyStagingPlan(REGION, [targetFile]);
  assert.equal(errors.length, 0);
  assert.equal(moved.length, 1);

  assert.equal(fs.existsSync(dir), true);
  assert.equal(fs.existsSync(path.join(dir, 'leftover.txt')), true);
});
