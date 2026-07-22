const test = require('node:test');
const assert = require('node:assert/strict');
const { tempDir } = require('./helpers');

process.env.DATA_DIR = tempDir('stl-data-');

const decisions = require('../lib/decisions');

test('readAll returns an empty object when nothing has been decided yet', () => {
  assert.deepEqual(decisions.readAll(), {});
});

test('setDecision stores status, titleId, region and a null version by default', () => {
  const saved = decisions.setDecision('Game A.nsp', { status: 'accepted', titleId: '0100000000000001', region: 'US.en.json' });
  assert.equal(saved.status, 'accepted');
  assert.equal(saved.titleId, '0100000000000001');
  assert.equal(saved.region, 'US.en.json');
  assert.equal(saved.version, null);
  assert.ok(saved.decidedAt);
});

// Fixture decisions for the getAcceptedTitleIds test below.
test('setDecision accepts additional decisions for later id-lookup tests', () => {
  const b = decisions.setDecision('Game B.nsp', { status: 'accepted', titleId: '0100000000000002', region: 'US.en.json' });
  const c = decisions.setDecision('Game C.nsp', { status: 'accepted', titleId: '0100000000000003', region: 'US.en.json' });
  assert.equal(b.titleId, '0100000000000002');
  assert.equal(c.titleId, '0100000000000003');
});

test('setDecision preserves an existing version when the call omits it', () => {
  decisions.setDecision('Update A.nsp', { status: 'accepted', titleId: '0100000000000004', region: 'US.en.json', version: '65536' });
  const reAccepted = decisions.setDecision('Update A.nsp', { status: 'accepted', titleId: '0100000000000004', region: 'US.en.json' });
  assert.equal(reAccepted.version, '65536');
});

test('setDecision overwrites the version when one is explicitly provided, including clearing it with null', () => {
  decisions.setDecision('Update B.nsp', { status: 'accepted', titleId: '0100000000000005', region: 'US.en.json', version: '65536' });
  const updated = decisions.setDecision('Update B.nsp', { status: 'accepted', titleId: '0100000000000005', region: 'US.en.json', version: '131072' });
  assert.equal(updated.version, '131072');
  const cleared = decisions.setDecision('Update B.nsp', { status: 'accepted', titleId: '0100000000000005', region: 'US.en.json', version: null });
  assert.equal(cleared.version, null);
});

test('getAcceptedVersionsForTitle returns distinct manually-set versions accepted for a titleId', () => {
  decisions.setDecision('Update C v1.nsp', { status: 'accepted', titleId: '0100000000000006', region: 'US.en.json', version: '65536' });
  decisions.setDecision('Update C v2.nsp', { status: 'accepted', titleId: '0100000000000006', region: 'US.en.json', version: '196608' });
  // A duplicate version shouldn't produce a duplicate entry.
  decisions.setDecision('Update C v2 dup.nsp', { status: 'accepted', titleId: '0100000000000006', region: 'US.en.json', version: '196608' });
  // Rejected, or with no version override, shouldn't count.
  decisions.setDecision('Update C rejected.nsp', { status: 'rejected', titleId: '0100000000000006', region: 'US.en.json', version: '999999' });
  decisions.setDecision('Update C no override.nsp', { status: 'accepted', titleId: '0100000000000006', region: 'US.en.json' });

  const versions = decisions.getAcceptedVersionsForTitle('0100000000000006');
  assert.deepEqual([...versions].sort(), ['196608', '65536']);
  assert.deepEqual(decisions.getAcceptedVersionsForTitle('DEADBEEFDEADBEEF'), []);
});

test('getAcceptedTitleIds only counts accepted decisions with a titleId', () => {
  decisions.setDecision('Rejected.nsp', { status: 'rejected', titleId: '0100000000000099', region: 'US.en.json' });
  decisions.setDecision('NoId.nsp', { status: 'accepted', titleId: null, region: 'US.en.json' });

  const ids = decisions.getAcceptedTitleIds();
  assert.equal(ids.has('0100000000000001'), true);
  assert.equal(ids.has('0100000000000002'), true);
  assert.equal(ids.has('0100000000000003'), true);
  assert.equal(ids.has('0100000000000099'), false);
});

test('renameDecision re-keys a decision to a new path', () => {
  decisions.renameDecision('Game A.nsp', 'Organized/Game A [0100000000000001][0].nsp');
  const all = decisions.readAll();
  assert.equal(all['Game A.nsp'], undefined);
  assert.equal(all['Organized/Game A [0100000000000001][0].nsp'].titleId, '0100000000000001');
});

test('renameDecision is a no-op when the old path has no decision', () => {
  decisions.renameDecision('Nonexistent.nsp', 'Also Nonexistent.nsp');
  const all = decisions.readAll();
  assert.equal(all['Also Nonexistent.nsp'], undefined);
});

test('clearDecision removes a decision', () => {
  decisions.clearDecision('Game B.nsp');
  const all = decisions.readAll();
  assert.equal(all['Game B.nsp'], undefined);
});
