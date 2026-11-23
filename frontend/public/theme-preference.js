try {
  const stored = document.cookie
    .split('; ')
    .find((part) => part.startsWith('citeladder_theme='))
    ?.slice('citeladder_theme='.length);
  const device = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const theme = stored === 'light' || stored === 'dark' ? stored : device;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
} catch {}
try {
  if (localStorage.getItem('citeladder:app:sidebar-collapsed') === '1') {
    document.documentElement.dataset.sidebarRail = '';
  }
} catch {}
