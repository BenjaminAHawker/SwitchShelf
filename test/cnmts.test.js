const test = require('node:test');
const assert = require('node:assert/strict');
const { tempDir, writeJSON } = require('./helpers');

process.env.DATA_DIR = tempDir('stl-data-');

const cnmts = require('../lib/cnmts');

const BASE_ID = '0100000000010000';
const UPDATE_ID = '0100000000010800';
const DLC_ID = '0100000000011001';

test('isDownloaded is false before cnmts.json exists', () => {
  assert.equal(cnmts.isDownloaded(), false);
  assert.equal(cnmts.getContentType(BASE_ID), null);
  assert.equal(cnmts.getRelated(BASE_ID), null);
});

test('cnmts relationships once the file is present', () => {
  writeJSON(process.env.DATA_DIR, 'cnmts.json', {
    [BASE_ID]: {
      0: { titleId: BASE_ID, titleType: 128, otherApplicationId: UPDATE_ID },
    },
    [UPDATE_ID]: {
      0: { titleId: UPDATE_ID, titleType: 129, otherApplicationId: BASE_ID },
      65536: { titleId: UPDATE_ID, titleType: 129, otherApplicationId: BASE_ID },
    },
    [DLC_ID]: {
      0: { titleId: DLC_ID, titleType: 130, otherApplicationId: BASE_ID },
    },
  });

  assert.equal(cnmts.isDownloaded(), true);
  assert.equal(cnmts.getContentType(BASE_ID), 'base');
  assert.equal(cnmts.getContentType(UPDATE_ID), 'update');
  assert.equal(cnmts.getContentType(DLC_ID), 'dlc');
  assert.equal(cnmts.getContentType('0100000000099999'), null);

  // lowercase input should still match (ids are normalized to uppercase internally)
  assert.equal(cnmts.getContentType(BASE_ID.toLowerCase()), 'base');

  const related = cnmts.getRelated(BASE_ID);
  const byId = Object.fromEntries(related.map((r) => [r.titleId, r]));
  assert.equal(byId[UPDATE_ID].type, 'update');
  assert.equal(byId[UPDATE_ID].version, 65536); // picks the highest version key
  assert.equal(byId[DLC_ID].type, 'dlc');

  assert.equal(cnmts.getBaseId(UPDATE_ID), BASE_ID);
  assert.equal(cnmts.getBaseId(DLC_ID), BASE_ID);
  assert.equal(cnmts.getBaseId(BASE_ID), null); // base games aren't anyone's child
});

test('invalidate clears the cache so a rewritten file is picked up', () => {
  writeJSON(process.env.DATA_DIR, 'cnmts.json', {
    [BASE_ID]: {
      0: { titleId: BASE_ID, titleType: 128, otherApplicationId: null },
    },
  });
  cnmts.invalidate();

  assert.deepEqual(cnmts.getRelated(BASE_ID), []);
  assert.equal(cnmts.getContentType(UPDATE_ID), null);
});
