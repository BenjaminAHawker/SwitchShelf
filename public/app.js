const regionSelect = document.getElementById('region-select');
const syncBtn = document.getElementById('sync-btn');
const defaultRegionBtn = document.getElementById('default-region-btn');
const syncStatus = document.getElementById('sync-status');
const cnmtsLabel = document.getElementById('cnmts-label');
const cnmtsSyncBtn = document.getElementById('cnmts-sync-btn');
const cnmtsStatus = document.getElementById('cnmts-status');
const searchInput = document.getElementById('search-input');
const fieldSelect = document.getElementById('field-select');
const contentSelect = document.getElementById('content-select');
const ownedSelect = document.getElementById('owned-select');
const languageCheckboxes = document.getElementById('language-checkboxes');
const resultsInfo = document.getElementById('results-info');
const resultsBody = document.getElementById('results-body');
const sortButtons = document.querySelectorAll('.sort-btn');

let regions = [];
let cnmtsState = { downloaded: false, stale: false };
let selectedLanguages = new Set();
let loadedLanguagesRegion = null;
let sortField = 'name';
let sortDir = 'asc';

// Clicking a column that isn't the active sort switches to it with a sensible
// default direction (alphabetical for name, newest-first for date); clicking
// the already-active column flips its direction.
const DEFAULT_SORT_DIR = { name: 'asc', date: 'desc' };

function updateSortHeaders() {
  for (const btn of sortButtons) {
    const th = btn.closest('th');
    const isActive = btn.dataset.sortField === sortField;
    th.setAttribute('aria-sort', isActive ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
  }
}

for (const btn of sortButtons) {
  btn.addEventListener('click', () => {
    const field = btn.dataset.sortField;
    if (field === sortField) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortField = field;
      sortDir = DEFAULT_SORT_DIR[field] || 'asc';
    }
    updateSortHeaders();
    runSearch();
  });
}

updateSortHeaders();

// titledb stores releaseDate as an YYYYMMDD integer, e.g. 20220707.
function fmtReleaseDate(yyyymmdd) {
  if (!yyyymmdd) return '';
  const s = String(yyyymmdd);
  if (s.length !== 8) return s;
  return `${s.slice(4, 6)}/${s.slice(6, 8)}/${s.slice(0, 4)}`;
}

function regionLabel(r) {
  const flag = r.downloaded ? (r.stale ? '⚠️ update available' : '✅') : '⬇️ not downloaded';
  return `${r.region} (${r.language}) - ${flag}`;
}

async function loadRegions(selectName) {
  const res = await fetch('/api/regions');
  regions = await res.json();
  regionSelect.innerHTML = '';
  for (const r of regions) {
    const opt = document.createElement('option');
    opt.value = r.name;
    opt.textContent = regionLabel(r);
    regionSelect.appendChild(opt);
  }

  const defaultRegion = RegionPref.get();
  const target = selectName || (defaultRegion && regions.some((r) => r.name === defaultRegion) ? defaultRegion : null);
  if (target) {
    regionSelect.value = target;
  }
  updateSyncButton();
  updateDefaultRegionButton();
}

function updateDefaultRegionButton() {
  if (!defaultRegionBtn) return;
  const isDefault = RegionPref.get() === regionSelect.value;
  // Static markup, never interpolated with any untrusted value.
  defaultRegionBtn.innerHTML = isDefault
    ? '<i class="fa-solid fa-star" aria-hidden="true"></i> Default region'
    : '<i class="fa-regular fa-star" aria-hidden="true"></i> Set as default';
  defaultRegionBtn.disabled = isDefault;
}

async function loadCnmtsStatus() {
  const res = await fetch('/api/extras');
  const extras = await res.json();
  cnmtsState = extras.find((e) => e.name === 'cnmts.json') || { downloaded: false, stale: false };
  cnmtsLabel.textContent = cnmtsState.downloaded
    ? (cnmtsState.stale ? '⚠️ update available' : '✅ index ready')
    : '⬇️ not downloaded';
  cnmtsSyncBtn.textContent = cnmtsState.downloaded ? (cnmtsState.stale ? 'Update' : 'Re-sync') : 'Sync index';
}

function currentRegion() {
  return regions.find((r) => r.name === regionSelect.value);
}

async function loadLanguages(region) {
  const r = regions.find((x) => x.name === region);
  if (!r || !r.downloaded) {
    languageCheckboxes.innerHTML = '<span class="status">Sync this region to see available languages.</span>';
    loadedLanguagesRegion = null;
    return;
  }
  if (loadedLanguagesRegion === region) return;

  const res = await fetch(`/api/languages?${new URLSearchParams({ region })}`);
  const data = await res.json();
  if (!res.ok) {
    languageCheckboxes.innerHTML = `<span class="status">Error: ${data.error}</span>`;
    return;
  }

  loadedLanguagesRegion = region;
  selectedLanguages = new Set([...selectedLanguages].filter((l) => data.languages.includes(l)));

  languageCheckboxes.innerHTML = '';
  for (const lang of data.languages) {
    const label = document.createElement('label');
    label.className = 'checkbox-item';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = lang;
    input.checked = selectedLanguages.has(lang);
    label.appendChild(input);
    label.append(lang);
    languageCheckboxes.appendChild(label);
  }
}

languageCheckboxes.addEventListener('change', (e) => {
  if (e.target.type !== 'checkbox') return;
  if (e.target.checked) {
    selectedLanguages.add(e.target.value);
  } else {
    selectedLanguages.delete(e.target.value);
  }
  scheduleSearch();
});

function updateSyncButton() {
  const r = currentRegion();
  if (!r) return;
  if (!r.downloaded) {
    syncBtn.textContent = 'Download';
  } else if (r.stale) {
    syncBtn.textContent = 'Update';
  } else {
    syncBtn.textContent = 'Re-sync';
  }
}

regionSelect.addEventListener('change', () => {
  updateSyncButton();
  updateDefaultRegionButton();
  syncStatus.textContent = '';
  loadLanguages(regionSelect.value);
  runSearch();
});

defaultRegionBtn?.addEventListener('click', () => {
  RegionPref.set(regionSelect.value);
  updateDefaultRegionButton();
});

syncBtn.addEventListener('click', async () => {
  const region = regionSelect.value;
  if (!region) return;
  syncBtn.disabled = true;
  syncStatus.textContent = `Syncing ${region}...`;
  try {
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ region }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'sync failed');
    syncStatus.textContent = data.updated ? `Downloaded latest ${region}.` : `${region} already up to date.`;
    await loadRegions(region);
    await loadLanguages(region);
    await runSearch();
  } catch (err) {
    syncStatus.textContent = `Error: ${err.message}`;
  } finally {
    syncBtn.disabled = false;
  }
});

cnmtsSyncBtn.addEventListener('click', async () => {
  cnmtsSyncBtn.disabled = true;
  cnmtsStatus.textContent = 'Syncing cnmts.json (this is a large file, may take a while)...';
  try {
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ region: 'cnmts.json' }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'sync failed');
    cnmtsStatus.textContent = data.updated ? 'Downloaded latest DLC/update index.' : 'Already up to date.';
    await loadCnmtsStatus();
  } catch (err) {
    cnmtsStatus.textContent = `Error: ${err.message}`;
  } finally {
    cnmtsSyncBtn.disabled = false;
  }
});

function clearResults() {
  resultsBody.innerHTML = '';
  resultsInfo.textContent = '';
}

let debounceTimer;
function scheduleSearch() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runSearch, 250);
}

async function runSearch() {
  const region = regionSelect.value;
  const q = searchInput.value.trim();
  if (!region) {
    clearResults();
    return;
  }
  const r = currentRegion();
  if (!r || !r.downloaded) {
    resultsInfo.textContent = 'This region has not been downloaded yet. Click Download first.';
    resultsBody.innerHTML = '';
    return;
  }

  const params = new URLSearchParams({
    region,
    q,
    field: fieldSelect.value,
    contentType: contentSelect.value,
    owned: ownedSelect.value,
    languages: [...selectedLanguages].join(','),
    sort: `${sortField}-${sortDir}`,
  });
  const res = await fetch(`/api/search?${params}`);
  const data = await res.json();
  if (!res.ok) {
    resultsInfo.textContent = `Error: ${data.error}`;
    resultsBody.innerHTML = '';
    return;
  }

  const prefix = q ? '' : 'All titles — ';
  const suffix = data.total > data.count ? ` (showing first ${data.count} of ${data.total})` : '';
  resultsInfo.textContent = `${prefix}${data.total} result${data.total === 1 ? '' : 's'}${suffix}`;
  resultsBody.innerHTML = '';
  for (const title of data.results) {
    resultsBody.appendChild(renderResultRow(title, region));
  }
}

function renderResultRow(title, region) {
  const tr = document.createElement('tr');

  const detailsHref = title.id
    ? `details.html?${new URLSearchParams({ region, titleId: title.id })}`
    : null;

  const iconTd = document.createElement('td');
  iconTd.className = 'icon-cell';
  if (title.iconUrl) {
    const img = document.createElement('img');
    img.src = title.iconUrl;
    img.loading = 'lazy';
    img.alt = '';
    if (detailsHref) {
      const link = document.createElement('a');
      link.href = detailsHref;
      link.appendChild(img);
      iconTd.appendChild(link);
    } else {
      iconTd.appendChild(img);
    }
  }
  tr.appendChild(iconTd);

  const nameTd = document.createElement('td');
  if (detailsHref) {
    const link = document.createElement('a');
    link.href = detailsHref;
    link.className = 'name-link';
    link.textContent = title.name || '(no name)';
    nameTd.appendChild(link);
  } else {
    nameTd.textContent = title.name || '(no name)';
  }
  tr.appendChild(nameTd);

  const idTd = document.createElement('td');
  idTd.textContent = title.id || '';
  tr.appendChild(idTd);

  const nsuTd = document.createElement('td');
  nsuTd.textContent = title.nsuId ?? '';
  tr.appendChild(nsuTd);

  const dateTd = document.createElement('td');
  dateTd.textContent = fmtReleaseDate(title.releaseDate);
  tr.appendChild(dateTd);

  const badgesTd = document.createElement('td');
  badgesTd.className = 'badge-cell';
  if (title.contentType === 'dlc' || title.contentType === 'update' || title.contentType === 'demo') {
    const typeBadge = document.createElement('span');
    typeBadge.className = `badge badge-type-${title.contentType}`;
    typeBadge.textContent = title.contentType;
    badgesTd.appendChild(typeBadge);
  }
  if (title.owned) {
    const ownedBadge = document.createElement('span');
    ownedBadge.className = 'badge badge-owned';
    ownedBadge.textContent = 'Owned';
    badgesTd.appendChild(ownedBadge);
  }
  tr.appendChild(badgesTd);

  const expandTd = document.createElement('td');
  if (title.id && title.hasExpansions !== false) {
    // Static markup, never interpolated with any untrusted value.
    const expandLabel = (open) =>
      `DLC/Updates <i class="fa-solid fa-chevron-${open ? 'up' : 'down'}" aria-hidden="true"></i>`;
    const expandBtn = document.createElement('button');
    expandBtn.className = 'secondary';
    expandBtn.innerHTML = expandLabel(false);
    expandBtn.disabled = !cnmtsState.downloaded;
    expandBtn.title = cnmtsState.downloaded ? '' : 'Sync the DLC/Update index first';
    let expanded = false;
    let childRow = null;
    expandBtn.addEventListener('click', async () => {
      if (expanded) {
        childRow?.remove();
        expanded = false;
        expandBtn.innerHTML = expandLabel(false);
        return;
      }
      expandBtn.disabled = true;
      const originalHtml = expandBtn.innerHTML;
      expandBtn.textContent = 'Loading...';
      try {
        childRow = await buildExpandRow(title, region);
        tr.after(childRow);
        expanded = true;
        expandBtn.innerHTML = expandLabel(true);
      } catch (err) {
        expandBtn.innerHTML = originalHtml;
        alert(err.message);
      } finally {
        expandBtn.disabled = false;
      }
    });
    expandTd.appendChild(expandBtn);
  }
  tr.appendChild(expandTd);

  return tr;
}

function fallbackLabel(item) {
  if (item.type === 'update') {
    return item.version != null ? `Update v${item.version}` : 'Update';
  }
  return '(no titledb entry)';
}

async function buildExpandRow(title, region) {
  const params = new URLSearchParams({ region, titleId: title.id });
  const res = await fetch(`/api/expand?${params}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load DLC/updates');
  }

  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = 7;
  cell.className = 'expand-cell';

  if (data.count === 0) {
    cell.innerHTML = '<span class="match-none">No updates or DLC found for this title.</span>';
  } else {
    const summary = document.createElement('div');
    summary.className = 'status expand-summary';
    summary.textContent = `${data.ownedCount} of ${data.count} owned`;
    cell.appendChild(summary);

    const list = document.createElement('div');
    list.className = 'expand-list';
    for (const item of data.results) {
      const entry = document.createElement('div');
      entry.className = 'expand-item';

      const badge = document.createElement('span');
      badge.className = `badge badge-type-${item.type}`;
      badge.textContent = item.type;
      entry.appendChild(badge);

      if (item.match?.iconUrl) {
        const img = document.createElement('img');
        img.src = item.match.iconUrl;
        img.loading = 'lazy';
        img.alt = '';
        entry.appendChild(img);
      }

      const labelText = item.match?.name || fallbackLabel(item);
      if (item.match?.id) {
        const link = document.createElement('a');
        link.href = `details.html?${new URLSearchParams({ region, titleId: item.match.id })}`;
        link.textContent = labelText;
        entry.appendChild(link);
      } else {
        const label = document.createElement('span');
        label.textContent = labelText;
        entry.appendChild(label);
      }

      if (item.owned) {
        const ownedBadge = document.createElement('span');
        ownedBadge.className = 'badge badge-owned';
        ownedBadge.textContent = 'Owned';
        entry.appendChild(ownedBadge);
      }

      if (item.manual) {
        const manualNote = document.createElement('span');
        manualNote.className = 'manual-note';
        manualNote.textContent = 'not in titledb — added from your library';
        entry.appendChild(manualNote);
      }

      const idSpan = document.createElement('span');
      idSpan.className = 'expand-id';
      idSpan.textContent = item.titleId;
      entry.appendChild(idSpan);

      list.appendChild(entry);
    }
    cell.appendChild(list);
  }

  row.appendChild(cell);
  return row;
}

searchInput.addEventListener('input', scheduleSearch);
fieldSelect.addEventListener('change', scheduleSearch);
contentSelect.addEventListener('change', scheduleSearch);
ownedSelect.addEventListener('change', scheduleSearch);

const linkedRegion = new URLSearchParams(location.search).get('region');
loadRegions(linkedRegion || undefined).then(() => {
  loadLanguages(regionSelect.value);
  return runSearch();
});
loadCnmtsStatus();
