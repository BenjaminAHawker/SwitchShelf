const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tempDir, writeJSON } = require('./helpers');

const dataDir = tempDir('stl-data-');
const titlesDir = tempDir('stl-titles-');
process.env.DATA_DIR = dataDir;
process.env.TITLES_DIR = titlesDir;

const REGION = 'US.en.json';
const BASE_ID = '0100000000010000';
const DLC_ID = '0100000000011001';

writeJSON(dataDir, REGION, {
  1: { id: BASE_ID, name: 'Organize Base Game', nsuId: 1, iconUrl: 'icon1' },
  2: { id: DLC_ID, name: 'Organize Base Game DLC Pack', nsuId: 2, iconUrl: null },
});
writeJSON(dataDir, 'cnmts.json', {
  [BASE_ID]: { 0: { titleId: BASE_ID, titleType: 128, otherApplicationId: null } },
  [DLC_ID]: { 0: { titleId: DLC_ID, titleType: 130, otherApplicationId: BASE_ID } },
});

const decisions = require('../lib/decisions');
const organize = require('../lib/organize');

const baseFile = 'Organize Base Game [0100000000010000][v0].nsp';
const dlcFile = 'Organize Base Game DLC [0100000000011001][v0].nsp';
const rejectedFile = 'Rejected File [0100000000010000][v0].nsp';
const missingFile = 'Missing Source [0100000000010000][v0].nsp';
const untaggedUpdateFile = 'Organize Base Game Update.nsp';
const taggedUpdateFile = 'Organize Base Game [0100000000010000][v131072].nsp';

fs.writeFileSync(path.join(titlesDir, baseFile), '');
fs.writeFileSync(path.join(titlesDir, dlcFile), '');
fs.writeFileSync(path.join(titlesDir, rejectedFile), '');
fs.writeFileSync(path.join(titlesDir, untaggedUpdateFile), '');
fs.writeFileSync(path.join(titlesDir, taggedUpdateFile), '');
// missingFile deliberately never created on disk.

decisions.setDecision(baseFile, { status: 'accepted', titleId: BASE_ID, region: REGION });
decisions.setDecision(dlcFile, { status: 'accepted', titleId: DLC_ID, region: REGION });
decisions.setDecision(rejectedFile, { status: 'rejected', titleId: BASE_ID, region: REGION });
decisions.setDecision(missingFile, { status: 'accepted', titleId: BASE_ID, region: REGION });
decisions.setDecision(untaggedUpdateFile, { status: 'accepted', titleId: BASE_ID, region: REGION, version: '65536' });
decisions.setDecision(taggedUpdateFile, { status: 'accepted', titleId: BASE_ID, region: REGION });

test('sanitize strips filesystem-illegal characters, trademarks, and trailing junk', () => {
  assert.equal(organize.sanitize('Game™: Name / Sub\\Thing?* ', 'fallback'), 'Game Name SubThing');
  assert.equal(organize.sanitize('', 'fallback'), 'fallback');
  assert.equal(organize.sanitize(null, 'fallback'), 'fallback');
});

test('buildPlan computes base and DLC destinations, and reports the missing source as skipped', () => {
  const { plan, skipped } = organize.buildPlan(REGION);

  const basePlan = plan.find((p) => p.path === baseFile);
  assert.equal(basePlan.to, path.join('Organize Base Game[0100000000010000]', 'Organize Base Game [0100000000010000][0].nsp'));
  assert.equal(basePlan.contentType, 'base');

  const dlcPlan = plan.find((p) => p.path === dlcFile);
  assert.equal(dlcPlan.to, path.join('Organize Base Game[0100000000010000]', 'Organize Base Game - Organize Base Game DLC Pack [0100000000011001].nsp'));
  assert.equal(dlcPlan.contentType, 'dlc');

  assert.equal(plan.some((p) => p.path === rejectedFile), false);

  const missingSkip = skipped.find((s) => s.path === missingFile);
  assert.ok(missingSkip);
  assert.match(missingSkip.reason, /no longer exists/);
});

test('buildPlan uses a decision\'s manual version override for files with no "[vNNN]" tag of their own', () => {
  const { plan } = organize.buildPlan(REGION);
  const updatePlan = plan.find((p) => p.path === untaggedUpdateFile);
  assert.ok(updatePlan);
  assert.equal(updatePlan.to, path.join('Organize Base Game[0100000000010000]', 'Organize Base Game [0100000000010000][65536].nsp'));
});

// Regression test: update NSPs share their base game's titleId on real
// hardware (only the version differs), so a match resolved by titleId alone
// always comes back as the base game's own catalog entry — cnmts.getContentType
// has no way to tell "the base install" and "an update of it" apart by id.
// buildPlan needs to infer that from the version instead, whether it comes
// from a "[vNNN]" tag in the filename or a manual override.
test('buildPlan reports contentType "update", not "base", for a non-zero version of a base game', () => {
  const { plan } = organize.buildPlan(REGION);

  const taggedPlan = plan.find((p) => p.path === taggedUpdateFile);
  assert.ok(taggedPlan);
  assert.equal(taggedPlan.contentType, 'update');

  const overriddenPlan = plan.find((p) => p.path === untaggedUpdateFile);
  assert.ok(overriddenPlan);
  assert.equal(overriddenPlan.contentType, 'update');

  // The actual base install (v0) is unaffected — still reported as "base".
  const basePlan = plan.find((p) => p.path === baseFile);
  assert.equal(basePlan.contentType, 'base');
});

test('buildPlan skips an item whose destination already exists', () => {
  const destDir = path.join(titlesDir, 'Organize Base Game[0100000000010000]');
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(path.join(destDir, 'Organize Base Game [0100000000010000][0].nsp'), 'already here');

  const { plan, skipped } = organize.buildPlan(REGION);
  assert.equal(plan.some((p) => p.path === baseFile), false);
  assert.equal(plan.some((p) => p.path === dlcFile), true); // unaffected

  const skip = skipped.find((s) => s.path === baseFile);
  assert.match(skip.reason, /already exists/);

  fs.rmSync(destDir, { recursive: true, force: true });
});

test('applyPlan moves the file on disk and re-keys its decision', () => {
  const { moved, errors } = organize.applyPlan(REGION, [dlcFile]);
  assert.equal(errors.length, 0);
  assert.equal(moved.length, 1);

  const destFull = path.join(titlesDir, moved[0].to);
  assert.equal(fs.existsSync(destFull), true);
  assert.equal(fs.existsSync(path.join(titlesDir, dlcFile)), false);

  const all = decisions.readAll();
  assert.equal(all[dlcFile], undefined);
  assert.equal(all[moved[0].to].titleId, DLC_ID);
});

test('applyPlan only touches the paths it was asked to move', () => {
  assert.equal(fs.existsSync(path.join(titlesDir, baseFile)), true);
});
