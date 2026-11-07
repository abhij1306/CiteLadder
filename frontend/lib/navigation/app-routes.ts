/**
 * The app's route manifest: every destination the browser can open, declared
 * once. The router, the sidebar, the command palette, the user menu, page
 * titles, the workspace-only test, the project-switch landing and the mode
 * homes all derive from it, so adding or renaming a screen is one edit here.
 *
 * Data only: no React at runtime and no static domain import. Each screen is a
 * `() => import()` so the shell's boot download carries none of them.
 */
import type { ComponentType } from 'react';

import type { IconName } from '@/lib/icons';
import type { NavigationMode } from '@/lib/navigation/mode-memory';

/**
 * Who a destination belongs to: `workspace` manages the workspace (reachable
 * with no project at all); `project` works inside the active project.
 */
type RouteScope = 'workspace' | 'project';

type DashboardGroup = 'overview' | 'analyze' | 'act' | 'track' | 'setup';
type PaletteGroup = 'Overview' | 'Analyze' | 'Track' | 'Agent' | 'Settings';

/**
 * Where a nav entry is listed: a Dashboard sidebar group, Agent mode's fixed
 * destinations, a command-palette group, or the user menu.
 */
type NavPlacement =
  | `dashboard:${DashboardGroup}`
  | 'agent'
  | `palette:${PaletteGroup}`
  | 'user-menu';

/** One way into a destination. A route may have several (a settings tab). */
type NavEntry = {
  label: string;
  icon: IconName;
  /** Query the entry adds to the route's path, e.g. `tab=integrations`. */
  search?: string;
  /** A live count shown beside the label. */
  badge?: 'open-actions';
  /** Listed after the placement's other entries rather than in manifest order. */
  listedLast?: true;
  placements: readonly NavPlacement[];
};

type Screen = () => Promise<{ default: ComponentType }>;

export type AppRouteRecord = {
  /** A React Router pattern; `:name` segments match one path segment. */
  path: string;
  /** The page header and document title; null where the route draws its own. */
  title: string | null;
  scope: RouteScope;
  /** Drawn inside the application shell (sidebar, header). */
  shell: boolean;
  mode: NavigationMode;
  /** The destination its mode opens on. */
  modeHome?: true;
  screen: Screen;
  /**
   * For a path naming one project's record: the section a project switch
   * lands on, since the next project does not have that record.
   */
  collection?: string;
  nav?: readonly NavEntry[];
};

/** Pick one named export of a lazily loaded module as the route's screen. */
function pick<M, K extends keyof M>(
  load: () => Promise<M>,
  name: K,
): () => Promise<{ default: M[K] }> {
  return () => load().then((module) => ({ default: module[name] }));
}

type RouteInput<P extends string> = Partial<Omit<AppRouteRecord, 'path' | 'screen'>> & {
  path: P;
  screen: Screen;
};

/** A destination; unless it says otherwise, a project page in the shell's Dashboard mode. */
function page<const P extends string>(input: RouteInput<P>): AppRouteRecord & { path: P } {
  return { title: null, scope: 'project', shell: true, mode: 'dashboard', ...input };
}

/** A page outside the shell: a setup flow step. */
function flow<const P extends string>(path: P, screen: Screen): AppRouteRecord & { path: P } {
  return page({ path, scope: 'workspace', shell: false, screen });
}
/** A nav entry listed in a Dashboard group and the matching palette group. */
function listed(label: string, icon: IconName, group: 'analyze' | 'track'): NavEntry {
  const palette = group === 'analyze' ? 'palette:Analyze' : 'palette:Track';
  return { label, icon, placements: [`dashboard:${group}`, palette] };
}

/** Every screen's loader, named once; a route refers to its screen by name. */
const screens = {
  onboarding: pick(
    () => import('@/components/onboarding/onboarding-page-client'),
    'OnboardingPageClient',
  ),
  projects: pick(() => import('@/components/projects/projects-screen'), 'ProjectsScreen'),
  site: pick(() => import('@/components/site-health/site-health-screen'), 'SiteHealthScreen'),
  pageDetail: pick(() => import('@/components/site-health/url-detail'), 'PageDetailScreen'),
  demand: pick(() => import('@/components/demand/demand-projection'), 'DemandProjection'),
  issues: pick(() => import('@/components/site-health/issues-screen'), 'IssuesScreen'),
  keywords: pick(
    () => import('@/components/search-intelligence/search-intelligence-page'),
    'SearchIntelligencePage',
  ),
  performance: pick(
    () => import('@/components/performance/performance-screen'),
    'PerformanceScreen',
  ),
  products: pick(() => import('@/components/products/products-screen'), 'ProductsScreen'),
  newChat: pick(() => import('@/components/agent/new-chat-screen'), 'NewChatScreen'),
  chat: pick(() => import('@/components/agent/chat-screen'), 'ChatScreen'),
  actions: pick(() => import('@/components/agent/actions-screen'), 'ActionsScreen'),
  action: pick(() => import('@/components/agent/action-detail-screen'), 'ActionDetailScreen'),
  skills: pick(() => import('@/components/agent/skills-screen'), 'SkillsScreen'),
  context: pick(() => import('@/components/agent/context-screen'), 'ContextScreen'),
  prompts: pick(() => import('@/components/prompts/prompts-route-content'), 'PromptsRouteContent'),
  prompt: pick(() => import('@/components/prompts/prompt-detail-screen'), 'PromptDetailScreen'),
  visibility: pick(() => import('@/components/visibility/visibility-screen'), 'VisibilityScreen'),
  runs: pick(() => import('@/components/runs/runs-screen'), 'RunsScreen'),
  run: pick(() => import('@/components/runs/run-detail-screen'), 'RunDetailScreen'),
  aiTraffic: pick(() => import('@/components/ai-traffic/ai-traffic-screen'), 'AiTrafficScreen'),
  settings: pick(() => import('@/components/settings/settings-screen'), 'SettingsScreen'),
} satisfies Record<string, Screen>;

export const APP_ROUTES = [
  // Before the shell opens.
  flow('/onboarding', screens.onboarding),

  // The application shell, in the order of the product loop.
  page({
    path: '/projects',
    title: 'Overview',
    modeHome: true,
    screen: screens.projects,
    nav: [
      {
        label: 'Overview',
        icon: 'overview',
        placements: ['dashboard:overview', 'palette:Overview'],
      },
    ],
  }),
  page({
    path: '/site',
    title: 'Website',
    screen: screens.site,
    nav: [listed('Website', 'site', 'analyze')],
  }),
  page({
    path: '/site/crawls/:crawlId/pages/:siteUrlId',
    title: 'Page detail',
    collection: '/site',
    screen: screens.pageDetail,
  }),
  page({
    path: '/demand',
    title: 'Search Demand',
    screen: screens.demand,
    nav: [listed('Search Demand', 'demand', 'analyze')],
  }),
  page({
    path: '/issues',
    title: 'Issues',
    screen: screens.issues,
    nav: [listed('Issues', 'issues', 'analyze')],
  }),
  page({
    path: '/search-intelligence',
    title: 'Keyword Research',
    screen: screens.keywords,
    nav: [listed('Keyword Research', 'searchIntelligence', 'analyze')],
  }),
  page({
    path: '/performance',
    title: 'Performance',
    screen: screens.performance,
    nav: [listed('Performance', 'performance', 'analyze')],
  }),
  page({
    path: '/products',
    title: 'Commerce Suite',
    screen: screens.products,
    nav: [listed('Commerce Suite', 'products', 'analyze')],
  }),
  page({
    path: '/agent',
    title: 'New chat',
    mode: 'agent',
    modeHome: true,
    screen: screens.newChat,
    // Agent mode draws New chat above its fixed destinations itself.
    nav: [{ label: 'New chat', icon: 'newChat', placements: ['palette:Agent'] }],
  }),
  page({
    path: '/agent/chats/:chatId',
    title: 'Agent',
    mode: 'agent',
    collection: '/agent',
    screen: screens.chat,
  }),
  page({
    path: '/agent/actions',
    title: 'Actions',
    mode: 'agent',
    screen: screens.actions,
    // Listed once in the palette, under Agent.
    nav: [
      {
        label: 'Actions',
        icon: 'opportunities',
        badge: 'open-actions',
        placements: ['dashboard:act', 'agent', 'palette:Agent'],
      },
    ],
  }),
  page({
    path: '/agent/actions/:actionId',
    title: 'Actions',
    mode: 'agent',
    collection: '/agent/actions',
    screen: screens.action,
  }),
  page({
    path: '/agent/skills',
    title: 'Skills',
    mode: 'agent',
    screen: screens.skills,
    nav: [{ label: 'Skills', icon: 'skills', placements: ['agent', 'palette:Agent'] }],
  }),
  page({
    path: '/agent/context',
    title: 'Context',
    mode: 'agent',
    screen: screens.context,
    nav: [{ label: 'Context', icon: 'context', placements: ['agent', 'palette:Agent'] }],
  }),
  page({
    path: '/prompts',
    title: 'Prompts',
    screen: screens.prompts,
    nav: [listed('Prompts', 'prompts', 'track')],
  }),
  page({
    path: '/prompts/:promptId',
    title: 'Prompts',
    collection: '/prompts',
    screen: screens.prompt,
  }),
  page({
    path: '/visibility',
    title: 'AI Visibility',
    screen: screens.visibility,
    nav: [listed('AI Visibility', 'visibility', 'track')],
  }),
  page({
    path: '/runs',
    title: 'Runs',
    screen: screens.runs,
    nav: [listed('Runs', 'runs', 'track')],
  }),
  page({
    path: '/runs/:runId',
    title: 'Run detail',
    collection: '/runs',
    screen: screens.run,
  }),
  page({
    path: '/ai-traffic',
    title: 'AI Traffic',
    screen: screens.aiTraffic,
    nav: [listed('AI Traffic', 'aiTraffic', 'track')],
  }),

  // The workspace's own pages, inside the shell.
  page({
    path: '/settings',
    title: 'Settings',
    scope: 'workspace',
    screen: screens.settings,
    nav: [
      { label: 'Settings', icon: 'settings', placements: ['palette:Settings', 'user-menu'] },
      {
        label: 'Integrations',
        icon: 'setup',
        search: 'tab=integrations',
        placements: ['dashboard:setup', 'palette:Settings'],
      },
      {
        label: 'Providers',
        icon: 'settings',
        search: 'tab=providers',
        placements: ['palette:Settings'],
      },
      {
        label: 'Connect AI assistants',
        icon: 'connect',
        search: 'tab=connections',
        listedLast: true,
        placements: ['user-menu'],
      },
    ],
  }),
];

export type AppRoutePath = (typeof APP_ROUTES)[number]['path'];

/** A manifest record, with its path known to be one of the manifest's. */
type AppRoute = AppRouteRecord & { path: AppRoutePath };

const ROUTES: readonly AppRoute[] = APP_ROUTES;

function segments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function matchesPattern(pattern: string, pathname: string): boolean {
  const want = segments(pattern);
  const have = segments(pathname);
  return (
    want.length === have.length &&
    want.every((segment, index) => segment.startsWith(':') || segment === have[index])
  );
}

/** The route whose pattern matches the whole pathname, if any. */
export function findAppRoute(pathname: string): AppRoute | undefined {
  return ROUTES.find((route) => matchesPattern(route.path, pathname));
}

/**
 * The route the pathname belongs to: its own route, or else the deepest
 * parameter-free route it sits below. Every tab and unknown sub-path of
 * Website is still Website.
 */
function sectionRoute(pathname: string): AppRoute | undefined {
  const own = findAppRoute(pathname);
  if (own) return own;
  let best: AppRoute | undefined;
  for (const route of ROUTES) {
    if (route.path.includes(':') || !pathname.startsWith(`${route.path}/`)) continue;
    if (!best || route.path.length > best.path.length) best = route;
  }
  return best;
}

const FALLBACK_TITLE = 'CiteLadder';

/** The page header and document title for a pathname. */
export function resolveTitle(pathname: string): string {
  return sectionRoute(pathname)?.title ?? FALLBACK_TITLE;
}

/** Whether the path is one of the application shell's titled pages. */
export function hasPageTitle(pathname: string): boolean {
  const route = sectionRoute(pathname);
  return Boolean(route?.shell && route.title);
}

/** The shell mode a pathname is in; anything unknown is Dashboard. */
export function navigationMode(pathname: string): NavigationMode {
  return sectionRoute(pathname)?.mode ?? 'dashboard';
}

/**
 * Whether the route manages the WORKSPACE rather than working inside a project.
 *
 * A workspace with no projects is a valid workspace: its settings stay
 * reachable, and project creation itself must not redirect to itself.
 */
export function isWorkspaceOnlyRoute(pathname: string | null): boolean {
  return pathname ? sectionRoute(pathname)?.scope === 'workspace' : false;
}

/**
 * Where a project switch lands from this pathname. A path naming one
 * project's crawl, run, prompt, chat or Action would ask the next project for
 * a record it does not have, so it lands on that section's collection.
 */
export function projectSwitchPathname(pathname: string): string {
  return findAppRoute(pathname)?.collection ?? pathname;
}

function modeHome(mode: NavigationMode): string {
  const home = ROUTES.find((route) => route.mode === mode && route.modeHome);
  if (!home) throw new Error(`No home route for ${mode} mode`);
  return home.path;
}

export const MODE_HOMES: Readonly<Record<NavigationMode, string>> = {
  dashboard: modeHome('dashboard'),
  agent: modeHome('agent'),
};

/** A nav entry with its full address and the scope its link carries. */
export type NavDestination = Pick<NavEntry, 'label' | 'icon' | 'badge'> & {
  href: string;
  scope: RouteScope;
};

/** Every entry listed at a placement, in manifest order (`listedLast` entries after). */
export function navDestinations(placement: NavPlacement): readonly NavDestination[] {
  const entries = ROUTES.flatMap((route) =>
    (route.nav ?? [])
      .filter((entry) => entry.placements.includes(placement))
      .map((entry) => ({ route, entry })),
  );
  return [
    ...entries.filter(({ entry }) => !entry.listedLast),
    ...entries.filter(({ entry }) => entry.listedLast),
  ].map(({ route, entry: { label, icon, badge, search } }) => ({
    label,
    icon,
    ...(badge ? { badge } : {}),
    href: search ? `${route.path}?${search}` : route.path,
    scope: route.scope === 'project' ? 'project' : 'workspace',
  }));
}
