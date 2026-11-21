import type * as Manifest from '../../lib/navigation/app-routes.ts';

export type RouteManifest = Pick<
  typeof Manifest,
  'APP_ROUTES' | 'DASHBOARD_SIDEBAR_GROUPS' | 'navDestinations'
>;

export const BOOT_SIDEBAR_MARKER = '<!-- boot-sidebar -->';
export const BOOT_TITLE_FILE = 'boot-title.js';

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/gu, (char) => `&#${char.codePointAt(0)};`);

const row = (label: string) => `<span class="boot-row">${escapeHtml(label)}</span>`;

export function bootSidebarHtml(manifest: RouteManifest): string {
  const groups = manifest.DASHBOARD_SIDEBAR_GROUPS.map(({ group, title }) => {
    const head = title ? `<span class="boot-group-title">${escapeHtml(title)}</span>` : '';
    const rows = manifest.navDestinations(`sidebar:${group}`).map((entry) => row(entry.label));
    return `<div class="boot-group">${head}${rows.join('')}</div>`;
  });
  const foot = manifest.navDestinations('sidebar:foot').map((entry) => row(entry.label));
  return [
    '<div class="boot-ident"><span class="boot-switcher"></span></div>',
    '<div class="boot-mode"><span data-boot-seg="dashboard">Dashboard</span><span data-boot-seg="agent">Agent</span></div>',
    `<div class="boot-list"><div class="boot-rows">${groups.join('')}</div></div>`,
    `<div class="boot-foot">${foot.join('')}<span class="boot-account"></span></div>`,
  ].join('');
}

const atOrBelow = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

function routeSection(manifest: RouteManifest, route: RouteManifest['APP_ROUTES'][number]) {
  const path = route.collection ?? route.path;
  if (atOrBelow(path, '/agent')) return 'Agent';
  const group = manifest.DASHBOARD_SIDEBAR_GROUPS.find(({ group }) =>
    manifest
      .navDestinations(`sidebar:${group}`)
      .some((entry) => atOrBelow(path, entry.href.split('?')[0] ?? entry.href)),
  );
  return group?.title ?? 'Workspace';
}

export function bootTitleScript(manifest: RouteManifest): string {
  const routes = manifest.APP_ROUTES.map((route) => [
    route.path,
    route.shell,
    route.shell && route.title ? route.title : null,
    routeSection(manifest, route),
  ]);
  return `// Generated at build from lib/navigation/app-routes.ts by apps/app/boot-shell.ts.
try {
  const routes = ${JSON.stringify(routes)};
  const path = location.pathname;
  const parts = (value) => value.split('/').filter(Boolean);
  const have = parts(path);
  const matches = (pattern) => {
    const want = parts(pattern);
    return want.length === have.length && want.every((part, i) => part[0] === ':' || part === have[i]);
  };
  let route = routes.find(([pattern]) => matches(pattern));
  if (!route) {
    for (const entry of routes) {
      if (entry[0].includes(':') || !path.startsWith(entry[0] + '/')) continue;
      if (!route || entry[0].length > route[0].length) route = entry;
    }
  }
  const shell = document.querySelector('.boot-shell');
  const title = route ? route[2] : null;
  // A flow path (sign-in, setup, the chooser) keeps the bare ground; any
  // other path is the shell's, as the router's first frame decides.
  if (shell && (!route || route[1])) shell.dataset.bootShell = '';
  if (shell && title) {
    shell.dataset.bootMode = path === '/agent' || path.startsWith('/agent/') ? 'agent' : 'dashboard';
    const heading = shell.querySelector('.boot-title');
    if (heading) heading.textContent = title;
    const section = shell.querySelector('.boot-section');
    if (section) section.textContent = route[3];
    document.title = title + ' · CiteLadder';
  }
  try {
    const width = Number(localStorage.getItem('citeladder:app:sidebar-width'));
    if (shell && width > 0) {
      shell.style.setProperty('--boot-side-width', Math.min(480, Math.max(200, Math.round(width))) + 'px');
    }
  } catch {
    // Storage blocked: the boot sidebar keeps the default width, as the shell does.
  }
} catch {
  // The boot shell stays untitled; the bundle titles the page.
}
`;
}
