import type { IconName } from '@/lib/icons';
import type {
  AppRouteRecord,
  NavDestination,
  NavEntry,
  NavPlacement,
  RouteLoading,
  Screen,
  SidebarGroup,
} from './route-types';
import { CONTEXT_TABS } from '../agent/context-tabs.ts';
import { TRAFFIC_TABS } from '../ai-traffic/tabs.ts';
import { PUBLIC_PERCEPTION_TABS } from '../perception/tabs.ts';
import { SEARCH_INTELLIGENCE_TABS } from '../search-intelligence/tabs.ts';
import { SETTINGS_TABS } from '../settings/tabs.ts';
import { SITE_HEALTH_TABS } from '../site-health/tabs.ts';
import { VISIBILITY_TABS } from '../visibility/tabs.ts';

export const DASHBOARD_SIDEBAR_GROUPS = [
  { group: 'home', title: 'Home' },
  { group: 'brand', title: 'Brand' },
  { group: 'tracking', title: 'Tracking' },
  { group: 'website', title: 'Website' },
  { group: 'search', title: 'Search' },
  { group: 'commerce', title: 'Commerce' },
] as const satisfies readonly { group: SidebarGroup; title: string }[];

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

function page<const P extends string>(input: RouteInput<P>): AppRouteRecord & { path: P } {
  return { title: null, scope: 'project', shell: true, ...input };
}

/** A page outside the shell: a setup flow step. */
function flow<const P extends string>(path: P, screen: Screen): AppRouteRecord & { path: P } {
  return page({ path, scope: 'workspace', shell: false, screen });
}

/** A nav entry listed in a sidebar group and, outside Agent, the matching palette group. */
function listed(label: string, icon: IconName, group: Exclude<SidebarGroup, 'foot'>): NavEntry {
  return {
    label,
    icon,
    placements: group === 'agent' ? ['sidebar:agent'] : [`sidebar:${group}`, `palette:${group}`],
  };
}

const screens = {
  onboarding: pick(
    () => import('@/components/onboarding/onboarding-page-client'),
    'OnboardingPageClient',
  ),
  projects: pick(() => import('@/components/projects/projects-screen'), 'ProjectsScreen'),
  site: pick(() => import('@/components/site-health/site-health-screen'), 'SiteHealthScreen'),
  pageDetail: pick(() => import('@/components/site-health/url-detail'), 'PageDetailScreen'),
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
  shoppingOverview: pick(
    () => import('@/components/products/shopping-overview-screen'),
    'ShoppingOverviewScreen',
  ),
  product: pick(() => import('@/components/products/product-detail-screen'), 'ProductDetailScreen'),
  newChat: pick(() => import('@/components/agent/new-chat-screen'), 'NewChatScreen'),
  chat: pick(() => import('@/components/agent/chat-screen'), 'ChatScreen'),
  actions: pick(() => import('@/components/agent/actions-list-screen'), 'ActionsScreen'),
  action: pick(() => import('@/components/agent/action-detail-screen'), 'ActionDetailScreen'),
  actionUrl: pick(() => import('@/components/agent/action-url-screen'), 'ActionUrlScreen'),
  skills: pick(() => import('@/components/agent/skills-screen'), 'SkillsScreen'),
  context: pick(() => import('@/components/agent/context-screen'), 'ContextScreen'),
  insights: pick(() => import('@/components/brand/insights-screen'), 'InsightsScreen'),
  perception: pick(() => import('@/components/perception/perception-screen'), 'PerceptionScreen'),
  competitors: pick(() => import('@/components/brand/competitors-screen'), 'CompetitorsScreen'),
  competitor: pick(() => import('@/components/brand/competitor-screen'), 'CompetitorScreen'),
  prompts: pick(() => import('@/components/prompts/prompt-library'), 'PromptLibrary'),
  promptBuilder: pick(
    () => import('@/components/prompts/prompt-builder-page'),
    'PromptBuilderPage',
  ),
  prompt: pick(() => import('@/components/prompts/prompt-detail-screen'), 'PromptDetailScreen'),
  visibility: pick(
    () => import('@/components/visibility/visibility-dashboard'),
    'VisibilityDashboard',
  ),
  runs: pick(() => import('@/components/runs/runs-screen'), 'RunsScreen'),
  run: pick(() => import('@/components/runs/run-detail-screen'), 'RunDetailScreen'),
  aiTraffic: pick(() => import('@/components/ai-traffic/ai-traffic-screen'), 'AiTrafficScreen'),
  settings: pick(() => import('@/components/settings/settings-screen'), 'SettingsScreen'),
} satisfies Record<string, Screen>;

export const APP_ROUTES = [
  // Before the shell opens.
  flow('/onboarding', screens.onboarding),

  page({
    path: '/projects',
    width: 'narrow',
    title: 'Overview',
    screen: screens.projects,
    loading: { kind: 'overview' },
    nav: [listed('Overview', 'overview', 'home')],
  }),
  page({
    path: '/site',
    title: 'Site health',
    screen: screens.site,
    loading: cards([figures(), table(6)], {
      tabs: held('tab', SITE_HEALTH_TABS),
    }),
    nav: [listed('Site health', 'site', 'website')],
  }),
  page({
    path: '/site/crawls/:crawlId/pages/:siteUrlId',
    width: 'narrow',
    title: 'Page detail',
    collection: '/site',
    screen: screens.pageDetail,
    loading: cards([facts(3, [1]), figures(3)]),
  }),
  page({
    path: '/issues',
    width: 'narrow',
    title: 'Issues',
    screen: screens.issues,
    loading: { kind: 'issues' },
    nav: [listed('Issues', 'issues', 'website')],
  }),
  page({
    path: '/performance',
    title: 'Performance',
    screen: screens.performance,
    loading: cards([figures(4), chart], { filters: true }),
    nav: [listed('Performance', 'performance', 'search')],
  }),
  page({
    path: '/search-intelligence',
    title: 'Keyword research',
    screen: screens.keywords,
    loading: cards([table(8)], {
      tabs: held('tab', SEARCH_INTELLIGENCE_TABS),
      filters: true,
    }),
    nav: [listed('Keyword research', 'searchIntelligence', 'search')],
  }),
  // Commerce: Shopping, then the Products table. Shopping is declared before
  // `/products/:targetId`, which would otherwise match it.
  page({
    path: '/products/overview',
    title: 'Shopping',
    screen: screens.shoppingOverview,
    loading: cards([figures(2), table(5)], { filters: true }),
    nav: [listed('Shopping', 'reports', 'commerce')],
  }),
  page({
    path: '/products',
    title: 'Products',
    screen: screens.products,
    loading: cards([figures(4), table(8)], { filters: true }),
    nav: [listed('Products', 'products', 'commerce')],
  }),
  page({
    path: '/products/:targetId',
    title: 'Product',
    collection: '/products',
    screen: screens.product,
    loading: cards([facts(1), figures(6)]),
  }),
  page({
    path: '/actions',
    width: 'narrow',
    title: 'Actions',
    screen: screens.actions,
    loading: cards([figures(4), table(3)], { filters: true, intro: true, stacked: true }),
    nav: [
      {
        label: 'Actions',
        icon: 'opportunities',
        badge: 'open-actions',
        placements: ['sidebar:home'],
      },
    ],
  }),
  page({
    path: '/actions/:actionId',
    width: 'narrow',
    title: 'Action',
    collection: '/actions',
    screen: screens.action,
    loading: cards([facts(5)]),
  }),
  page({
    path: '/actions/urls/:siteUrlId',
    width: 'narrow',
    title: 'URL',
    collection: '/actions',
    screen: screens.actionUrl,
    loading: cards([facts(3)]),
  }),
  page({
    path: '/insights',
    title: 'Insights',
    screen: screens.insights,
    loading: cards([figures(3), chart], { filters: true }),
    nav: [listed('Insights', 'insights', 'brand')],
  }),
  page({
    path: '/perception',
    title: 'Perception',
    screen: screens.perception,
    loading: cards([figures(4), chart], {
      tabs: held('tab', PUBLIC_PERCEPTION_TABS),
      filters: true,
    }),
    nav: [
      listed('Perception', 'perception', 'brand'),
      {
        label: 'Fact-checking',
        icon: 'factChecking',
        search: 'tab=fact-checking',
        placements: ['palette:brand'],
      },
    ],
  }),
  page({
    path: '/competitors',
    title: 'Competitors',
    screen: screens.competitors,
    loading: cards([table(7), table(4)], { filters: true }),
    nav: [listed('Competitors', 'competitors', 'brand')],
  }),
  page({
    path: '/competitors/:name',
    title: 'Competitor',
    collection: '/competitors',
    screen: screens.competitor,
    loading: cards([figures(5), chart, table(3)], { filters: true }),
  }),
  page({
    path: '/agent',
    width: 'narrow',
    title: 'Agent',
    screen: screens.newChat,
    loading: { kind: 'new-chat' },
    nav: [{ label: 'New chat', icon: 'newChat', placements: ['sidebar:agent'] }],
  }),
  page({
    path: '/agent/chats/:chatId',
    width: 'narrow',
    title: 'Chat',
    collection: '/agent',
    screen: screens.chat,
    loading: { kind: 'thread' },
  }),
  page({
    path: '/agent/skills',
    width: 'narrow',
    title: 'Skills',
    screen: screens.skills,
    loading: cards([table(4)]),
    nav: [listed('Skills', 'skills', 'agent')],
  }),
  page({
    path: '/agent/context',
    width: 'narrow',
    title: 'Context',
    screen: screens.context,
    loading: cards([facts(5)], { rail: { ...held('tab', CONTEXT_TABS), wide: ['map'] } }),
    nav: [listed('Context', 'context', 'agent')],
  }),
  page({
    path: '/prompts',
    title: 'Prompts',
    screen: screens.prompts,
    loading: cards([table(8)], {
      tabs: held('status', [tab('active', 'Active'), tab('archived', 'Archived')]),
      filters: true,
    }),
    nav: [listed('Prompts', 'prompts', 'tracking')],
  }),
  // Before `/prompts/:promptId`, so `build` is never read as a prompt id.
  page({
    path: '/prompts/build',
    title: 'Prompt builder',
    screen: screens.promptBuilder,
    loading: cards([facts(6)]),
    nav: [listed('Prompt builder', 'promptBuilder', 'tracking')],
  }),
  page({
    path: '/prompts/:promptId',
    title: 'Prompt',
    collection: '/prompts',
    screen: screens.prompt,
    loading: cards([figures(7), chart], { filters: true }),
  }),
  page({
    path: '/visibility',
    title: 'Sources',
    screen: screens.visibility,
    loading: cards([table(8), chart], {
      tabs: held(
        'tab',
        VISIBILITY_TABS.map(({ id, label }) => tab(id, label)),
      ),
      filters: true,
    }),
    nav: [
      listed('Sources', 'visibility', 'tracking'),
      {
        label: 'Query fanouts',
        icon: 'queryFanouts',
        search: 'tab=query-fanout',
        placements: ['palette:tracking'],
      },
    ],
  }),
  page({
    path: '/runs',
    width: 'compact',
    title: 'Runs',
    screen: screens.runs,
    loading: cards([table(5)], {
      tabs: held('status', [
        tab('all', 'All'),
        tab('completed', 'Completed'),
        tab('running', 'Running'),
        tab('failed', 'Failed'),
      ]),
    }),
    nav: [listed('Runs', 'runs', 'tracking')],
  }),
  page({
    path: '/runs/:runId',
    title: 'Run',
    collection: '/runs',
    screen: screens.run,
    loading: cards([figures(3), table(5)]),
  }),
  page({
    path: '/ai-traffic',
    title: 'AI traffic',
    screen: screens.aiTraffic,
    loading: cards([figures(5), chart], {
      filters: true,
      tabs: held('tab', TRAFFIC_TABS),
    }),
    nav: [listed('AI traffic', 'aiTraffic', 'website')],
  }),

  page({
    path: '/settings',
    width: 'narrow',
    title: 'Settings',
    scope: 'workspace',
    screen: screens.settings,
    loading: cards([facts(3)], { rail: held('tab', SETTINGS_TABS) }),
    nav: [
      {
        label: 'Integrations',
        icon: 'setup',
        search: 'tab=integrations',
        placements: ['sidebar:foot'],
      },
      { label: 'Settings', icon: 'settings', placements: ['account'] },
      {
        label: 'Providers',
        icon: 'settings',
        search: 'tab=providers',
        placements: ['palette'],
      },
      {
        label: 'MCP connections',
        icon: 'connect',
        search: 'tab=connections',
        listedLast: true,
        placements: ['account'],
      },
    ],
  }),
];

export type AppRoutePath = (typeof APP_ROUTES)[number]['path'];

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

export function findAppRoute(pathname: string): AppRoute | undefined {
  return ROUTES.find((route) => matchesPattern(route.path, pathname));
}

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

export function resolveTitle(pathname: string): string {
  return sectionRoute(pathname)?.title ?? FALLBACK_TITLE;
}

export function routeLoading(pathname: string): RouteLoading {
  return sectionRoute(pathname)?.loading ?? RECORD_LOADING;
}

export function routeWidth(pathname: string): NonNullable<AppRouteRecord['width']> | 'full' {
  return sectionRoute(pathname)?.width ?? 'full';
}

export function hasPageTitle(pathname: string): boolean {
  const route = sectionRoute(pathname);
  return Boolean(route?.shell && route.title);
}

export function isFlowPath(pathname: string): boolean {
  return sectionRoute(pathname)?.shell === false;
}

export const HOME_PATH = '/projects' satisfies AppRoutePath;

export function isAgentPath(pathname: string): boolean {
  return pathname === '/agent' || pathname.startsWith('/agent/');
}

export type NavigationMode = 'dashboard' | 'agent';

export function navigationMode(pathname: string): NavigationMode {
  return isAgentPath(pathname) ? 'agent' : 'dashboard';
}

export const MODE_HOMES = {
  dashboard: HOME_PATH,
  agent: '/agent',
} as const satisfies Record<NavigationMode, AppRoutePath>;

/**
 * Whether the route manages the WORKSPACE rather than working inside a project.
 *
 * A workspace with no projects is a valid workspace: its settings stay
 * reachable, and project creation itself must not redirect to itself.
 */
export function isWorkspaceOnlyRoute(pathname: string | null): boolean {
  return pathname ? sectionRoute(pathname)?.scope === 'workspace' : false;
}

export function projectSwitchPathname(pathname: string): string {
  return findAppRoute(pathname)?.collection ?? pathname;
}

export function workspaceSwitchPathname(pathname: string): string {
  return findAppRoute(pathname) ? projectSwitchPathname(pathname) : HOME_PATH;
}

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
