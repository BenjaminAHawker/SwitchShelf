const statusEl = document.getElementById('status');
const root = document.getElementById('detail-root');
const pageTitle = document.getElementById('page-title');
const backLink = document.getElementById('back-link');

const params = new URLSearchParams(location.search);
const region = params.get('region');
const titleId = params.get('titleId');

if (region) {
  backLink.href = `index.html?region=${encodeURIComponent(region)}`;
}

function fmtBytes(bytes) {
  if (!bytes) return null;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtDate(yyyymmdd) {
  if (!yyyymmdd) return null;
  const s = String(yyyymmdd);
  if (s.length !== 8) return s;
  return `${s.slice(4, 6)}/${s.slice(6, 8)}/${s.slice(0, 4)}`;
}

function metaRow(label, value) {
  if (value === null || value === undefined || value === '') return '';
  return `<div class="meta-row"><span class="meta-label">${label}</span><span class="meta-value">${value}</span></div>`;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

async function load() {
  if (!region || !titleId) {
    statusEl.textContent = 'Missing region or titleId in the URL.';
    return;
  }

  statusEl.textContent = 'Loading...';
  try {
    const res = await fetch(`/api/title?${new URLSearchParams({ region, titleId })}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load title');
    statusEl.textContent = '';
    render(data.title, data.hasExpansions, data.demos || []);
    loadExpansions(data.hasExpansions);
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  }
}

function render(title, hasExpansions, demos) {
  pageTitle.textContent = title.name || '(no name)';
  document.title = `${title.name || 'Title Details'} - SwitchShelf`;

  const platformBadge = `<span class="badge ${title.isSwitch2 ? 'badge-switch2' : 'badge-switch'}">${title.isSwitch2 ? 'Switch 2' : 'Switch'}</span>`;
  const contentTypeBadge = title.contentType && title.contentType !== 'base'
    ? `<span class="badge badge-type-${title.contentType}">${esc(title.contentType)}</span>`
    : '';
  const ownedBadge = title.owned ? '<span class="badge badge-owned">Owned</span>' : '';

  const meta = [
    metaRow('Title ID', title.id ? `<code>${esc(title.id)}</code>` : null),
    metaRow('nsuId', title.nsuId ?? null),
    metaRow('Publisher', esc(title.publisher)),
    metaRow('Developer', esc(title.developer)),
    metaRow('Release date', fmtDate(title.releaseDate)),
    metaRow('Size', fmtBytes(title.size)),
    metaRow('Players', title.numberOfPlayers ?? null),
    metaRow('Rating', title.rating != null ? title.rating : null),
    metaRow('Rating content', Array.isArray(title.ratingContent) && title.ratingContent.length ? esc(title.ratingContent.join(', ')) : null),
    metaRow('Category', Array.isArray(title.category) && title.category.length ? esc(title.category.join(', ')) : null),
    metaRow('Languages', Array.isArray(title.languages) && title.languages.length ? esc([...new Set(title.languages)].join(', ')) : null),
    metaRow('Demo', title.isDemo ? 'Yes' : null),
    metaRow('Rights ID', title.rightsId ? `<code>${esc(title.rightsId)}</code>` : null),
  ].join('');

  const screenshots = Array.isArray(title.screenshots) && title.screenshots.length
    ? `<div class="screenshot-row">${title.screenshots.map((s) => `<img src="${esc(s)}" loading="lazy" alt="" />`).join('')}</div>`
    : '';

  const demosSection = title.contentType === 'demo' ? '' : `
    <h3>Demos</h3>
    ${demos.length
      ? `<div class="expand-list">${demos.map((d) => `
        <div class="expand-item">
          ${d.iconUrl ? `<img src="${esc(d.iconUrl)}" loading="lazy" alt="" />` : ''}
          ${d.titleId
            ? `<a href="details.html?${new URLSearchParams({ region, titleId: d.titleId })}">${esc(d.name)}</a>`
            : `<span>${esc(d.name)}</span>`}
          <span class="expand-id">${esc(d.titleId || '')}</span>
        </div>
      `).join('')}</div>`
      : '<span class="match-none">No demo found for this title.</span>'}
  `;

  root.innerHTML = `
    ${title.bannerUrl ? `<div class="detail-banner" style="background-image:url('${esc(title.bannerUrl)}')"></div>` : ''}
    <div class="detail-header">
      ${title.iconUrl ? `<img class="detail-icon" src="${esc(title.iconUrl)}" alt="" />` : ''}
      <div class="detail-header-text">
        <h2 class="detail-name">${esc(title.name || '(no name)')}</h2>
        <div class="detail-badges">${platformBadge}${contentTypeBadge}${ownedBadge}</div>
      </div>
    </div>
    ${title.intro ? `<p class="detail-intro">${esc(title.intro)}</p>` : ''}
    <div class="meta-grid">${meta}</div>
    ${title.description ? `<h3>Description</h3><p class="detail-description">${esc(title.description)}</p>` : ''}
    ${screenshots ? `<h3>Screenshots</h3>${screenshots}` : ''}
    ${demosSection}
    <h3>DLC / Updates</h3>
    <div id="expand-root">${hasExpansions === null ? '<span class="match-none">Sync the DLC/Update index to see this.</span>' : '<span class="status">Loading...</span>'}</div>
  `;
}

async function loadExpansions(hasExpansions) {
  const expandRoot = document.getElementById('expand-root');
  if (hasExpansions === null) return;
  if (hasExpansions === false) {
    expandRoot.innerHTML = '<span class="match-none">No updates or DLC found for this title.</span>';
    return;
  }

  try {
    const res = await fetch(`/api/expand?${new URLSearchParams({ region, titleId })}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load DLC/updates');

    if (data.count === 0) {
      expandRoot.innerHTML = '<span class="match-none">No updates or DLC found for this title.</span>';
      return;
    }

    const summary = document.createElement('div');
    summary.className = 'status expand-summary';
    summary.textContent = `${data.ownedCount} of ${data.count} owned`;

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

      const labelText = item.match?.name || (item.type === 'update' ? (item.version != null ? `Update v${item.version}` : 'Update') : '(no titledb entry)');
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

      const idSpan = document.createElement('span');
      idSpan.className = 'expand-id';
      idSpan.textContent = item.titleId;
      entry.appendChild(idSpan);

      list.appendChild(entry);
    }
    expandRoot.innerHTML = '';
    expandRoot.appendChild(summary);
    expandRoot.appendChild(list);
  } catch (err) {
    expandRoot.textContent = `Error: ${err.message}`;
  }
}

load();
