const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./sync');

const DECISIONS_PATH = path.join(DATA_DIR, 'match-decisions.json');

// Staging decisions share the same flat file as library decisions, distinguished
// only by a key prefix, so existing library-only installs need no migration.
const STAGING_PREFIX = 'staging:';

function keyFor(source, filePath) {
  return source === 'staging' ? STAGING_PREFIX + filePath : filePath;
}

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(DECISIONS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

// Returns just one source's decisions, keyed by plain (unprefixed) file path.
function readAllFor(source = 'library') {
  const all = readAll();
  const result = {};
  for (const [key, value] of Object.entries(all)) {
    if (source === 'staging') {
      if (key.startsWith(STAGING_PREFIX)) result[key.slice(STAGING_PREFIX.length)] = value;
    } else if (!key.startsWith(STAGING_PREFIX)) {
      result[key] = value;
    }
  }
  return result;
}

function writeAll(decisions) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DECISIONS_PATH, JSON.stringify(decisions, null, 2));
}

// status: 'accepted' | 'rejected'. titleId is the id the user confirmed the file
// matches (may differ from the auto-extracted one if they picked manually).
// version: string | null — overrides the version tag used when organizing a
// base/update file, for filenames that don't carry a "[vNNN]" tag of their
// own. Omit (undefined) to leave any existing override untouched; pass null
// explicitly to clear it back to the filename-derived one.
// source: 'library' (default, backward-compatible: unprefixed key) | 'staging'.
function setDecision(filePath, { status, titleId, region, version }, source = 'library') {
  const decisions = readAll();
  const key = keyFor(source, filePath);
  const previous = decisions[key];
  decisions[key] = {
    status,
    titleId: titleId || null,
    region: region || null,
    version: version !== undefined ? version : previous?.version ?? null,
    decidedAt: new Date().toISOString(),
  };
  writeAll(decisions);
  return decisions[key];
}

function clearDecision(filePath, source = 'library') {
  const decisions = readAll();
  delete decisions[keyFor(source, filePath)];
  writeAll(decisions);
}

// Re-keys a decision after its file has been moved/renamed on disk within the
// same source (e.g. by Organize Library), so future scans keep tracking it
// under the new path.
function renameDecision(oldPath, newPath, source = 'library') {
  const decisions = readAll();
  const oldKey = keyFor(source, oldPath);
  if (!decisions[oldKey]) return;
  decisions[keyFor(source, newPath)] = decisions[oldKey];
  delete decisions[oldKey];
  writeAll(decisions);
}

// Re-keys a decision from the staging namespace into the library namespace,
// used once a staged file has been physically moved into TITLES_DIR.
function moveToLibrary(stagingPath, newLibraryPath) {
  const decisions = readAll();
  const key = keyFor('staging', stagingPath);
  const entry = decisions[key];
  if (!entry) return;
  delete decisions[key];
  decisions[newLibraryPath] = entry;
  writeAll(decisions);
}

// titleId is Nintendo's global content id (same value across every region's
// catalog file), so "owned" isn't scoped to whichever region you scanned in.
function getAcceptedTitleIds() {
  const decisions = readAll();
  const ids = new Set();
  for (const decision of Object.values(decisions)) {
    if (decision.status === 'accepted' && decision.titleId) {
      ids.add(String(decision.titleId).toUpperCase());
    }
  }
  return ids;
}

// Distinct non-zero versions accepted for a titleId (library or staging),
// e.g. an update version the user has that cnmts.json doesn't know about
// yet. v0 is always the base install, never an update, so it's excluded here
// even though it's a legitimate saved version (accepting a plain base game
// file saves its v0 too) — callers use this set to identify updates.
function getAcceptedVersionsForTitle(titleId) {
  const target = String(titleId || '').toUpperCase();
  if (!target) return [];
  const decisions = readAll();
  const versions = new Set();
  for (const decision of Object.values(decisions)) {
    if (decision.status !== 'accepted' || !decision.version) continue;
    if (Number(decision.version) <= 0) continue;
    if (String(decision.titleId || '').toUpperCase() !== target) continue;
    versions.add(decision.version);
  }
  return [...versions];
}

module.exports = {
  readAll,
  readAllFor,
  setDecision,
  clearDecision,
  renameDecision,
  moveToLibrary,
  getAcceptedTitleIds,
  getAcceptedVersionsForTitle,
};
