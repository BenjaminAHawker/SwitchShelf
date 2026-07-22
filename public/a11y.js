// Shared accessibility preferences: high contrast, larger text, reduced
// motion, and always-underlined links. Persisted in localStorage and applied
// via classes on <html> (see the inline snippet in each page's <head> for the
// no-flash-of-unstyled-content application, and style.css for the effects).
const A11yPrefs = (() => {
  const KEY = 'switchshelf.a11y';
  const DEFAULTS = { highContrast: false, largeText: false, reducedMotion: false, underlineLinks: false };

  function get() {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function set(prefs) {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  }

  function apply(prefs) {
    const root = document.documentElement;
    root.classList.toggle('a11y-high-contrast', !!prefs.highContrast);
    root.classList.toggle('a11y-large-text', !!prefs.largeText);
    root.classList.toggle('a11y-reduced-motion', !!prefs.reducedMotion);
    root.classList.toggle('a11y-underline-links', !!prefs.underlineLinks);
  }

  return { get, set, apply, DEFAULTS };
})();

const A11Y_FIELD_MAP = {
  'a11y-high-contrast-toggle': 'highContrast',
  'a11y-large-text-toggle': 'largeText',
  'a11y-reduced-motion-toggle': 'reducedMotion',
  'a11y-underline-links-toggle': 'underlineLinks',
};

function initA11yMenu() {
  const prefs = A11yPrefs.get();
  for (const [id, key] of Object.entries(A11Y_FIELD_MAP)) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.checked = !!prefs[key];
    el.addEventListener('change', () => {
      const next = A11yPrefs.get();
      next[key] = el.checked;
      A11yPrefs.set(next);
      A11yPrefs.apply(next);
    });
  }

  // Close the menu on outside click or Escape, like a standard menu button.
  const menu = document.querySelector('.a11y-menu');
  if (!menu) return;
  document.addEventListener('click', (e) => {
    if (menu.open && !menu.contains(e.target)) menu.open = false;
  });
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.open) {
      menu.open = false;
      menu.querySelector('summary')?.focus();
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initA11yMenu);
} else {
  initA11yMenu();
}
