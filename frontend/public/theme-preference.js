// Blocking, same-origin bootstrap for the app, the website and the docs: apply
// the theme before first paint. The `citeladder_theme` cookie (THEME_COOKIE in
// lib/theme/theme.ts, which owns the preference and writes it on the parent
// domain) holds an explicit light or dark; without it the device decides.
try {
  const stored = document.cookie
    .split('; ')
    .find((part) => part.startsWith('citeladder_theme='))
    ?.slice('citeladder_theme='.length);
  const device = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const theme = stored === 'light' || stored === 'dark' ? stored : device;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
} catch {
  // Cookies or matchMedia unavailable: the stylesheet's light default stands.
}
