// Hides the Staging nav link/page when the feature is turned off server-side
// (STAGING_ENABLED, default false). The API routes are also blocked server-side
// regardless of this — this just keeps the UI from advertising a disabled feature.
(async function () {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    if (config.stagingEnabled) return;

    document.querySelectorAll('a[href="staging.html"]').forEach((link) => {
      const prev = link.previousSibling;
      if (prev && prev.nodeType === Node.TEXT_NODE && prev.textContent.trim() === '·') {
        prev.remove();
      }
      link.remove();
    });

    if (/(^|\/)staging\.html$/.test(location.pathname)) {
      location.replace('index.html');
    }
  } catch {
    // If /api/config is unreachable, leave the nav as-is rather than hide a
    // feature that might actually be enabled.
  }
})();
