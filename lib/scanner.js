const fs = require('fs');
const path = require('path');

const TITLES_DIR = process.env.TITLES_DIR || path.join(__dirname, '..', 'titles');
const STAGING_DIR = process.env.STAGING_DIR || path.join(__dirname, '..', 'staging');
const ALLOWED_EXT = new Set(['.nsp', '.nsz', '.xci', '.xcz']);
const TITLE_ID_RE = /\[([0-9A-Fa-f]{16})\]/;
const VERSION_RE = /\[v(\d+)\]/i;

function extractTitleId(fileName) {
  const match = fileName.match(TITLE_ID_RE);
  return match ? match[1].toUpperCase() : null;
}

function extractVersion(fileName) {
  const match = fileName.match(VERSION_RE);
  return match ? match[1] : null;
}

function walk(dir, results) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, results);
    } else if (entry.isFile() && ALLOWED_EXT.has(path.extname(entry.name).toLowerCase())) {
      results.push(fullPath);
    }
  }
}

function isConfigured() {
  return fs.existsSync(TITLES_DIR);
}

function isStagingConfigured() {
  return fs.existsSync(STAGING_DIR);
}

// Whether fullPath resolves to somewhere inside dir — used to keep any
// client-supplied relative path (organize plans, staging deletes) from
// escaping the folder it's supposed to be confined to.
function isInsideDir(dir, fullPath) {
  const rel = path.relative(dir, fullPath);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// Permanently deletes a single file from STAGING_DIR. relPath is relative to
// STAGING_DIR (as returned by scanStaging) — never trusted as an absolute or
// traversing path, and only files with a supported title extension can be
// removed this way (staging is a drop-off spot for title files, not a
// general-purpose file manager).
function deleteStagingFile(relPath) {
  const fullPath = path.join(STAGING_DIR, relPath);
  if (!isInsideDir(STAGING_DIR, fullPath)) {
    throw new Error('Path escapes the staging folder');
  }
  if (!ALLOWED_EXT.has(path.extname(fullPath).toLowerCase())) {
    throw new Error('Unsupported file type');
  }
  if (!fs.existsSync(fullPath)) {
    throw new Error('File not found');
  }
  fs.unlinkSync(fullPath);
}

function walkAll(dir, results) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkAll(fullPath, results);
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
}

// Diagnoses an empty scan result: is the folder missing, genuinely empty (e.g.
// a stale bind mount, or a *_HOST_DIR env var pointing at the wrong/fallback
// path), or does it have files but none with a supported extension?
function getDiagnosticsFor(dir, dirKey) {
  if (!fs.existsSync(dir)) {
    return { [dirKey]: dir, exists: false, totalFiles: 0, matchedFiles: 0 };
  }
  const all = [];
  walkAll(dir, all);
  const matched = all.filter((p) => ALLOWED_EXT.has(path.extname(p).toLowerCase()));
  return { [dirKey]: dir, exists: true, totalFiles: all.length, matchedFiles: matched.length };
}

function getDiagnostics() {
  return getDiagnosticsFor(TITLES_DIR, 'titlesDir');
}

function getStagingDiagnostics() {
  return getDiagnosticsFor(STAGING_DIR, 'stagingDir');
}

// Recursively lists files under dir, with title IDs extracted from bracketed
// hex tags in the filename (e.g. "Game [0100...000][v0].nsp").
function scanDir(dir) {
  const files = [];
  walk(dir, files);
  return files.map((fullPath) => {
    const relPath = path.relative(dir, fullPath);
    const fileName = path.basename(fullPath);
    const stat = fs.statSync(fullPath);
    return {
      path: relPath,
      fileName,
      size: stat.size,
      titleId: extractTitleId(fileName),
      version: extractVersion(fileName),
    };
  });
}

function scanLibrary() {
  if (!isConfigured()) {
    return [];
  }
  return scanDir(TITLES_DIR);
}

// Scans the Staging folder: a drop-off spot for new files, separate from the
// main library, that can be matched and accepted just like Library Scan, then
// moved (renamed) into TITLES_DIR via organize.applyStagingPlan.
function scanStaging() {
  if (!isStagingConfigured()) {
    return [];
  }
  return scanDir(STAGING_DIR);
}

module.exports = {
  TITLES_DIR,
  STAGING_DIR,
  isConfigured,
  isStagingConfigured,
  isInsideDir,
  scanLibrary,
  scanStaging,
  deleteStagingFile,
  getDiagnostics,
  getStagingDiagnostics,
  extractTitleId,
  extractVersion,
};
