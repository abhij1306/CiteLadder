// Blocking, same-origin bootstrap: apply the stored theme before first paint.
// THEME_STORAGE_KEY in lib/theme/theme.ts owns this preference.
try {
  if (localStorage.getItem('citeladder.theme') === 'dark') {
    document.documentElement.dataset.theme = 'dark';
    document.querySelector('meta[name="color-scheme"]').content = 'dark';
  }
} catch {
  // Storage may be unavailable; keep the default light theme.
}
