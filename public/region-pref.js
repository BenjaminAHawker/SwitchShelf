const RegionPref = (() => {
  const KEY = 'stl:defaultRegion';
  return {
    get: () => localStorage.getItem(KEY),
    set: (name) => localStorage.setItem(KEY, name),
    clear: () => localStorage.removeItem(KEY),
  };
})();
