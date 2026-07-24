const regionSelect = document.getElementById('region-select');
const libraryInfo = document.getElementById('library-info');
const libraryGrid = document.getElementById('library-grid');

let regions = [];

function regionLabel(r) {
  const flag = !r.downloaded ? '⬇️ not downloaded' : r.source === 'upload' ? '📁 uploaded' : r.stale ? '⚠️ update available' : '✅';
  return `${r.region} (${r.language}) - ${flag}`;
}

async function loadRegions() {
  const res = await fetch('/api/regions');
  const data = await res.json();
  regions = data.regions || [];
  regionSelect.innerHTML = '';
  for (const r of regions) {
    const opt = document.createElement('option');
    opt.value = r.name;
    opt.textContent = regionLabel(r);
    regionSelect.appendChild(opt);
  }

  const defaultRegion = RegionPref.get();
  const target = defaultRegion && regions.some((r) => r.name === defaultRegion) ? defaultRegion : null;
  if (target) {
    regionSelect.value = target;
  }
}

function currentRegion() {
  return regions.find((r) => r.name === regionSelect.value);
}

function renderGrid(titles, region) {
  libraryGrid.innerHTML = '';
  for (const title of titles) {
    const item = document.createElement('a');
    item.className = 'library-item';
    item.href = `details.html?${new URLSearchParams({ region, titleId: title.id })}`;
    item.title = title.name || '(no name)';

    const iconWrap = document.createElement('div');
    iconWrap.className = 'library-item-icon';
    if (title.iconUrl) {
      const img = document.createElement('img');
      img.src = title.iconUrl;
      img.loading = 'lazy';
      img.alt = title.name || '';
      iconWrap.appendChild(img);
    }
    item.appendChild(iconWrap);

    libraryGrid.appendChild(item);
  }
}

async function loadLibrary() {
  const region = regionSelect.value;
  if (!region) {
    libraryGrid.innerHTML = '';
    libraryInfo.textContent = '';
    return;
  }
  const r = currentRegion();
  if (!r || !r.downloaded) {
    libraryInfo.textContent = 'This region has not been downloaded yet. Sync it from the Search page first.';
    libraryGrid.innerHTML = '';
    return;
  }

  libraryInfo.textContent = 'Loading...';
  const params = new URLSearchParams({
    region,
    q: '',
    field: 'all',
    contentType: 'game',
    owned: 'owned',
    languages: '',
    sort: 'name-asc',
  });
  const res = await fetch(`/api/search?${params}`);
  const data = await res.json();
  if (!res.ok) {
    libraryInfo.textContent = `Error: ${data.error}`;
    libraryGrid.innerHTML = '';
    return;
  }

  const suffix = data.total > data.count ? ` (showing first ${data.count} of ${data.total})` : '';
  libraryInfo.textContent = `${data.total} owned game${data.total === 1 ? '' : 's'}${suffix}`;
  renderGrid(data.results, region);
}

regionSelect.addEventListener('change', () => {
  RegionPref.set(regionSelect.value);
  loadLibrary();
});

loadRegions().then(loadLibrary);
