const test = require('node:test');
const assert = require('node:assert/strict');
const { tempDir, writeJSON } = require('./helpers');

const dataDir = tempDir('stl-data-');
process.env.DATA_DIR = dataDir;

const REGION = 'US.en.json';
const BASE_ID = '0100000000050000';
const KNOWN_UPDATE_ID = '0100000000050001';

writeJSON(dataDir, REGION, {
  1: { id: BASE_ID, name: 'Expand Base Game', nsuId: 1, iconUrl: 'icon1' },
});
writeJSON(dataDir, 'cnmts.json', {
  [BASE_ID]: { 0: { titleId: BASE_ID, titleType: 128, otherApplicationId: null } },
  [KNOWN_UPDATE_ID]: { 131072: { titleId: KNOWN_UPDATE_ID, titleType: 129, otherApplicationId: BASE_ID } },
});

const decisions = require('../lib/decisions');
const cnmts = require('../lib/cnmts');
const expand = require('../lib/expand');

test('a manually-set version override not known to cnmts.json shows up as a synthetic, owned entry', () => {
  decisions.setDecision('Digimon Update.nsp', { status: 'accepted', titleId: BASE_ID, region: REGION, version: '196608' });

  const { results, ownedCount } = expand.getExpansions(REGION, BASE_ID);
  assert.equal(results.length, 2);

  const known = results.find((r) => r.titleId === KNOWN_UPDATE_ID);
  assert.equal(known.owned, false);

  const manual = results.find((r) => r.manual === true);
  assert.equal(manual.version, 196608);
  assert.equal(manual.titleId, BASE_ID);
  assert.equal(manual.owned, true);
  assert.equal(manual.match, null);

  assert.equal(ownedCount, 1);
});

// Regression test: once titledb catches up and assigns the manually-known
// version its own cnmts.json catalog entry, the file you already accepted
// (matched to the base titleId + a version override) must still show as
// owned for that entry — not silently drop back to unowned — even though
// its titleId never literally matched anything you accepted.
test('a version override still counts as owned once cnmts.json later catalogs that exact version itself', () => {
  const NEWLY_KNOWN_UPDATE_ID = '0100000000050002';
  writeJSON(dataDir, 'cnmts.json', {
    [BASE_ID]: { 0: { titleId: BASE_ID, titleType: 128, otherApplicationId: null } },
    [KNOWN_UPDATE_ID]: { 131072: { titleId: KNOWN_UPDATE_ID, titleType: 129, otherApplicationId: BASE_ID } },
    [NEWLY_KNOWN_UPDATE_ID]: { 196608: { titleId: NEWLY_KNOWN_UPDATE_ID, titleType: 129, otherApplicationId: BASE_ID } },
  });
  cnmts.invalidate();

  const { results, ownedCount } = expand.getExpansions(REGION, BASE_ID);
  assert.equal(results.length, 2); // no duplicate synthetic row
  assert.equal(results.some((r) => r.manual === true), false);

  const nowKnown = results.find((r) => r.titleId === NEWLY_KNOWN_UPDATE_ID);
  assert.equal(nowKnown.version, 196608);
  assert.equal(nowKnown.owned, true);

  assert.equal(ownedCount, 1);
});
