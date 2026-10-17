/**
 * Route → page title map, and the resolver the shell's top bar uses.
 *
 * Exact patterns first; everything else is a longest-prefix match. Titles live
 * here (not on the pages themselves) so there is a single title surface for the
 * whole authed area — the sibling of `nav-items.ts`, and, like it, a data module
 * rather than a component so editing `page-shell.tsx` can still Fast Refresh.
 * The shell also names the document from it.
 *
 * Copy is sentence case and plain language: product nouns keep their
 * capitalisation, everything else reads like a sentence.
 */
const PAGE_TITLES: ReadonlyArray<readonly [prefix: string, title: string]> = [
  ['/visibility', 'AI Visibility'],
  ['/ai-traffic', 'AI Traffic'],
  ['/performance', 'Performance'],
  ['/prompts', 'Prompts'],
  ['/agent/actions', 'Actions'],
  ['/agent/skills', 'Skills'],
  ['/agent/context', 'Context'],
  ['/agent/chats', 'Agent'],
  ['/agent', 'New chat'],
  ['/products', 'Commerce Suite'],
  ['/runs', 'Runs'],
  ['/projects', 'Overview'],
  ['/site', 'Website'],
  ['/demand', 'Search Demand'],
  ['/search-intelligence', 'Search Intelligence'],
  ['/issues', 'Issues'],
  ['/settings', 'Settings'],
];

/** Deeper-route overrides (checked before the prefix table). */
const EXACT_OVERRIDES: ReadonlyArray<readonly [pattern: RegExp, title: string]> = [
  [/^\/site\/crawls\/[^/]+\/pages\/[^/]+$/, 'Page detail'],
  [/^\/runs\/[^/]+$/, 'Run detail'],
];

export function resolveTitle(pathname: string): string {
  for (const [pattern, title] of EXACT_OVERRIDES) {
    if (pattern.test(pathname)) return title;
  }
  for (const [prefix, title] of PAGE_TITLES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return title;
  }
  return 'CiteLadder';
}
