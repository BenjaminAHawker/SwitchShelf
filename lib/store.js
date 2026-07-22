const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./sync');
const cnmts = require('./cnmts');
const decisions = require('./decisions');

// In-memory cache of loaded region files, keyed by file name.
const cache = new Map();

function isDownloaded(name) {
  return fs.existsSync(path.join(DATA_DIR, name));
}

function loadRegion(name) {
  if (cache.has(name)) {
    return cache.get(name);
  }
  const filePath = path.join(DATA_DIR, name);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);
  cache.set(name, data);
  return data;
}

function invalidate(name) {
  cache.delete(name);
}

// titledb has no explicit platform field. Switch 2 native titles use a distinct
// application ID prefix ("0400..." vs the original "0100..." space), and titles
// enhanced/upgraded for Switch 2 keep their original 0100 ID but say so in the name.
const SWITCH2_ID_PREFIX = '0400';
const SWITCH2_NAME_RE = /switch\s*2/i;

function isSwitch2(title) {
  if (title?.id && String(title.id).toUpperCase().startsWith(SWITCH2_ID_PREFIX)) {
    return true;
  }
  if (typeof title?.name === 'string' && SWITCH2_NAME_RE.test(title.name.replace(/[™®]/g, ''))) {
    return true;
  }
  return false;
}

// titledb's own isDemo flag is unreliable (e.g. official kiosk demos are often
// flagged isDemo:false), so also treat a standalone "demo" in the name as a signal.
const DEMO_WORD_RE = /\bdemo\b/i;

function isDemoTitle(title) {
  return title?.isDemo === true || DEMO_WORD_RE.test(title?.name || '');
}

// titledb's region files list base games, DLC, update editions, and demos as flat,
// identically-shaped sibling entries with no field distinguishing them. cnmts.json
// (titleType per titleId) is the authoritative source for DLC/updates when it has
// an answer. When it doesn't (not synced, or this id isn't in it), fall back to a
// heuristic: DLC/update-edition catalog entries are typically listed without their
// own icon, so treat iconless entries as DLC/updates too. null means genuinely
// unknown (assume base game).
function contentTypeOf(title) {
  if (isDemoTitle(title)) return 'demo';
  const cnmtsType = cnmts.isDownloaded() ? cnmts.getContentType(title.id) : null;
  if (cnmtsType) return cnmtsType;
  if (!title.iconUrl) return 'dlc';
  return null;
}

// Strips trademark symbols and collapses whitespace so demo/base names can be compared.
function normalizeForMatch(name) {
  return String(name || '')
    .replace(/[™®©]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// "Game Name Demo", "Game Name (Demo)", "Game Name | Demo", "Game Name DEMO VERSION",
// "Game Name Demo for KIOSK" all reduce to "Game Name" so they can be matched
// against the real base game's (also normalized) name.
function stripDemoSuffix(name) {
  const normalized = normalizeForMatch(name);
  const match = normalized.match(DEMO_WORD_RE);
  if (!match) return normalized;
  return normalized
    .slice(0, match.index)
    .replace(/[\s\-:|(]+$/, '')
    .trim();
}

// Builds (and caches) a normalized-base-name -> [demo titles] index per region,
// so a base game's details page can list the demos that belong to it. titledb has
// no structural link between a demo and its base game, so this is name-matching.
const demoIndexCache = new Map();

function buildDemoIndex(name) {
  let index = demoIndexCache.get(name);
  if (index) return index;

  const data = loadRegion(name);
  index = new Map();
  if (data) {
    for (const key of Object.keys(data)) {
      const title = data[key];
      if (!title.id || !title.name || !isDemoTitle(title)) continue;
      const baseName = stripDemoSuffix(title.name);
      if (!baseName) continue;
      if (!index.has(baseName)) index.set(baseName, []);
      index.get(baseName).push({ key, ...title });
    }
  }
  demoIndexCache.set(name, index);
  return index;
}

// Returns the demo entries whose stripped name matches this base title's name.
function getDemosFor(name, baseTitle) {
  if (!baseTitle?.name || isDemoTitle(baseTitle)) return [];
  const index = buildDemoIndex(name);
  return index.get(normalizeForMatch(baseTitle.name)) || [];
}

// Builds (and caches) the sorted list of language codes actually present across a
// region's catalog, so the UI can render a checkbox per language that's real for
// this region rather than a hardcoded/guessed list.
const languagesCache = new Map();

function getAvailableLanguages(name) {
  let langs = languagesCache.get(name);
  if (langs) return langs;

  const data = loadRegion(name);
  const set = new Set();
  if (data) {
    for (const key of Object.keys(data)) {
      const title = data[key];
      if (Array.isArray(title.languages)) {
        for (const lang of title.languages) set.add(lang);
      }
    }
  }
  langs = [...set].sort();
  languagesCache.set(name, langs);
  return langs;
}

// With an empty query, "search" instead browses the whole (platform-filtered)
// catalog, sorted by name, so the UI has something to show before you type.
// contentType: 'game' (default) excludes entries cnmts identifies as DLC/updates;
// 'all' shows everything, including DLC/updates, tagged with their contentType.
// owned: 'all' (default) shows everything; 'owned'/'missing' filter against titles
// accepted via Library Scan (a titleId is "owned" regardless of which region it
// was scanned/accepted in, since it's Nintendo's global content id).
// languages: [] (default) shows everything; otherwise a title must support at
// least one of the given language codes.
function search(name, query, { field = 'all', limit = 200, platform = 'all', contentType = 'game', owned = 'all', languages = [] } = {}) {
  const data = loadRegion(name);
  if (!data) {
    return null;
  }
  const q = String(query || '').trim().toLowerCase();
  const browseAll = !q;
  const ownedIds = decisions.getAcceptedTitleIds();
  const languageSet = languages.length ? new Set(languages) : null;

  const matches = [];
  for (const key of Object.keys(data)) {
    const title = data[key];
    if (!title.id) continue; // skip entries with no title ID

    if (browseAll) {
      if (!title.name) continue; // skip unnamed/placeholder entries when just browsing
    } else {
      const nameMatch =
        (field === 'all' || field === 'name') &&
        typeof title.name === 'string' &&
        title.name.toLowerCase().includes(q);
      const nsuIdMatch =
        (field === 'all' || field === 'nsuId') &&
        title.nsuId != null &&
        String(title.nsuId).includes(q);
      if (!nameMatch && !nsuIdMatch) continue;
    }

    const switch2 = isSwitch2(title);
    if (platform === 'switch' && switch2) continue;
    if (platform === 'switch2' && !switch2) continue;

    const type = contentTypeOf(title);
    if (contentType === 'game' && (type === 'dlc' || type === 'update' || type === 'demo')) continue;

    const isOwned = ownedIds.has(String(title.id).toUpperCase());
    if (owned === 'owned' && !isOwned) continue;
    if (owned === 'missing' && isOwned) continue;

    if (languageSet && !(Array.isArray(title.languages) && title.languages.some((l) => languageSet.has(l)))) continue;

    matches.push({ key, ...title, isSwitch2: switch2, contentType: type, owned: isOwned });
    if (!browseAll && matches.length >= limit) break;
  }

  if (browseAll) {
    matches.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  return { total: matches.length, results: matches.slice(0, limit) };
}

// Builds (and caches) a titleId ("id" field, e.g. "01007EF00011E000") -> [titles]
// lookup for a region, since region files are keyed by nsuId rather than titleId.
// titledb sometimes lists a game's original Switch release and its "Switch 2
// Edition" as two catalog entries sharing the same titleId (distinguished only
// by nsuId), so a titleId can legitimately resolve to more than one entry.
const idIndexCache = new Map();

function buildIdIndex(name) {
  let index = idIndexCache.get(name);
  if (index) return index;

  const data = loadRegion(name);
  index = new Map();
  if (data) {
    for (const key of Object.keys(data)) {
      const title = data[key];
      if (!title.id) continue;
      const id = String(title.id).toUpperCase();
      const entry = { key, ...title, isSwitch2: isSwitch2(title) };
      if (!index.has(id)) index.set(id, []);
      index.get(id).push(entry);
    }
    // Non-Switch2 entries first, so "the original release" is the default pick.
    for (const list of index.values()) {
      list.sort((a, b) => Number(a.isSwitch2) - Number(b.isSwitch2));
    }
  }
  idIndexCache.set(name, index);
  return index;
}

// Returns every catalog entry sharing this titleId (see note above), or [].
function findAllByTitleId(name, titleId) {
  const normalized = String(titleId || '').toUpperCase();
  if (!normalized) return [];
  return buildIdIndex(name).get(normalized) || [];
}

function findByTitleId(name, titleId) {
  return findAllByTitleId(name, titleId)[0] || null;
}

// Resolves which catalog entry to use for a titleId, accounting for the
// Switch/Switch2-Edition-share-an-id case. `variant` ('switch'|'switch2'|null)
// is the caller's saved preference, if any. Returns:
//   - match: the entry to use (or null if the titleId isn't in this region)
//   - variantOptions: null unless this id genuinely has both a Switch and a
//     Switch 2 Edition entry, in which case { switch, switch2 } (each an entry
//     or null) so the UI can offer a choice.
function resolveVariant(name, titleId, variant) {
  const candidates = findAllByTitleId(name, titleId);
  if (candidates.length === 0) {
    return { match: null, variantOptions: null };
  }

  const switchEntry = candidates.find((c) => !c.isSwitch2) || null;
  const switch2Entry = candidates.find((c) => c.isSwitch2) || null;
  const hasBoth = !!switchEntry && !!switch2Entry;
  const variantOptions = hasBoth ? { switch: switchEntry, switch2: switch2Entry } : null;

  let match = candidates[0];
  if (hasBoth) {
    if (variant === 'switch2') match = switch2Entry;
    else if (variant === 'switch') match = switchEntry;
    else match = switchEntry; // default to the original release
  }

  return { match, variantOptions };
}

function invalidateAll(name) {
  invalidate(name);
  idIndexCache.delete(name);
  demoIndexCache.delete(name);
  languagesCache.delete(name);
}

module.exports = {
  isDownloaded,
  loadRegion,
  invalidate,
  invalidateAll,
  search,
  findByTitleId,
  findAllByTitleId,
  resolveVariant,
  isSwitch2,
  getContentType: contentTypeOf,
  getDemosFor,
  getAvailableLanguages,
};
