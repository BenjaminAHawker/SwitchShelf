const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./sync');

const FILE_NAME = 'cnmts.json';
const FILE_PATH = path.join(DATA_DIR, FILE_NAME);

// Nintendo Switch content meta types, per switchbrew.
const TITLE_TYPE = {
  APPLICATION: 128, // base game
  PATCH: 129, // update
  ADD_ON_CONTENT: 130, // DLC
};

const TYPE_LABEL = {
  [TITLE_TYPE.APPLICATION]: 'base',
  [TITLE_TYPE.PATCH]: 'update',
  [TITLE_TYPE.ADD_ON_CONTENT]: 'dlc',
};

let relationsCache = null; // Map<baseTitleId, Array<{titleId, type}>>
let typeCache = null; // Map<titleId, 'base' | 'update' | 'dlc'>
let baseOfCache = null; // Map<childTitleId, baseTitleId> (reverse of relations)

function isDownloaded() {
  return fs.existsSync(FILE_PATH);
}

function invalidate() {
  relationsCache = null;
  typeCache = null;
  baseOfCache = null;
}

// Single pass over cnmts.json building three indexes:
//  - relations: base titleId -> [{titleId, type}] of its updates/DLC (via otherApplicationId)
//  - types: titleId -> its own content type ('base' | 'update' | 'dlc')
//  - baseOf: update/DLC titleId -> its base game's titleId (reverse of relations)
// titledb's region files don't distinguish base games from DLC/updates on the
// entry itself, so this is the only source of truth for "what is this title?".
function load() {
  if (relationsCache && typeCache && baseOfCache) {
    return { relations: relationsCache, types: typeCache, baseOf: baseOfCache };
  }
  if (!isDownloaded()) {
    return null;
  }

  const raw = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
  const relations = new Map();
  const types = new Map();
  const baseOf = new Map();

  for (const titleId of Object.keys(raw)) {
    const versions = raw[titleId];
    const versionKeys = Object.keys(versions);
    if (versionKeys.length === 0) continue;
    const latestKey = versionKeys.reduce((max, k) => (Number(k) > Number(max) ? k : max));
    const entry = versions[latestKey];
    const { titleType, otherApplicationId } = entry;
    const upperId = titleId.toUpperCase();

    if (TYPE_LABEL[titleType]) {
      types.set(upperId, TYPE_LABEL[titleType]);
    }

    if (titleType === TITLE_TYPE.PATCH || titleType === TITLE_TYPE.ADD_ON_CONTENT) {
      if (!otherApplicationId) continue;
      const base = otherApplicationId.toUpperCase();
      if (!relations.has(base)) relations.set(base, []);
      relations.get(base).push({
        titleId: upperId,
        type: TYPE_LABEL[titleType],
        version: Number(latestKey),
      });
      baseOf.set(upperId, base);
    }
  }

  relationsCache = relations;
  typeCache = types;
  baseOfCache = baseOf;
  return { relations, types, baseOf };
}

// Returns [{titleId, type}] of updates/DLC for a base game titleId, or null if
// cnmts.json hasn't been synced yet.
function getRelated(baseTitleId) {
  const loaded = load();
  if (!loaded) {
    return null;
  }
  return loaded.relations.get(String(baseTitleId).toUpperCase()) || [];
}

// Returns 'base' | 'update' | 'dlc' for a titleId's own content type, or null if
// cnmts.json hasn't been synced yet, or the id isn't present in it.
function getContentType(titleId) {
  const loaded = load();
  if (!loaded) {
    return null;
  }
  return loaded.types.get(String(titleId).toUpperCase()) || null;
}

// Returns the base game's titleId for a given update/DLC titleId, or null if
// unknown (cnmts not synced, or this id has no recorded parent).
function getBaseId(titleId) {
  const loaded = load();
  if (!loaded) {
    return null;
  }
  return loaded.baseOf.get(String(titleId).toUpperCase()) || null;
}

module.exports = { isDownloaded, invalidate, getRelated, getContentType, getBaseId, TITLE_TYPE, TYPE_LABEL };
