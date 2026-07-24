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
  70: { id: '0100000000010000', name: 'Base For DLC Test', nsuId: 70, iconUrl: 'icon70', languages: ['en', 'fr'], releaseDate: 20190101 },
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

test('findByTitleId / findAllByTitleId return null/[] for an unknown id', () => {
  assert.equal(store.findByTitleId(REGION, 'DEADBEEFDEADBEEF'), null);
  assert.deepEqual(store.findAllByTitleId(REGION, 'DEADBEEFDEADBEEF'), []);
});

// There's no way to dump/back up a Switch 2 game, so a titleId shared by a
// Switch release and a "Switch 2 Edition" listing must always resolve to the
// Switch entry — there's no toggle or preference to honor anymore.
test('findByTitleId always resolves a shared id to the Switch entry, never the Switch 2 Edition', () => {
  const match = store.findByTitleId(REGION, '0100000000000001');
  assert.equal(match.name, 'Test Game');
  assert.equal(match.isSwitch2, false);
});

test('findByTitleId still resolves a native Switch 2 title (no Switch sibling to prefer)', () => {
  const match = store.findByTitleId(REGION, '0400000000000002');
  assert.equal(match.name, 'Native Switch2 Game');
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

// Regression test: a scanned update file always resolves (by titleId) to its
// base game's own catalog entry — cnmts has no separate entry for "this is
// specifically an update" when matched this way — so Library Scan's "Proposed
// match" badge needs to infer "update" from the version, the same way
// organize.js's Type column already does.
test('displayContentType infers "update" from a non-zero version, but leaves dlc/demo/update alone', () => {
  const base = store.findByTitleId(REGION, '0100000000010000');
  const dlc = store.findByTitleId(REGION, '0100000000011001');
  const demo = store.findByTitleId(REGION, '0100000000012000');

  assert.equal(store.displayContentType(base, '0'), 'base');
  assert.equal(store.displayContentType(base, null), 'base');
  assert.equal(store.displayContentType(base, '131072'), 'update');
  assert.equal(store.displayContentType(dlc, '131072'), 'dlc'); // dlc is definitive, version is irrelevant
  assert.equal(store.displayContentType(demo, '131072'), 'demo');
  assert.equal(store.displayContentType(null, '131072'), null);
});

// Regression test: v0 must always read as "base", even for representations
// that aren't the exact string "0" — a strict string check would wrongly let
// these slip through as "update".
test('displayContentType treats every representation of zero as "base", not just the exact string "0"', () => {
  const base = store.findByTitleId(REGION, '0100000000010000');

  assert.equal(store.displayContentType(base, '00'), 'base');
  assert.equal(store.displayContentType(base, 0), 'base');
  assert.equal(store.displayContentType(base, ''), 'base');
  assert.equal(store.displayContentType(base, undefined), 'base');
});

test('search: browsing (empty query) defaults to games only, sorted by name, and excludes Switch 2 titles', () => {
  const { total, results } = store.search(REGION, '');
  const names = results.map((r) => r.name).sort();
  assert.deepEqual(names, [
    'Base For DLC Test',
    'Digimon Story Time Stranger',
    'Digimon Survive',
    'Test Game',
  ]);
  assert.equal(total, 4);
});

test('search: contentType "all" includes DLC and demos too, still excluding Switch 2 titles', () => {
  const { total } = store.search(REGION, '', { contentType: 'all' });
  assert.equal(total, 7); // everything with an id and a name, minus the 2 Switch 2 entries
});

// Regression test: there's no way to dump/back up a Switch 2 game, so neither
// a "Switch 2 Edition" listing nor a native Switch 2 exclusive should ever
// appear in search results, under any filter combination.
test('search: Switch 2 titles never appear in results, regardless of filters', () => {
  const names = new Set();
  for (const contentType of ['game', 'all']) {
    for (const owned of ['all', 'owned', 'missing']) {
      const { results } = store.search(REGION, '', { contentType, owned });
      for (const r of results) names.add(r.name);
    }
  }
  assert.equal(names.has('Native Switch2 Game'), false);
  assert.equal(names.has('Test Game – Nintendo Switch 2 Edition'), false);
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
  assert.equal(total, 1);
  assert.equal(results[0].name, 'Test Game');
});

test('search: text query with contentType "all" also returns the DLC and demo matches', () => {
  const { total, results } = store.search(REGION, 'Test Game', { contentType: 'all' });
  assert.equal(total, 3); // Test Game, DLC Pack, Demo — not the Switch 2 Edition
  const dlc = results.find((r) => r.name === 'Test Game DLC Pack');
  const demo = results.find((r) => r.name === 'Test Game Demo');
  assert.equal(dlc.contentType, 'dlc');
  assert.equal(demo.contentType, 'demo');
});

test('search: nsuId field matching', () => {
  const { results } = store.search(REGION, '10', { field: 'nsuId', contentType: 'all' });
  assert.ok(results.some((r) => r.nsuId === 10));
});

test('search: language filter (OR across selected codes)', () => {
  const { total, results } = store.search(REGION, '', { languages: ['fr'] });
  assert.equal(total, 1);
  assert.equal(results[0].name, 'Base For DLC Test'); // Native Switch2 Game also has 'fr' but is excluded entirely
});

test('getAvailableLanguages returns the sorted set actually used in the region', () => {
  assert.deepEqual(store.getAvailableLanguages(REGION), ['en', 'fr', 'ja']);
});

test('search: owned filter reflects accepted Library Scan decisions', () => {
  decisions.setDecision('some-file.nsp', { status: 'accepted', titleId: '0100000000000001', region: REGION });

  const owned = store.search(REGION, '', { owned: 'owned', contentType: 'all' });
  assert.equal(owned.total, 1);
  assert.equal(owned.results[0].name, 'Test Game');

  const missing = store.search(REGION, '', { owned: 'missing', contentType: 'all' });
  assert.equal(missing.total, 6);
  assert.ok(missing.results.every((r) => r.owned === false));

  decisions.clearDecision('some-file.nsp');
});

// Regression test: accepting a file for a titleId shared with a "Switch 2
// Edition" listing must never surface that listing at all (not even as an
// unowned row) — there's no way to dump/back up a Switch 2 game.
test('search: accepting a shared titleId never surfaces its Switch 2 Edition sibling', () => {
  decisions.setDecision('some-file.nsp', { status: 'accepted', titleId: '0100000000000001', region: REGION });

  const { results } = store.search(REGION, '', { contentType: 'all' });
  assert.equal(results.some((r) => r.name === 'Test Game – Nintendo Switch 2 Edition'), false);
  assert.equal(results.find((r) => r.name === 'Test Game').owned, true);

  decisions.clearDecision('some-file.nsp');
});

test('search: a native Switch 2 title never appears in results, even if somehow accepted', () => {
  decisions.setDecision('native-switch2.nsp', { status: 'accepted', titleId: '0400000000000002', region: REGION });

  const { results } = store.search(REGION, '', { owned: 'owned', contentType: 'all' });
  assert.equal(results.some((r) => r.name === 'Native Switch2 Game'), false);

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

// Regression test: titledb sometimes lists a bundle/collector's edition as a
// separate catalog entry sharing its plain edition's titleId (distinct nsuId,
// both with their own icon) — neither is a Switch 2 Edition, so the existing
// Switch2 dedup doesn't catch this. Only the lowest-nsuId (first-listed, i.e.
// plain) entry should ever show up.
test('search: a base game listed twice under the same titleId (e.g. a bundle edition) only appears once', () => {
  const DUPE_REGION = 'ZZ.en.json';
  writeJSON(dataDir, DUPE_REGION, {
    100: { id: '0100000000030000', name: 'Great Game', nsuId: 100, iconUrl: 'icon100', languages: ['en'], releaseDate: 20210101 },
    101: { id: '0100000000030000', name: 'Great Game Legendary Edition', nsuId: 101, iconUrl: 'icon101', languages: ['en'], releaseDate: 20210601 },
    102: { id: '0100000000031000', name: 'Another Game', nsuId: 102, iconUrl: 'icon102', languages: ['en'], releaseDate: 20220101 },
  });

  const { total, results } = store.search(DUPE_REGION, '');
  assert.equal(total, 2);
  const great = results.find((r) => r.id === '0100000000030000');
  assert.equal(great.name, 'Great Game'); // the lower-nsuId (plain) entry wins, not the bundle
});
