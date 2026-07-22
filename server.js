const express = require('express');
const path = require('path');
const sync = require('./lib/sync');
const store = require('./lib/store');
const scanner = require('./lib/scanner');
const decisions = require('./lib/decisions');
const cnmts = require('./lib/cnmts');
const organize = require('./lib/organize');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
  const { region, q, field, platform, contentType, owned, languages } = req.query;
  if (!region) {
    return res.status(400).json({ error: 'region query param is required' });
  }
  if (!store.isDownloaded(region)) {
    return res.status(409).json({ error: `${region} has not been downloaded yet. POST /api/sync first.` });
  }
  const { total, results } = store.search(region, q, {
    field: field || 'all',
    platform: platform || 'all',
    contentType: contentType || 'game',
    owned: owned || 'all',
    languages: languages ? languages.split(',').filter(Boolean) : [],
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
  if (!title) {
    return res.status(404).json({ error: `No title with id ${titleId} found in ${region}` });
  }

  res.json({
    region,
    title: {
      ...title,
      isSwitch2: store.isSwitch2(title),
      contentType: store.getContentType(title),
      owned: title.id ? decisions.getAcceptedTitleIds().has(String(title.id).toUpperCase()) : false,
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

  const ownedIds = decisions.getAcceptedTitleIds();
  const related = cnmts.getRelated(titleId);
  const results = related.map((r) => ({
    titleId: r.titleId,
    type: r.type,
    version: r.version,
    match: store.findByTitleId(region, r.titleId),
    owned: ownedIds.has(r.titleId.toUpperCase()),
  }));
  results.sort((a, b) => a.type.localeCompare(b.type) || a.titleId.localeCompare(b.titleId));

  const ownedCount = results.filter((r) => r.owned).length;
  res.json({
    region,
    titleId: String(titleId).toUpperCase(),
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
    const { match, variantOptions } = lookupId
      ? store.resolveVariant(region, lookupId, decision?.variant)
      : { match: null, variantOptions: null };
    return {
      ...file,
      match,
      variantOptions,
      variant: decision?.variant || null,
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

app.post('/api/library/decision', (req, res) => {
  const { path: filePath, status, titleId, region, variant } = req.body || {};
  if (!filePath || !status) {
    return res.status(400).json({ error: 'path and status are required' });
  }
  if (!['accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'status must be "accepted" or "rejected"' });
  }
  if (variant !== undefined && variant !== null && !['switch', 'switch2'].includes(variant)) {
    return res.status(400).json({ error: 'variant must be "switch", "switch2", or null' });
  }
  const saved = decisions.setDecision(filePath, { status, titleId, region, variant });
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
