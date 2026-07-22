const fs = require('fs');
const path = require('path');

const GITHUB_API = 'https://api.github.com/repos/blawar/titledb/contents';
const RAW_BASE = 'https://raw.githubusercontent.com/blawar/titledb/master';
const REGION_FILE_RE = /^[A-Z]{2}\.[a-z]{2}\.json$/;

// Non-region files we also know how to sync/download on demand.
const EXTRA_FILES = new Set(['cnmts.json']);

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

// Combines the remote listing with local sync state so the UI can show what's
// downloaded and what has updates available.
async function getRegionsStatus() {
  const [remote, meta] = await Promise.all([listRemoteRegionFiles(), Promise.resolve(readMeta())]);
  return remote.map((r) => {
    const local = meta[r.name];
    return {
      name: r.name,
      region: r.name.split('.')[0],
      language: r.name.split('.')[1],
      size: r.size,
      downloaded: !!local,
      stale: !!local && local.sha !== r.sha,
      syncedAt: local ? local.syncedAt : null,
    };
  });
}

// Same shape as getRegionsStatus but for the extra (non-region) files we support,
// e.g. cnmts.json which holds base game / update / DLC relationships.
async function getExtrasStatus() {
  const [all, meta] = await Promise.all([listRemoteFiles(), Promise.resolve(readMeta())]);
  return all
    .filter((e) => EXTRA_FILES.has(e.name))
    .map((e) => {
      const local = meta[e.name];
      return {
        name: e.name,
        size: e.size,
        downloaded: !!local,
        stale: !!local && local.sha !== e.sha,
        syncedAt: local ? local.syncedAt : null,
      };
    });
}

// Downloads a single file (region or extra) if it's missing or its sha changed upstream.
async function syncFile(name) {
  if (!REGION_FILE_RE.test(name) && !EXTRA_FILES.has(name)) {
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

  meta[name] = { sha: entry.sha, syncedAt: new Date().toISOString() };
  writeMeta(meta);

  return { name, updated: true, sha: entry.sha };
}

module.exports = {
  DATA_DIR,
  listRemoteRegionFiles,
  getRegionsStatus,
  getExtrasStatus,
  syncFile,
  syncRegion: syncFile,
};
