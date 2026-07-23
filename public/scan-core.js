// Displayed next to a match/search-result name so DLC, update editions, and
// demos are distinguishable from base games (which get no tag).
const CONTENT_TYPE_TAG = { dlc: 'DLC', update: 'Update', demo: 'Demo' };

// Static markup, never interpolated with any untrusted value. Font Awesome
// (vendored under public/vendor/fontawesome, loaded via <link> in scan.html
// / staging.html) renders the glyph from this class name alone.
const TRASH_ICON_HTML = '<i class="fa-solid fa-trash" aria-hidden="true"></i>';

// Shared logic behind both Library Scan (scan.js) and Staging (staging.js):
// scan a folder, match files against titledb, accept/reject/override each
// one, then preview and apply a rename/move plan. The two pages differ only
// in which API endpoints they hit and a couple of button labels, passed in
// via `config`.
function initScanPage(config) {
  const {
    apiBase, // '/api/library' or '/api/staging'
    organizeIdleLabel, // e.g. 'Organize accepted files' or 'Move accepted files to Library'
    allowDelete = false, // Staging only — permanently removes a file from disk.
  } = config;

  const regionSelect = document.getElementById('region-select');
  const scanBtn = document.getElementById('scan-btn');
  const defaultRegionBtn = document.getElementById('default-region-btn');
  const scanStatus = document.getElementById('scan-status');
  const summary = document.getElementById('summary');
  const resultsBody = document.getElementById('results-body');
  const acceptedSummary = document.getElementById('accepted-summary');
  const acceptedBody = document.getElementById('accepted-results-body');

  let regions = [];
  let currentResults = [];

  // --- Web modal, replacing native alert()/confirm() ---

  const modalBackdrop = document.getElementById('modal-backdrop');
  const modalTitle = document.getElementById('modal-title');
  const modalMessage = document.getElementById('modal-message');
  const modalCancelBtn = document.getElementById('modal-cancel-btn');
  const modalConfirmBtn = document.getElementById('modal-confirm-btn');

  function showModal({ title, message, confirmText = 'OK', cancelText = 'Cancel', showCancel = false }) {
    return new Promise((resolve) => {
      const previouslyFocused = document.activeElement;
      modalTitle.textContent = title;
      modalMessage.textContent = message;
      modalConfirmBtn.textContent = confirmText;
      modalCancelBtn.textContent = cancelText;
      modalCancelBtn.hidden = !showCancel;
      modalBackdrop.hidden = false;

      const focusable = [modalCancelBtn, modalConfirmBtn].filter((el) => !el.hidden);

      const cleanup = (result) => {
        modalBackdrop.hidden = true;
        modalConfirmBtn.removeEventListener('click', onConfirm);
        modalCancelBtn.removeEventListener('click', onCancel);
        modalBackdrop.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onKeydown);
        previouslyFocused?.focus?.();
        resolve(result);
      };
      const onConfirm = () => cleanup(true);
      const onCancel = () => cleanup(false);
      const onBackdrop = (e) => {
        if (e.target === modalBackdrop) cleanup(false);
      };
      const onKeydown = (e) => {
        if (e.key === 'Escape') {
          cleanup(false);
          return;
        }
        if (e.key === 'Enter' && showCancel === false) {
          cleanup(true);
          return;
        }
        // Trap focus inside the modal while it's open.
        if (e.key === 'Tab' && focusable.length > 0) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      };

      modalConfirmBtn.addEventListener('click', onConfirm);
      modalCancelBtn.addEventListener('click', onCancel);
      modalBackdrop.addEventListener('click', onBackdrop);
      document.addEventListener('keydown', onKeydown);
      modalConfirmBtn.focus();
    });
  }

  function showAlert(message, title = 'Notice') {
    return showModal({ title, message, confirmText: 'OK', showCancel: false });
  }

  function showConfirm(message, title = 'Confirm') {
    return showModal({ title, message, confirmText: 'Confirm', cancelText: 'Cancel', showCancel: true });
  }

  async function loadRegions() {
    const res = await fetch('/api/regions');
    regions = await res.json();
    regionSelect.innerHTML = '';
    for (const r of regions) {
      const opt = document.createElement('option');
      opt.value = r.name;
      opt.textContent = `${r.region} (${r.language})${r.downloaded ? '' : ' - not downloaded'}`;
      if (!r.downloaded) opt.disabled = true;
      regionSelect.appendChild(opt);
    }

    const defaultRegion = RegionPref.get();
    if (defaultRegion && regions.some((r) => r.name === defaultRegion && r.downloaded)) {
      regionSelect.value = defaultRegion;
    }
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

  regionSelect.addEventListener('change', updateDefaultRegionButton);

  defaultRegionBtn?.addEventListener('click', () => {
    RegionPref.set(regionSelect.value);
    updateDefaultRegionButton();
  });

  scanBtn.addEventListener('click', runScan);

  async function runScan() {
    const region = regionSelect.value;
    if (!region) return;
    scanBtn.disabled = true;
    scanStatus.textContent = 'Scanning...';
    summary.textContent = '';
    resultsBody.innerHTML = '';
    if (acceptedBody) acceptedBody.innerHTML = '';

    try {
      const res = await fetch(`${apiBase}/scan?region=${encodeURIComponent(region)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'scan failed');

      currentResults = data.results;
      scanStatus.textContent = '';
      const pending = currentResults.filter((r) => r.status === 'pending').length;
      const accepted = currentResults.filter((r) => r.status === 'accepted').length;
      const rejected = currentResults.filter((r) => r.status === 'rejected').length;
      summary.textContent = data.hint
        ? data.hint
        : `${data.count} file(s) in ${data.titlesDir || data.stagingDir} — ${pending} pending, ${accepted} accepted, ${rejected} rejected`;

      render(region);
    } catch (err) {
      scanStatus.textContent = `Error: ${err.message}`;
    } finally {
      scanBtn.disabled = false;
    }
  }

  function render(region) {
    const accepted = currentResults.filter((r) => r.status === 'accepted');
    const rest = currentResults.filter((r) => r.status !== 'accepted');

    resultsBody.innerHTML = '';
    for (const item of rest) {
      resultsBody.appendChild(renderRow(item, region));
    }

    if (acceptedBody) {
      acceptedBody.innerHTML = '';
      for (const item of accepted) {
        acceptedBody.appendChild(renderRow(item, region, { showStatus: false }));
      }
    }
    if (acceptedSummary) {
      acceptedSummary.textContent = accepted.length ? `${accepted.length} file(s) accepted.` : 'No files accepted yet.';
    }
  }

  function renderRow(item, region, { showStatus = true } = {}) {
    const tr = document.createElement('tr');
    tr.dataset.path = item.path;

    const fileTd = document.createElement('td');
    fileTd.title = item.path;
    const nameLine = document.createElement('div');
    nameLine.textContent = item.fileName;
    fileTd.appendChild(nameLine);
    const lastSlash = item.path.lastIndexOf('/');
    const location = lastSlash === -1 ? '/' : item.path.slice(0, lastSlash);
    const pathLine = document.createElement('div');
    pathLine.className = 'file-path';
    pathLine.textContent = location;
    fileTd.appendChild(pathLine);
    tr.appendChild(fileTd);

    const idTd = document.createElement('td');
    idTd.textContent = item.decidedTitleId || item.titleId || '(none found)';
    tr.appendChild(idTd);

    const matchTd = document.createElement('td');
    renderMatchCell(matchTd, item.match);
    if (item.status === 'accepted' && item.match && item.match.contentType !== 'dlc') {
      renderVersionEditor(matchTd, item, region);
    }
    tr.appendChild(matchTd);

    const typeTd = document.createElement('td');
    renderTypeCell(typeTd, item.match);
    tr.appendChild(typeTd);

    if (showStatus) {
      const statusTd = document.createElement('td');
      statusTd.appendChild(statusBadge(item.status));
      tr.appendChild(statusTd);
    }

    const actionsTd = document.createElement('td');
    const actionsRow = document.createElement('div');
    actionsRow.className = 'row-actions';

    const acceptBtn = document.createElement('button');
    acceptBtn.textContent = 'Accept';
    acceptBtn.disabled = !item.match || item.status === 'accepted';
    acceptBtn.addEventListener('click', () => {
      // The version shown while reviewing is often just the auto-extracted
      // one from the filename (shown as a placeholder, not saved yet) — carry
      // it into the decision on accept so ownership works immediately,
      // instead of only once someone manually retypes the same number into
      // the version field.
      const version = item.match && item.match.contentType !== 'dlc'
        ? item.versionOverride ?? item.version ?? null
        : undefined;
      decide(item, 'accepted', item.decidedTitleId || item.titleId, region, version);
    });

    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'secondary';
    rejectBtn.textContent = 'Reject';
    rejectBtn.disabled = item.status === 'rejected';
    rejectBtn.addEventListener('click', () => decide(item, 'rejected', item.decidedTitleId || item.titleId, region));

    const changeBtn = document.createElement('button');
    changeBtn.className = 'secondary';
    changeBtn.textContent = 'Change match';

    actionsRow.appendChild(acceptBtn);
    actionsRow.appendChild(rejectBtn);
    actionsRow.appendChild(changeBtn);

    if (allowDelete) {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'danger icon-btn';
      deleteBtn.innerHTML = TRASH_ICON_HTML;
      deleteBtn.setAttribute('aria-label', `Delete ${item.fileName}`);
      deleteBtn.title = 'Delete';
      deleteBtn.addEventListener('click', () => deleteItem(item, region));
      actionsRow.appendChild(deleteBtn);
    }

    actionsTd.appendChild(actionsRow);

    const overrideBox = document.createElement('div');
    overrideBox.className = 'override-box';
    const overrideInput = document.createElement('input');
    overrideInput.type = 'text';
    overrideInput.placeholder = 'Search by name or nsuId to find the right title...';
    const overrideResults = document.createElement('div');
    overrideResults.className = 'override-results';
    overrideBox.appendChild(overrideInput);
    overrideBox.appendChild(overrideResults);
    actionsTd.appendChild(overrideBox);

    changeBtn.addEventListener('click', () => {
      overrideBox.classList.toggle('open');
      if (overrideBox.classList.contains('open')) overrideInput.focus();
    });

    let debounce;
    overrideInput.addEventListener('input', () => {
      clearTimeout(debounce);
      const q = overrideInput.value.trim();
      if (!q) {
        overrideResults.innerHTML = '';
        return;
      }
      debounce = setTimeout(async () => {
        // contentType: 'all' — matching a file to its DLC or update-edition
        // catalog entry (not just the base game) is the whole point of this box.
        const params = new URLSearchParams({ region, q, field: 'all', contentType: 'all' });
        const res = await fetch(`/api/search?${params}`);
        const data = await res.json();
        overrideResults.innerHTML = '';
        if (!res.ok) return;
        for (const title of data.results.slice(0, 25)) {
          const row = document.createElement('div');
          const tag = CONTENT_TYPE_TAG[title.contentType];
          row.textContent = `${tag ? `[${tag}] ` : ''}${title.name || '(no name)'} — ${title.id || ''}`;
          row.addEventListener('click', () => {
            item.match = title;
            item.decidedTitleId = title.id;
            renderMatchCell(matchTd, title);
            renderTypeCell(typeTd, title);
            if (item.status === 'accepted' && title.contentType !== 'dlc') {
              renderVersionEditor(matchTd, item, region);
            }
            overrideBox.classList.remove('open');
            overrideResults.innerHTML = '';
            overrideInput.value = '';
            idTd.textContent = title.id;
            acceptBtn.disabled = false;
          });
          overrideResults.appendChild(row);
        }
      }, 250);
    });

    tr.appendChild(actionsTd);
    return tr;
  }

  function renderMatchCell(cell, match) {
    cell.innerHTML = '';
    const details = document.createElement('div');
    details.className = 'match-details';

    if (!match) {
      const span = document.createElement('span');
      span.className = 'match-none';
      span.textContent = 'No match found';
      details.appendChild(span);
      cell.appendChild(details);
      return;
    }
    if (match.iconUrl) {
      const img = document.createElement('img');
      img.src = match.iconUrl;
      img.loading = 'lazy';
      img.alt = '';
      details.appendChild(img);
    }
    const span = document.createElement('span');
    span.textContent = match.name || '(no name)';
    details.appendChild(span);
    cell.appendChild(details);
  }

  function renderTypeCell(cell, match) {
    cell.innerHTML = '';
    const tag = match && CONTENT_TYPE_TAG[match.contentType];
    if (!tag) return;
    const badge = document.createElement('span');
    badge.className = `badge badge-type-${match.contentType}`;
    badge.textContent = tag;
    cell.appendChild(badge);
  }

  // Base games and updates are organized as "<Name> [<Id>][<version>]<ext>".
  // The version normally comes from a "[vNNN]" tag in the filename, but not
  // every update file carries one — this lets it be set (or corrected) by
  // hand, e.g. to file a bare "Game Update.nsp" as the specific version it is.
  function renderVersionEditor(cell, item, region) {
    const label = document.createElement('label');
    label.className = 'checkbox-item field-note';
    label.append('Version');

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '1';
    input.placeholder = item.version ?? '0';
    input.value = item.versionOverride ?? '';
    input.className = 'version-input';
    label.appendChild(input);
    cell.appendChild(label);

    const commit = async () => {
      const raw = input.value.trim();
      if (raw === (item.versionOverride ?? '')) return;
      input.disabled = true;
      try {
        await setVersionOverride(item, region, raw === '' ? null : raw);
        item.versionOverride = raw === '' ? null : raw;
      } catch (err) {
        await showAlert(err.message, 'Error');
        input.value = item.versionOverride ?? '';
      } finally {
        input.disabled = false;
      }
    };
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
    });
  }

  async function setVersionOverride(item, region, version) {
    const res = await fetch(`${apiBase}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: item.path,
        status: item.status === 'pending' ? 'accepted' : item.status,
        titleId: item.decidedTitleId || item.titleId,
        region,
        version,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save version');
    if (item.status === 'pending') item.status = 'accepted';
  }

  function statusBadge(status) {
    const span = document.createElement('span');
    span.className = `badge badge-${status}`;
    span.textContent = status;
    return span;
  }

  async function decide(item, status, titleId, region, version) {
    const body = { path: item.path, status, titleId, region };
    if (version !== undefined) body.version = version;
    const res = await fetch(`${apiBase}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      await showAlert(data.error || 'Failed to save decision', 'Error');
      return;
    }
    item.status = status;
    item.decidedTitleId = titleId;
    if (version !== undefined) item.versionOverride = version;
    render(region);
    const accepted = currentResults.filter((r) => r.status === 'accepted').length;
    const rejected = currentResults.filter((r) => r.status === 'rejected').length;
    const pending = currentResults.filter((r) => r.status === 'pending').length;
    summary.textContent = `${currentResults.length} file(s) — ${pending} pending, ${accepted} accepted, ${rejected} rejected`;
  }

  async function deleteItem(item, region) {
    const confirmed = await showConfirm(
      `Permanently delete "${item.fileName}" from disk? This cannot be undone.`,
      'Delete file?'
    );
    if (!confirmed) return;

    try {
      const res = await fetch(`${apiBase}/file`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: item.path }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete file');

      currentResults = currentResults.filter((r) => r.path !== item.path);
      render(region);
      const accepted = currentResults.filter((r) => r.status === 'accepted').length;
      const rejected = currentResults.filter((r) => r.status === 'rejected').length;
      const pending = currentResults.filter((r) => r.status === 'pending').length;
      summary.textContent = `${currentResults.length} file(s) — ${pending} pending, ${accepted} accepted, ${rejected} rejected`;
    } catch (err) {
      await showAlert(err.message, 'Error');
    }
  }

  // --- Organize: rename/move accepted files ---

  const organizeBtn = document.getElementById('organize-btn');
  const organizeStatus = document.getElementById('organize-status');
  const organizePanel = document.getElementById('organize-panel');
  const organizeSummary = document.getElementById('organize-summary');
  const organizeBody = document.getElementById('organize-body');
  const organizeSkipped = document.getElementById('organize-skipped');
  const organizeApplyBtn = document.getElementById('organize-apply-btn');

  let organizeOpen = false;

  organizeBtn.addEventListener('click', async () => {
    organizeOpen = !organizeOpen;
    organizePanel.hidden = !organizeOpen;
    // organizeIdleLabel is a fixed config string, never user input.
    organizeBtn.innerHTML = organizeOpen
      ? `${organizeIdleLabel} <i class="fa-solid fa-chevron-up" aria-hidden="true"></i>`
      : `${organizeIdleLabel} <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>`;
    organizeBtn.setAttribute('aria-expanded', String(organizeOpen));
    if (organizeOpen) {
      await loadOrganizePlan();
    }
  });

  async function loadOrganizePlan() {
    const region = regionSelect.value;
    if (!region) return;
    organizeStatus.textContent = 'Building plan...';
    organizeBody.innerHTML = '';
    organizeSkipped.innerHTML = '';
    organizeApplyBtn.disabled = true;

    try {
      const res = await fetch(`${apiBase}/organize/plan?${new URLSearchParams({ region })}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to build plan');

      organizeStatus.textContent = '';
      organizeSummary.textContent = data.count === 0
        ? 'Nothing to organize — every accepted file is already in place, or none are accepted yet.'
        : `${data.count} file(s) will be moved. Review the plan, uncheck anything you don't want, then apply.`;

      organizeBody.innerHTML = '';
      for (const item of data.plan) {
        organizeBody.appendChild(renderOrganizeRow(item, region));
      }

      if (data.skippedCount > 0) {
        const header = document.createElement('div');
        header.className = 'status';
        header.textContent = `${data.skippedCount} file(s) skipped:`;
        organizeSkipped.appendChild(header);
        for (const s of data.skipped) {
          const line = document.createElement('div');
          line.className = 'status';
          line.textContent = `${s.path} — ${s.reason}`;
          organizeSkipped.appendChild(line);
        }
      }

      organizeApplyBtn.disabled = data.count === 0;
    } catch (err) {
      organizeStatus.textContent = `Error: ${err.message}`;
    }
  }

  function renderOrganizeRow(item, region) {
    const tr = document.createElement('tr');
    tr.dataset.path = item.path;

    const checkTd = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkTd.appendChild(checkbox);
    tr.appendChild(checkTd);

    const fromTd = document.createElement('td');
    fromTd.textContent = item.from;
    tr.appendChild(fromTd);

    const toTd = document.createElement('td');
    toTd.innerHTML = `<code>${item.to}</code>`;
    tr.appendChild(toTd);

    const typeTd = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `badge badge-type-${item.contentType || 'base'}`;
    badge.textContent = item.contentType || 'base';
    typeTd.appendChild(badge);
    tr.appendChild(typeTd);

    return tr;
  }

  organizeApplyBtn.addEventListener('click', async () => {
    const region = regionSelect.value;
    const checked = [...organizeBody.querySelectorAll('input[type="checkbox"]:checked')]
      .map((cb) => cb.closest('tr').dataset.path);
    if (checked.length === 0) {
      await showAlert('Nothing selected.', 'Nothing to move');
      return;
    }
    const confirmed = await showConfirm(
      `Move and rename ${checked.length} file(s) on disk? This cannot be undone automatically.`,
      'Move files?'
    );
    if (!confirmed) {
      return;
    }

    organizeApplyBtn.disabled = true;
    organizeStatus.textContent = 'Moving files...';
    try {
      const res = await fetch(`${apiBase}/organize/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ region, paths: checked }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to organize');

      organizeStatus.textContent = `Moved ${data.movedCount} file(s)${data.errorCount ? `, ${data.errorCount} error(s)` : ''}.`;
      if (data.errorCount) {
        const errBox = document.createElement('div');
        errBox.className = 'status';
        errBox.textContent = data.errors.map((e) => `${e.path}: ${e.error}`).join(' | ');
        organizeSkipped.appendChild(errBox);
      }
      await loadOrganizePlan();
      await runScan();
    } catch (err) {
      organizeStatus.textContent = `Error: ${err.message}`;
    } finally {
      organizeApplyBtn.disabled = false;
    }
  });

  loadRegions();
}
