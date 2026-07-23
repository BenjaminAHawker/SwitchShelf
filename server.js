const express = require('express');
const path = require('path');
const sync = require('./lib/sync');
const store = require('./lib/store');
const scanner = require('./lib/scanner');
const decisions = require('./lib/decisions');
const cnmts = require('./lib/cnmts');
const organize = require('./lib/organize');
const expand = require('./lib/expand');

const app = express();
const PORT = process.env.PORT || 3000;
const STAGING_ENABLED = String(process.env.STAGING_ENABLED).toLowerCase() === 'true';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Lets the frontend know which optional features are turned on, e.g. to hide
// the Staging nav link/page entirely when it's disabled.
app.get('/api/config', (req, res) => {
  res.json({ stagingEnabled: STAGING_ENABLED });
});

// Applied to every /api/staging/* route below, so the feature is fully off
// (not just hidden in the UI) unless explicitly enabled.
app.use('/api/staging', (req, res, next) => {
  if (!STAGING_ENABLED) {
    return res.status(404).json({ error: 'Staging is disabled. Set STAGING_ENABLED=true to enable it.' });
  }
  next();
});

app.get('/api/regions', async (req, res) => {
  try {
    const regions = await sync.getRegionsStatus();
    res.json(regions);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/extras', async (req, res) => {
  try {
    const extras = await sync.getExtrasStatus();
    res.json(extras);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post('/api/sync', async (req, res) => {
  const { region } = req.body || {};
  if (!region) {
    return res.status(400).json({ error: 'region is required, e.g. "US.en.json" or "cnmts.json"' });
  }
  try {
    const result = await sync.syncFile(region);
    if (result.updated) {
      if (region === 'cnmts.json') {
        cnmts.invalidate();
      } else {
        store.invalidateAll(region);
      }
    }
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/languages', (req, res) => {
  const { region } = req.query;
  if (!region) {
    return res.status(400).json({ error: 'region query param is required' });
  }
  if (!store.isDownloaded(region)) {
    return res.status(409).json({ error: `${region} has not been downloaded yet. POST /api/sync first.` });
  }
  res.json({ region, languages: store.getAvailableLanguages(region) });
});

app.get('/api/search', (req, res) => {
  const { region, q, field, contentType, owned, languages, sort } = req.query;
  if (!region) {
    return res.status(400).json({ error: 'region query param is required' });
  }
  if (!store.isDownloaded(region)) {
    return res.status(409).json({ error: `${region} has not been downloaded yet. POST /api/sync first.` });
  }
  const { total, results } = store.search(region, q, {
    field: field || 'all',
    contentType: contentType || 'game',
    owned: owned || 'all',
    languages: languages ? languages.split(',').filter(Boolean) : [],
    sort: sort || 'name-asc',
  });
  const cnmtsReady = cnmts.isDownloaded();
  const withExpansions = results.map((title) => ({
    ...title,
    hasExpansions: cnmtsReady ? cnmts.getRelated(title.id).length > 0 : null,
  }));
  res.json({ region, query: q || '', total, count: withExpansions.length, results: withExpansions });
});

app.get('/api/title', (req, res) => {
  const { region, titleId } = req.query;
  if (!region || !titleId) {
    return res.status(400).json({ error: 'region and titleId query params are required' });
  }
  if (!store.isDownloaded(region)) {
    return res.status(409).json({ error: `${region} has not been downloaded yet. POST /api/sync first.` });
  }

  const title = store.findByTitleId(region, titleId);
  // findByTitleId prefers a Switch sibling when one exists, but a titleId with
  // no Switch release at all (a native Switch 2 exclusive) can still resolve
  // straight to a Switch 2 entry — there's no way to dump/back up a Switch 2
  // game, so treat that the same as not found.
  if (!title || store.isSwitch2(title)) {
    return res.status(404).json({ error: `No title with id ${titleId} found in ${region}` });
  }

  res.json({
    region,
    title: {
      ...title,
      contentType: store.getContentType(title),
      owned: store.isOwned(region, title),
    },
    hasExpansions: cnmts.isDownloaded() ? cnmts.getRelated(title.id).length > 0 : null,
    demos: store.getDemosFor(region, title).map((d) => ({
      titleId: d.id,
      name: d.name,
      iconUrl: d.iconUrl,
      nsuId: d.nsuId,
    })),
  });
});

app.get('/api/expand', (req, res) => {
  const { region, titleId } = req.query;
  if (!region || !titleId) {
    return res.status(400).json({ error: 'region and titleId query params are required' });
  }
  if (!store.isDownloaded(region)) {
    return res.status(409).json({ error: `${region} has not been downloaded yet. POST /api/sync first.` });
  }
  if (!cnmts.isDownloaded()) {
    return res.status(409).json({ error: 'cnmts.json has not been downloaded yet. POST /api/sync with region "cnmts.json" first.' });
  }

  const { titleId: normalizedId, results, ownedCount } = expand.getExpansions(region, titleId);
  res.json({
    region,
    titleId: normalizedId,
    count: results.length,
    ownedCount,
    results,
  });
});

app.get('/api/library/scan', (req, res) => {
  const { region } = req.query;
  if (!region) {
    return res.status(400).json({ error: 'region query param is required' });
  }
  if (!scanner.isConfigured()) {
    return res.status(409).json({ error: 'No title folder mounted. Set TITLES_DIR / the titles volume in docker-compose.yml.' });
  }
  if (!store.isDownloaded(region)) {
    return res.status(409).json({ error: `${region} has not been downloaded yet. POST /api/sync first.` });
  }

  const files = scanner.scanLibrary();
  const saved = decisions.readAll();

  const results = files.map((file) => {
    const decision = saved[file.path];
    const lookupId = decision?.titleId || file.titleId;
    const match = lookupId ? store.findByTitleId(region, lookupId) : null;
    const version = decision?.version || file.version || '0';
    return {
      ...file,
      match: match ? { ...match, contentType: store.displayContentType(match, version) } : null,
      versionOverride: decision?.version || null,
      status: decision ? decision.status : 'pending',
      decidedTitleId: decision?.titleId || null,
    };
  });

  results.sort((a, b) => {
    const order = { pending: 0, accepted: 1, rejected: 2 };
    return order[a.status] - order[b.status] || a.fileName.localeCompare(b.fileName);
  });

  let hint = null;
  if (results.length === 0) {
    const diag = scanner.getDiagnostics();
    if (diag.totalFiles === 0) {
      hint = `No files found in ${diag.titlesDir} inside the container. If you set/changed TITLES_HOST_DIR in .env, make sure the container was rebuilt/restarted afterward (docker compose up -d --build), and that the path actually contains your titles on the host.`;
    } else if (diag.matchedFiles === 0) {
      hint = `Found ${diag.totalFiles} file(s) in ${diag.titlesDir}, but none have a supported extension (.nsp, .nsz, .xci, .xcz).`;
    }
  }

  res.json({
    titlesDir: scanner.TITLES_DIR,
    region,
    count: results.length,
    results,
    hint,
  });
});

app.get('/api/staging/scan', (req, res) => {
  const { region } = req.query;
  if (!region) {
    return res.status(400).json({ error: 'region query param is required' });
  }
  if (!scanner.isStagingConfigured()) {
    return res.status(409).json({ error: 'No staging folder mounted. Set STAGING_DIR / the staging volume in docker-compose.yml.' });
  }
  if (!store.isDownloaded(region)) {
    return res.status(409).json({ error: `${region} has not been downloaded yet. POST /api/sync first.` });
  }

  const files = scanner.scanStaging();
  const saved = decisions.readAllFor('staging');

  const results = files.map((file) => {
    const decision = saved[file.path];
    const lookupId = decision?.titleId || file.titleId;
    const match = lookupId ? store.findByTitleId(region, lookupId) : null;
    const version = decision?.version || file.version || '0';
    return {
      ...file,
      match: match ? { ...match, contentType: store.displayContentType(match, version) } : null,
      versionOverride: decision?.version || null,
      status: decision ? decision.status : 'pending',
      decidedTitleId: decision?.titleId || null,
    };
  });

  results.sort((a, b) => {
    const order = { pending: 0, accepted: 1, rejected: 2 };
    return order[a.status] - order[b.status] || a.fileName.localeCompare(b.fileName);
  });

  let hint = null;
  if (results.length === 0) {
    const diag = scanner.getStagingDiagnostics();
    if (diag.totalFiles === 0) {
      hint = `No files found in ${diag.stagingDir} inside the container. If you set/changed STAGING_HOST_DIR in .env, make sure the container was rebuilt/restarted afterward (docker compose up -d --build), and that the path actually contains files on the host.`;
    } else if (diag.matchedFiles === 0) {
      hint = `Found ${diag.totalFiles} file(s) in ${diag.stagingDir}, but none have a supported extension (.nsp, .nsz, .xci, .xcz).`;
    }
  }

  res.json({
    stagingDir: scanner.STAGING_DIR,
    region,
    count: results.length,
    results,
    hint,
  });
});

app.post('/api/staging/decision', (req, res) => {
  const { path: filePath, status, titleId, region, version } = req.body || {};
  if (!filePath || !status) {
    return res.status(400).json({ error: 'path and status are required' });
  }
  if (!['accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'status must be "accepted" or "rejected"' });
  }
  if (version !== undefined && version !== null && !/^\d+$/.test(version)) {
    return res.status(400).json({ error: 'version must be a non-negative integer, or null' });
  }
  const saved = decisions.setDecision(filePath, { status, titleId, region, version }, 'staging');
  res.json({ path: filePath, ...saved });
});

app.delete('/api/staging/decision', (req, res) => {
  const { path: filePath } = req.body || {};
  if (!filePath) {
    return res.status(400).json({ error: 'path is required' });
  }
  decisions.clearDecision(filePath, 'staging');
  res.json({ path: filePath, cleared: true });
});

app.get('/api/staging/organize/plan', (req, res) => {
  const { region } = req.query;
  if (!region) {
    return res.status(400).json({ error: 'region query param is required' });
  }
  if (!scanner.isStagingConfigured()) {
    return res.status(409).json({ error: 'No staging folder mounted. Set STAGING_DIR / the staging volume in docker-compose.yml.' });
  }
  if (!scanner.isConfigured()) {
    return res.status(409).json({ error: 'No title folder mounted. Set TITLES_DIR / the titles volume in docker-compose.yml.' });
  }
  if (!store.isDownloaded(region)) {
    return res.status(409).json({ error: `${region} has not been downloaded yet. POST /api/sync first.` });
  }
  const { plan, skipped } = organize.buildStagingPlan(region);
  res.json({ stagingDir: scanner.STAGING_DIR, titlesDir: scanner.TITLES_DIR, count: plan.length, plan, skippedCount: skipped.length, skipped });
});

app.post('/api/staging/organize/apply', (req, res) => {
  const { region, paths } = req.body || {};
  if (!region || !Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: 'region and a non-empty paths array are required' });
  }
  if (!scanner.isStagingConfigured()) {
    return res.status(409).json({ error: 'No staging folder mounted. Set STAGING_DIR / the staging volume in docker-compose.yml.' });
  }
  if (!scanner.isConfigured()) {
    return res.status(409).json({ error: 'No title folder mounted. Set TITLES_DIR / the titles volume in docker-compose.yml.' });
  }
  if (!store.isDownloaded(region)) {
    return res.status(409).json({ error: `${region} has not been downloaded yet. POST /api/sync first.` });
  }
  const { moved, errors } = organize.applyStagingPlan(region, paths);
  res.json({ movedCount: moved.length, moved, errorCount: errors.length, errors });
});

app.post('/api/library/decision', (req, res) => {
  const { path: filePath, status, titleId, region, version } = req.body || {};
  if (!filePath || !status) {
    return res.status(400).json({ error: 'path and status are required' });
  }
  if (!['accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'status must be "accepted" or "rejected"' });
  }
  if (version !== undefined && version !== null && !/^\d+$/.test(version)) {
    return res.status(400).json({ error: 'version must be a non-negative integer, or null' });
  }
  const saved = decisions.setDecision(filePath, { status, titleId, region, version });
  res.json({ path: filePath, ...saved });
});

app.delete('/api/library/decision', (req, res) => {
  const { path: filePath } = req.body || {};
  if (!filePath) {
    return res.status(400).json({ error: 'path is required' });
  }
  decisions.clearDecision(filePath);
  res.json({ path: filePath, cleared: true });
});

app.get('/api/library/organize/plan', (req, res) => {
  const { region } = req.query;
  if (!region) {
    return res.status(400).json({ error: 'region query param is required' });
  }
  if (!scanner.isConfigured()) {
    return res.status(409).json({ error: 'No title folder mounted. Set TITLES_DIR / the titles volume in docker-compose.yml.' });
  }
  if (!store.isDownloaded(region)) {
    return res.status(409).json({ error: `${region} has not been downloaded yet. POST /api/sync first.` });
  }
  const { plan, skipped } = organize.buildPlan(region);
  res.json({ titlesDir: scanner.TITLES_DIR, count: plan.length, plan, skippedCount: skipped.length, skipped });
});

app.post('/api/library/organize/apply', (req, res) => {
  const { region, paths } = req.body || {};
  if (!region || !Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: 'region and a non-empty paths array are required' });
  }
  if (!scanner.isConfigured()) {
    return res.status(409).json({ error: 'No title folder mounted. Set TITLES_DIR / the titles volume in docker-compose.yml.' });
  }
  if (!store.isDownloaded(region)) {
    return res.status(409).json({ error: `${region} has not been downloaded yet. POST /api/sync first.` });
  }
  const { moved, errors } = organize.applyPlan(region, paths);
  res.json({ movedCount: moved.length, moved, errorCount: errors.length, errors });
});

app.listen(PORT, () => {
  console.log(`SwitchShelf listening on http://localhost:${PORT}`);
});
