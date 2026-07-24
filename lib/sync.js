const fs = require('fs');
const path = require('path');

const GITHUB_API = 'https://api.github.com/repos/blawar/titledb/contents';
const RAW_BASE = 'https://raw.githubusercontent.com/blawar/titledb/master';
const REGION_FILE_RE = /^[A-Z]{2}\.[a-z]{2}\.json$/;

// Non-region files we also know how to sync/download on demand.
const EXTRA_FILES = new Set(['cnmts.json']);

// Whether `name` is a data file we recognize (a region file or an extra like
// cnmts.json). Used to keep any filename that reaches the filesystem — sync
// or read side alike — confined to DATA_DIR, since these names ultimately
// come from request params.
function isValidFileName(name) {
  return REGION_FILE_RE.test(name) || EXTRA_FILES.has(name);
}

// A snapshot of blawar/titledb's actual region file listing, bundled so the
// region picker (and the Upload flow below) still has something to work
// with if GitHub — or the titledb repo itself — is ever unreachable. Not
// guaranteed to stay perfectly in sync with upstream forever, but titledb's
// region list has been stable for a long time; getRegionsStatus() only ever
// falls back to this when it can't reach GitHub at all.
const FALLBACK_REGIONS = [
  { name: 'AR.en.json', region: 'AR', language: 'en' },
  { name: 'AR.es.json', region: 'AR', language: 'es' },
  { name: 'AT.de.json', region: 'AT', language: 'de' },
  { name: 'AU.en.json', region: 'AU', language: 'en' },
  { name: 'BE.fr.json', region: 'BE', language: 'fr' },
  { name: 'BE.nl.json', region: 'BE', language: 'nl' },
  { name: 'BG.en.json', region: 'BG', language: 'en' },
  { name: 'BR.en.json', region: 'BR', language: 'en' },
  { name: 'BR.pt.json', region: 'BR', language: 'pt' },
  { name: 'CA.en.json', region: 'CA', language: 'en' },
  { name: 'CA.fr.json', region: 'CA', language: 'fr' },
  { name: 'CH.de.json', region: 'CH', language: 'de' },
  { name: 'CH.fr.json', region: 'CH', language: 'fr' },
  { name: 'CH.it.json', region: 'CH', language: 'it' },
  { name: 'CL.en.json', region: 'CL', language: 'en' },
  { name: 'CL.es.json', region: 'CL', language: 'es' },
  { name: 'CN.en.json', region: 'CN', language: 'en' },
  { name: 'CN.zh.json', region: 'CN', language: 'zh' },
  { name: 'CO.en.json', region: 'CO', language: 'en' },
  { name: 'CO.es.json', region: 'CO', language: 'es' },
  { name: 'CY.en.json', region: 'CY', language: 'en' },
  { name: 'CZ.en.json', region: 'CZ', language: 'en' },
  { name: 'DE.de.json', region: 'DE', language: 'de' },
  { name: 'DK.en.json', region: 'DK', language: 'en' },
  { name: 'EE.en.json', region: 'EE', language: 'en' },
  { name: 'ES.es.json', region: 'ES', language: 'es' },
  { name: 'FI.en.json', region: 'FI', language: 'en' },
  { name: 'FR.fr.json', region: 'FR', language: 'fr' },
  { name: 'GB.en.json', region: 'GB', language: 'en' },
  { name: 'GR.en.json', region: 'GR', language: 'en' },
  { name: 'HK.zh.json', region: 'HK', language: 'zh' },
  { name: 'HR.en.json', region: 'HR', language: 'en' },
  { name: 'HU.en.json', region: 'HU', language: 'en' },
  { name: 'IE.en.json', region: 'IE', language: 'en' },
  { name: 'IL.en.json', region: 'IL', language: 'en' },
  { name: 'IT.it.json', region: 'IT', language: 'it' },
  { name: 'JP.en.json', region: 'JP', language: 'en' },
  { name: 'JP.ja.json', region: 'JP', language: 'ja' },
  { name: 'KR.ko.json', region: 'KR', language: 'ko' },
  { name: 'LT.en.json', region: 'LT', language: 'en' },
  { name: 'LU.de.json', region: 'LU', language: 'de' },
  { name: 'LU.fr.json', region: 'LU', language: 'fr' },
  { name: 'LV.en.json', region: 'LV', language: 'en' },
  { name: 'MT.en.json', region: 'MT', language: 'en' },
  { name: 'MX.en.json', region: 'MX', language: 'en' },
  { name: 'MX.es.json', region: 'MX', language: 'es' },
  { name: 'NL.nl.json', region: 'NL', language: 'nl' },
  { name: 'NO.en.json', region: 'NO', language: 'en' },
  { name: 'NZ.en.json', region: 'NZ', language: 'en' },
  { name: 'PE.en.json', region: 'PE', language: 'en' },
  { name: 'PE.es.json', region: 'PE', language: 'es' },
  { name: 'PL.en.json', region: 'PL', language: 'en' },
  { name: 'PT.pt.json', region: 'PT', language: 'pt' },
  { name: 'RO.en.json', region: 'RO', language: 'en' },
  { name: 'RU.ru.json', region: 'RU', language: 'ru' },
  { name: 'SE.en.json', region: 'SE', language: 'en' },
  { name: 'SI.en.json', region: 'SI', language: 'en' },
  { name: 'SK.en.json', region: 'SK', language: 'en' },
  { name: 'US.en.json', region: 'US', language: 'en' },
  { name: 'US.es.json', region: 'US', language: 'es' },
  { name: 'ZA.en.json', region: 'ZA', language: 'en' },
];

// Overridable so tests can point this at an isolated temp directory.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const META_PATH = path.join(DATA_DIR, 'meta.json');

function readMeta() {
  try {
    return JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeMeta(meta) {
  fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2));
}

function ghHeaders() {
  const headers = { 'User-Agent': 'SwitchShelf' };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

// Lists every file in the repo root, with its current blob sha.
async function listRemoteFiles() {
  const res = await fetch(GITHUB_API, { headers: ghHeaders() });
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
  }
  const entries = await res.json();
  return entries
    .filter((e) => e.type === 'file')
    .map((e) => ({ name: e.name, sha: e.sha, size: e.size }));
}

async function listRemoteRegionFiles() {
  const all = await listRemoteFiles();
  return all
    .filter((e) => REGION_FILE_RE.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Shared shape-building for both the remote-derived listing (which has a
// sha/size from GitHub) and the bundled fallback listing (which doesn't —
// entry.sha is undefined there, so "stale" is left false rather than guessed).
function toFileStatus(entry, meta) {
  const local = meta[entry.name];
  return {
    name: entry.name,
    region: entry.region ?? entry.name.split('.')[0],
    language: entry.language ?? entry.name.split('.')[1],
    size: entry.size ?? null,
    downloaded: !!local,
    stale: !!local && entry.sha !== undefined && local.sha !== entry.sha,
    syncedAt: local ? local.syncedAt : null,
    source: local?.source || null, // 'sync' | 'upload' | null
  };
}

// Combines the remote (or, offline, the bundled fallback) listing with local
// sync state so the UI can show what's downloaded and what has updates
// available. Falls back to a bundled snapshot of the region list if GitHub
// (or blawar/titledb itself) is unreachable, so already-synced/uploaded
// regions and the Upload flow keep working offline — `source` tells the
// caller which case it got. Either way, any region file meta.json knows
// about that isn't in that base list (an uploaded region titledb doesn't
// have yet, or added since this snapshot was taken) is folded in too, so a
// successful upload is never invisible.
async function getRegionsStatus() {
  const meta = readMeta();
  let source = 'remote';
  let base;
  try {
    base = await listRemoteRegionFiles();
  } catch {
    source = 'fallback';
    base = FALLBACK_REGIONS;
  }

  const known = new Set(base.map((r) => r.name));
  const local = Object.keys(meta)
    .filter((name) => REGION_FILE_RE.test(name) && !known.has(name))
    .map((name) => ({ name }));

  return { source, regions: [...base, ...local].map((r) => toFileStatus(r, meta)) };
}

// Same shape as getRegionsStatus but for the extra (non-region) files we support,
// e.g. cnmts.json which holds base game / update / DLC relationships.
async function getExtrasStatus() {
  const meta = readMeta();
  try {
    const all = await listRemoteFiles();
    return { source: 'remote', extras: all.filter((e) => EXTRA_FILES.has(e.name)).map((e) => toFileStatus(e, meta)) };
  } catch {
    return { source: 'fallback', extras: [...EXTRA_FILES].map((name) => toFileStatus({ name }, meta)) };
  }
}

// Downloads a single file (region or extra) if it's missing or its sha changed upstream.
async function syncFile(name) {
  if (!isValidFileName(name)) {
    throw new Error(`Unsupported file name: ${name}`);
  }
  const remote = await listRemoteFiles();
  const entry = remote.find((r) => r.name === name);
  if (!entry) {
    throw new Error(`Unknown file: ${name}`);
  }

  const meta = readMeta();
  const local = meta[name];
  if (local && local.sha === entry.sha) {
    return { name, updated: false, sha: entry.sha };
  }

  const res = await fetch(`${RAW_BASE}/${name}`, { headers: ghHeaders() });
  if (!res.ok) {
    throw new Error(`Failed to download ${name}: ${res.status}`);
  }
  const body = await res.text();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, name), body);

  meta[name] = { sha: entry.sha, syncedAt: new Date().toISOString(), source: 'sync' };
  writeMeta(meta);

  return { name, updated: true, sha: entry.sha };
}

// Whether fullPath resolves to somewhere inside dir — a second, independent
// check (on top of isValidFileName's allow-list regex) that the destination
// this is about to write to can never resolve outside DATA_DIR.
function isInsideDir(dir, fullPath) {
  const rel = path.relative(dir, fullPath);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// Renames within a volume; falls back to copy+delete across volumes/mounts
// (the upload route's temp dir and DATA_DIR can be separate Docker volumes).
// dest must already be verified to resolve inside DATA_DIR by the caller —
// this has no route/user-facing caller of its own and does no path
// validation itself.
function moveFileAcrossVolumes(src, dest) {
  try {
    fs.renameSync(src, dest);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.copyFileSync(src, dest);
    fs.unlinkSync(src);
  }
}

// Accepts a manually-provided file (already saved to tempPath by the upload
// route) as a stand-in for a titledb sync — the fallback for when GitHub, or
// blawar/titledb itself, is unreachable. Validates it's at least parseable
// JSON before it can replace any existing good data, then files it exactly
// like a normal sync (so search/scan/etc. all just see another region file).
function applyUpload(name, tempPath) {
  if (!isValidFileName(name)) {
    throw new Error(`Unsupported file name: ${name}`);
  }
  const destPath = path.join(DATA_DIR, name);
  if (!isInsideDir(DATA_DIR, destPath)) {
    throw new Error(`Unsupported file name: ${name}`);
  }
  try {
    JSON.parse(fs.readFileSync(tempPath, 'utf8'));
  } catch {
    throw new Error('Uploaded file is not valid JSON');
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  moveFileAcrossVolumes(tempPath, destPath);

  const meta = readMeta();
  meta[name] = { syncedAt: new Date().toISOString(), source: 'upload' };
  writeMeta(meta);
}

module.exports = {
  DATA_DIR,
  isValidFileName,
  listRemoteRegionFiles,
  getRegionsStatus,
  getExtrasStatus,
  syncFile,
  syncRegion: syncFile,
  applyUpload,
};
