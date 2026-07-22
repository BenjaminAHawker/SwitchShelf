const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./sync');

const DECISIONS_PATH = path.join(DATA_DIR, 'match-decisions.json');

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(DECISIONS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeAll(decisions) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DECISIONS_PATH, JSON.stringify(decisions, null, 2));
}

// status: 'accepted' | 'rejected'. titleId is the id the user confirmed the file
// matches (may differ from the auto-extracted one if they picked manually).
// variant: 'switch' | 'switch2' | null — which catalog entry to use when a
// titleId resolves to more than one (a title's original release and its
// "Switch 2 Edition" sharing the same id). Omit to leave any existing choice
// untouched (e.g. when accept/reject calls this without knowing about variants).
function setDecision(filePath, { status, titleId, region, variant }) {
  const decisions = readAll();
  const previous = decisions[filePath];
  decisions[filePath] = {
    status,
    titleId: titleId || null,
    region: region || null,
    variant: variant !== undefined ? variant : previous?.variant ?? null,
    decidedAt: new Date().toISOString(),
  };
  writeAll(decisions);
  return decisions[filePath];
}

function clearDecision(filePath) {
  const decisions = readAll();
  delete decisions[filePath];
  writeAll(decisions);
}

// Re-keys a decision after its file has been moved/renamed on disk (e.g. by
// Organize Library), so future scans keep tracking it under the new path.
function renameDecision(oldPath, newPath) {
  const decisions = readAll();
  if (!decisions[oldPath]) return;
  decisions[newPath] = decisions[oldPath];
  delete decisions[oldPath];
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

module.exports = { readAll, setDecision, clearDecision, renameDecision, getAcceptedTitleIds };
