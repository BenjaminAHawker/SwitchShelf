const test = require('node:test');
const assert = require('node:assert/strict');
const { tempDir, writeJSON } = require('./helpers');

const dataDir = tempDir('stl-data-');
process.env.DATA_DIR = dataDir;

const REGION = 'US.en.json';

// A fixture mirroring titledb's shape: keyed by nsuId, values have id/name/etc.
// "10" and "11" share a titleId to exercise the Switch/Switch2-Edition collision.
writeJSON(dataDir, REGION, {
  10: { id: '0100000000000001', name: 'Test Game', nsuId: 10, iconUrl: 'icon10', languages: ['en', 'ja'], releaseDate: 20200101 },
  11: { id: '0100000000000001', name: 'Test Game – Nintendo Switch 2 Edition', nsuId: 11, iconUrl: 'icon11', languages: ['en'], releaseDate: 20250101 },
  20: { id: '0400000000000002', name: 'Native Switch2 Game', nsuId: 20, iconUrl: 'icon20', languages: ['en', 'fr'], releaseDate: 20250601 },
  30: { id: '0100000000011001', name: 'Test Game DLC Pack', nsuId: 30, iconUrl: null, languages: ['en'], releaseDate: 20200601 },
  40: { id: '0100000000012000', name: 'Test Game Demo', nsuId: 40, iconUrl: 'icon40', languages: ['en'], releaseDate: 20200101 },
  50: { name: 'No Id Entry', nsuId: 50 },
  60: { id: '0100000000099999', nsuId: 60 },
  70: { id: '0100000000010000', name: 'Base For DLC Test', nsuId: 70, iconUrl: 'icon70', languages: ['en'], releaseDate: 20190101 },
  80: { id: '0100000000013000', name: 'Sneaky DLC With Icon', nsuId: 80, iconUrl: 'icon80', languages: ['en'], releaseDate: 20200601 },
  90: { id: '0100000000020000', name: 'Digimon Story Time Stranger', nsuId: 90, iconUrl: 'icon90', languages: ['en'], releaseDate: 20240315 },
  91: { id: '0100000000021000', name: 'Digimon Survive', nsuId: 91, iconUrl: 'icon91', languages: ['en'], releaseDate: 20220729 },
});

const store = require('../lib/store');
const decisions = require('../lib/decisions');

test('isDownloaded reflects whether the region file exists', () => {
  assert.equal(store.isDownloaded(REGION), true);
  assert.equal(store.isDownloaded('missing.json'), false);
});

test('isSwitch2 detects native Switch 2 ids and "Switch 2" in the name', () => {
  assert.equal(store.isSwitch2({ id: '0400000000000002', name: 'Native Switch2 Game' }), true);
  assert.equal(store.isSwitch2({ id: '0100000000000001', name: 'Game – Nintendo Switch 2 Edition' }), true);
  assert.equal(store.isSwitch2({ id: '0100000000000001', name: 'Ordinary Game' }), false);
});

test('findAllByTitleId returns every entry sharing an id, Switch before Switch2', () => {
  const all = store.findAllByTitleId(REGION, '0100000000000001');
  assert.equal(all.length, 2);
  assert.equal(all[0].name, 'Test Game');
  assert.equal(all[0].isSwitch2, false);
  assert.equal(all[1].name, 'Test Game – Nintendo Switch 2 Edition');
  assert.equal(all[1].isSwitch2, true);
});

test('findByTitleId defaults to the non-Switch2 entry', () => {
  const match = store.findByTitleId(REGION, '0100000000000001');
  assert.equal(match.name, 'Test Game');
});

test('findByTitleId / findAllByTitleId return null/[] for an unknown id', () => {
  assert.equal(store.findByTitleId(REGION, 'DEADBEEFDEADBEEF'), null);
  assert.deepEqual(store.findAllByTitleId(REGION, 'DEADBEEFDEADBEEF'), []);
});

test('resolveVariant offers both options and defaults to Switch', () => {
  const { match, variantOptions } = store.resolveVariant(REGION, '0100000000000001', null);
  assert.equal(match.name, 'Test Game');
  assert.ok(variantOptions.switch);
  assert.ok(variantOptions.switch2);
});

test('resolveVariant honors an explicit switch2 preference', () => {
  const { match } = store.resolveVariant(REGION, '0100000000000001', 'switch2');
  assert.equal(match.name, 'Test Game – Nintendo Switch 2 Edition');
});

test('resolveVariant reports no variantOptions when there is only one candidate', () => {
  const { match, variantOptions } = store.resolveVariant(REGION, '0400000000000002', null);
  assert.equal(match.name, 'Native Switch2 Game');
  assert.equal(variantOptions, null);
});

test('getContentType falls back to a no-icon heuristic before cnmts.json exists', () => {
  const dlc = store.findByTitleId(REGION, '0100000000011001');
  const demo = store.findByTitleId(REGION, '0100000000012000');
  const sneaky = store.findByTitleId(REGION, '0100000000013000');
  assert.equal(store.getContentType(dlc), 'dlc'); // no icon
  assert.equal(store.getContentType(demo), 'demo'); // name-based, independent of cnmts
  assert.equal(store.getContentType(sneaky), null); // has an icon, so "unknown" (assume base)
});

test('getContentType prefers cnmts.json once it is available, even over the icon heuristic', () => {
  writeJSON(dataDir, 'cnmts.json', {
    '0100000000010000': { 0: { titleId: '0100000000010000', titleType: 128, otherApplicationId: null } },
    '0100000000011001': { 0: { titleId: '0100000000011001', titleType: 130, otherApplicationId: '0100000000010000' } },
    '0100000000013000': { 0: { titleId: '0100000000013000', titleType: 130, otherApplicationId: '0100000000010000' } },
  });

  const base = store.findByTitleId(REGION, '0100000000010000');
  const sneaky = store.findByTitleId(REGION, '0100000000013000');
  assert.equal(store.getContentType(base), 'base');
  assert.equal(store.getContentType(sneaky), 'dlc'); // cnmts overrides the "has an icon" heuristic
});

test('search: browsing (empty query) defaults to games only, sorted by name', () => {
  const { total, results } = store.search(REGION, '');
  const names = results.map((r) => r.name).sort();
  assert.deepEqual(names, [
    'Base For DLC Test',
    'Digimon Story Time Stranger',
    'Digimon Survive',
    'Native Switch2 Game',
    'Test Game',
    'Test Game – Nintendo Switch 2 Edition',
  ]);
  assert.equal(total, 6);
});

test('search: contentType "all" includes DLC and demos too', () => {
  const { total } = store.search(REGION, '', { contentType: 'all' });
  assert.equal(total, 9); // everything with an id and a name
});

test('search: name matching is word-order-independent, not a single substring', () => {
  const { total, results } = store.search(REGION, 'digimon time');
  assert.equal(total, 1);
  assert.equal(results[0].name, 'Digimon Story Time Stranger');
  // "Digimon Survive" has "digimon" but not "time", so it's excluded.
});

test('search: sort option controls order (name-desc, date-desc, date-asc)', () => {
  const byNameDesc = store.search(REGION, 'digimon', { sort: 'name-desc' });
  assert.deepEqual(byNameDesc.results.map((r) => r.name), ['Digimon Survive', 'Digimon Story Time Stranger']);

  const byDateDesc = store.search(REGION, 'digimon', { sort: 'date-desc' });
  assert.deepEqual(byDateDesc.results.map((r) => r.name), ['Digimon Story Time Stranger', 'Digimon Survive']);

  const byDateAsc = store.search(REGION, 'digimon', { sort: 'date-asc' });
  assert.deepEqual(byDateAsc.results.map((r) => r.name), ['Digimon Survive', 'Digimon Story Time Stranger']);
});

test('search: text query matches by name, still filtered to games by default', () => {
  const { total, results } = store.search(REGION, 'Test Game');
  assert.equal(total, 2);
  assert.deepEqual(results.map((r) => r.name).sort(), ['Test Game', 'Test Game – Nintendo Switch 2 Edition']);
});

test('search: text query with contentType "all" also returns the DLC and demo matches', () => {
  const { total, results } = store.search(REGION, 'Test Game', { contentType: 'all' });
  assert.equal(total, 4);
  const dlc = results.find((r) => r.name === 'Test Game DLC Pack');
  const demo = results.find((r) => r.name === 'Test Game Demo');
  assert.equal(dlc.contentType, 'dlc');
  assert.equal(demo.contentType, 'demo');
});

test('search: nsuId field matching', () => {
  const { results } = store.search(REGION, '10', { field: 'nsuId', contentType: 'all' });
  assert.ok(results.some((r) => r.nsuId === 10));
});

test('search: platform filter', () => {
  const switch2Only = store.search(REGION, '', { platform: 'switch2' });
  assert.deepEqual(switch2Only.results.map((r) => r.name).sort(), ['Native Switch2 Game', 'Test Game – Nintendo Switch 2 Edition']);

  const switchOnly = store.search(REGION, '', { platform: 'switch' });
  assert.deepEqual(switchOnly.results.map((r) => r.name).sort(), [
    'Base For DLC Test',
    'Digimon Story Time Stranger',
    'Digimon Survive',
    'Test Game',
  ]);
});

test('search: language filter (OR across selected codes)', () => {
  const { total, results } = store.search(REGION, '', { languages: ['fr'] });
  assert.equal(total, 1);
  assert.equal(results[0].name, 'Native Switch2 Game');
});

test('getAvailableLanguages returns the sorted set actually used in the region', () => {
  assert.deepEqual(store.getAvailableLanguages(REGION), ['en', 'fr', 'ja']);
});

test('search: owned filter reflects accepted Library Scan decisions', () => {
  decisions.setDecision('some-file.nsp', { status: 'accepted', titleId: '0100000000000001', region: REGION });

  // No variant was recorded, which resolveVariant treats as "the Switch
  // entry" — so only that one sibling counts as owned, not both.
  const owned = store.search(REGION, '', { owned: 'owned', contentType: 'all' });
  assert.equal(owned.total, 1);
  assert.equal(owned.results[0].name, 'Test Game');

  const missing = store.search(REGION, '', { owned: 'missing', contentType: 'all' });
  assert.equal(missing.total, 8); // includes the Switch 2 Edition sibling
  assert.ok(missing.results.every((r) => r.owned === false));

  decisions.clearDecision('some-file.nsp');
});

// Regression test: Switch and Switch 2 Edition catalog entries share a
// titleId, so accepting one variant in Library Scan must not also mark its
// sibling as owned.
test('search: accepting the Switch 2 Edition variant only marks that entry owned, not its Switch sibling', () => {
  decisions.setDecision('some-file-switch2.nsp', { status: 'accepted', titleId: '0100000000000001', region: REGION, variant: 'switch2' });

  const owned = store.search(REGION, '', { owned: 'owned', contentType: 'all' });
  assert.equal(owned.total, 1);
  assert.equal(owned.results[0].name, 'Test Game – Nintendo Switch 2 Edition');

  const missing = store.search(REGION, '', { owned: 'missing', contentType: 'all' });
  assert.ok(missing.results.some((r) => r.name === 'Test Game'));

  decisions.clearDecision('some-file-switch2.nsp');
});

test('search: a title with no Switch/Switch2 sibling is owned regardless of its variant field', () => {
  // Native Switch 2 title (id 0400...) has no sibling to disambiguate from.
  decisions.setDecision('native-switch2.nsp', { status: 'accepted', titleId: '0400000000000002', region: REGION });

  const { results } = store.search(REGION, '', { owned: 'owned', contentType: 'all' });
  assert.equal(results.length, 1);
  assert.equal(results[0].name, 'Native Switch2 Game');

  decisions.clearDecision('native-switch2.nsp');
});

test('getDemosFor matches a demo to its base game by stripped name', () => {
  const base = store.findByTitleId(REGION, '0100000000000001');
  const demos = store.getDemosFor(REGION, base);
  assert.equal(demos.length, 1);
  assert.equal(demos[0].name, 'Test Game Demo');
});

test('getDemosFor returns nothing for a title with no matching demo', () => {
  const base = store.findByTitleId(REGION, '0400000000000002');
  assert.deepEqual(store.getDemosFor(REGION, base), []);
});
