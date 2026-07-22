const test = require('node:test');
const assert = require('node:assert/strict');
const { tempDir } = require('./helpers');

process.env.DATA_DIR = tempDir('stl-data-');

const decisions = require('../lib/decisions');

test('readAll returns an empty object when nothing has been decided yet', () => {
  assert.deepEqual(decisions.readAll(), {});
});

test('setDecision stores status, titleId, region and a null variant by default', () => {
  const saved = decisions.setDecision('Game A.nsp', { status: 'accepted', titleId: '0100000000000001', region: 'US.en.json' });
  assert.equal(saved.status, 'accepted');
  assert.equal(saved.titleId, '0100000000000001');
  assert.equal(saved.region, 'US.en.json');
  assert.equal(saved.variant, null);
  assert.ok(saved.decidedAt);
});

test('setDecision preserves an existing variant when the call omits it', () => {
  decisions.setDecision('Game B.nsp', { status: 'accepted', titleId: '0100000000000002', region: 'US.en.json', variant: 'switch2' });
  const reAccepted = decisions.setDecision('Game B.nsp', { status: 'accepted', titleId: '0100000000000002', region: 'US.en.json' });
  assert.equal(reAccepted.variant, 'switch2');
});

test('setDecision overwrites the variant when one is explicitly provided', () => {
  decisions.setDecision('Game C.nsp', { status: 'accepted', titleId: '0100000000000003', region: 'US.en.json', variant: 'switch2' });
  const updated = decisions.setDecision('Game C.nsp', { status: 'accepted', titleId: '0100000000000003', region: 'US.en.json', variant: 'switch' });
  assert.equal(updated.variant, 'switch');
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
