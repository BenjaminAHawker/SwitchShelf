const fs = require('fs');
const path = require('path');

const TITLES_DIR = process.env.TITLES_DIR || path.join(__dirname, '..', 'titles');
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
// a stale bind mount, or TITLES_HOST_DIR pointing at the wrong/fallback path),
// or does it have files but none with a supported extension?
function getDiagnostics() {
  if (!isConfigured()) {
    return { titlesDir: TITLES_DIR, exists: false, totalFiles: 0, matchedFiles: 0 };
  }
  const all = [];
  walkAll(TITLES_DIR, all);
  const matched = all.filter((p) => ALLOWED_EXT.has(path.extname(p).toLowerCase()));
  return { titlesDir: TITLES_DIR, exists: true, totalFiles: all.length, matchedFiles: matched.length };
}

// Recursively lists library files under TITLES_DIR, with title IDs extracted from
// bracketed hex tags in the filename (e.g. "Game [0100...000][v0].nsp").
function scanLibrary() {
  if (!isConfigured()) {
    return [];
  }
  const files = [];
  walk(TITLES_DIR, files);
  return files.map((fullPath) => {
    const relPath = path.relative(TITLES_DIR, fullPath);
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

module.exports = { TITLES_DIR, isConfigured, scanLibrary, getDiagnostics, extractTitleId, extractVersion };
