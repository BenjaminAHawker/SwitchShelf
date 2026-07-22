const cnmts = require('./cnmts');
const store = require('./store');
const decisions = require('./decisions');

// Builds the "DLC / Updates" list for a title: cnmts.json's known relations,
// merged with any version you've matched locally (via a manual version
// override in Library Scan / Staging) that titledb doesn't catalog as its
// own entry yet. Returns null if cnmts.json hasn't been synced.
function getExpansions(region, titleId) {
  const related = cnmts.getRelated(titleId);
  if (related === null) return null;

  const ownedIds = decisions.getAcceptedTitleIds();
  const baseId = String(titleId).toUpperCase();
  const acceptedVersions = new Set(decisions.getAcceptedVersionsForTitle(baseId).map(String));

  const results = related.map((r) => ({
    titleId: r.titleId,
    type: r.type,
    version: r.version,
    match: store.findByTitleId(region, r.titleId),
    // Updates share the base game's titleId on real hardware (only the version
    // differs), so a manually-set version override also counts as owning this
    // specific update — even once titledb assigns it its own catalog entry
    // (whose id you never directly matched a file to).
    owned: ownedIds.has(r.titleId.toUpperCase()) || (r.type === 'update' && acceptedVersions.has(String(r.version))),
    manual: false,
  }));

  // A manually-set version override that cnmts.json doesn't know about at all
  // yet still needs its own synthetic row so it's visible — e.g. "I have
  // v196608" shouldn't be invisible just because titledb only lists v131072.
  const knownVersions = new Set(results.filter((r) => r.type === 'update').map((r) => String(r.version)));
  for (const version of acceptedVersions) {
    if (knownVersions.has(version)) continue;
    results.push({
      titleId: baseId,
      type: 'update',
      version: Number(version),
      match: null,
      owned: true,
      manual: true,
    });
  }

  results.sort((a, b) => a.type.localeCompare(b.type) || a.titleId.localeCompare(b.titleId));

  return { titleId: baseId, results, ownedCount: results.filter((r) => r.owned).length };
}

module.exports = { getExpansions };
