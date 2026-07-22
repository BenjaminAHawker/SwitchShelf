const fs = require('fs');
const path = require('path');
const scanner = require('./scanner');
const store = require('./store');
const cnmts = require('./cnmts');
const decisions = require('./decisions');

// Filesystem-illegal characters (Windows-unsafe, also avoided on POSIX for
// portability), plus trademark symbols for cleaner names.
function sanitize(str, fallback) {
  const cleaned = String(str || '')
    .replace(/[™®©]/g, '')
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return cleaned || fallback;
}

function isInsideTitlesDir(fullPath) {
  const rel = path.relative(scanner.TITLES_DIR, fullPath);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// Builds the rename/move plan for every accepted Library Scan decision:
//  - base games and updates: "<Base Title> [<BaseTitleId>]/<Title> [<TitleId>][<version>]<ext>"
//  - DLC: "<Base Title> [<BaseTitleId>]/<Base Title> - <DLC Title> [<DlcTitleId>]<ext>"
// Nothing is moved here — this only computes where things would go.
function buildPlan(region) {
  const allDecisions = decisions.readAll();
  const plan = [];
  const skipped = [];
  const seenDestinations = new Map(); // destFull -> plan entry, to catch in-batch collisions

  for (const [filePath, decision] of Object.entries(allDecisions)) {
    if (decision.status !== 'accepted' || !decision.titleId) continue;

    const sourceFull = path.join(scanner.TITLES_DIR, filePath);
    if (!fs.existsSync(sourceFull)) {
      skipped.push({ path: filePath, reason: 'Source file no longer exists' });
      continue;
    }

    const { match, variantOptions } = store.resolveVariant(region, decision.titleId, decision.variant);
    if (!match || !match.name) {
      skipped.push({ path: filePath, reason: `No titledb match for ${decision.titleId} in ${region}` });
      continue;
    }

    const type = store.getContentType(match);
    let baseId = match.id;
    let baseTitle = match;
    if (type === 'dlc') {
      const resolvedBaseId = cnmts.getBaseId(match.id);
      if (resolvedBaseId) {
        baseId = resolvedBaseId;
        baseTitle = store.findByTitleId(region, resolvedBaseId) || match;
      }
    }

    const ext = path.extname(filePath);
    const baseName = sanitize(baseTitle.name, baseId);
    const folderName = `${baseName}[${baseId}]`;

    let fileName;
    if (type === 'dlc') {
      fileName = `${baseName} - ${sanitize(match.name, match.id)} [${match.id}]${ext}`;
    } else {
      const version = scanner.extractVersion(path.basename(filePath)) || '0';
      fileName = `${sanitize(match.name, match.id)} [${match.id}][${version}]${ext}`;
    }

    const newRelPath = path.join(folderName, fileName);
    const destFull = path.join(scanner.TITLES_DIR, newRelPath);

    if (!isInsideTitlesDir(destFull)) {
      skipped.push({ path: filePath, reason: 'Computed destination escapes the titles folder' });
      continue;
    }
    if (path.resolve(destFull) === path.resolve(sourceFull)) {
      continue; // already organized
    }
    if (fs.existsSync(destFull)) {
      skipped.push({ path: filePath, reason: `Destination already exists: ${newRelPath}` });
      continue;
    }
    if (seenDestinations.has(destFull)) {
      skipped.push({ path: filePath, reason: `Same destination as ${seenDestinations.get(destFull).path}: ${newRelPath}` });
      continue;
    }

    const entry = {
      path: filePath,
      from: filePath,
      to: newRelPath,
      folder: folderName,
      fileName,
      contentType: type,
      titleId: decision.titleId,
      titleName: match.name,
      variantOptions: variantOptions
        ? {
            switch: variantOptions.switch ? { id: variantOptions.switch.id, name: variantOptions.switch.name } : null,
            switch2: variantOptions.switch2 ? { id: variantOptions.switch2.id, name: variantOptions.switch2.name } : null,
          }
        : null,
      selectedVariant: variantOptions ? (match.isSwitch2 ? 'switch2' : 'switch') : null,
    };
    seenDestinations.set(destFull, entry);
    plan.push(entry);
  }

  return { plan, skipped };
}

// Applies a previously-shown plan for the given original relative paths only
// (never trusts client-supplied destinations — recomputes server-side).
function applyPlan(region, paths) {
  const { plan } = buildPlan(region);
  const wanted = new Set(paths);
  const moved = [];
  const errors = [];

  for (const item of plan) {
    if (!wanted.has(item.path)) continue;

    const sourceFull = path.join(scanner.TITLES_DIR, item.path);
    const destFull = path.join(scanner.TITLES_DIR, item.to);

    try {
      if (!isInsideTitlesDir(destFull)) throw new Error('Computed destination escapes the titles folder');
      if (fs.existsSync(destFull)) throw new Error('Destination already exists');
      fs.mkdirSync(path.dirname(destFull), { recursive: true });
      fs.renameSync(sourceFull, destFull);
      decisions.renameDecision(item.path, item.to);
      moved.push(item);
    } catch (err) {
      errors.push({ path: item.path, error: err.message });
    }
  }

  return { moved, errors };
}

module.exports = { buildPlan, applyPlan, sanitize };
