/**
 * The `citeladder://<kind>/<id>` record kinds: the MCP retrieval allowlist,
 * the label a reader sees and the app screen that shows each kind. MCP
 * retrieval (`services/api/src/mcp/retrieval.ts`), its links
 * (`mcp/links.ts`) and the browser's evidence chips (`lib/agent/evidence.ts`)
 * all read this one table.
 *
 * `page` is a record's own screen, built from its fields; it answers null
 * when a field it needs is absent. The browser holds only a reference, so it
 * passes the id alone and a page that needs another field falls back to
 * `screen`; MCP passes the whole record.
 */

type Field = (name: string) => string;

type RecordKind = {
  label: string;
  screen: string;
  page?: (field: Field) => string | null;
};

const own = (path: string) => (field: Field) => (field('id') ? `${path}/${field('id')}` : null);

export const RECORD_KINDS = {
  project: { label: 'Project', screen: '/visibility' },
  prompt: { label: 'Prompt', screen: '/prompts' },
  opportunity: {
    label: 'Recommendation',
    screen: '/agent/actions',
    page: (field) => (field('action_id') ? `/agent/actions/${field('action_id')}` : null),
  },
  action: { label: 'Action', screen: '/agent/actions', page: own('/agent/actions') },
  audit: { label: 'Visibility run', screen: '/runs', page: own('/runs') },
  visibility_result: {
    label: 'Visibility answer',
    screen: '/visibility',
    page: (field) => (field('audit_id') ? `/runs/${field('audit_id')}` : null),
  },
  site_snapshot: { label: 'Site Health snapshot', screen: '/site' },
  site_crawl: { label: 'Site crawl', screen: '/site' },
  site_page: {
    label: 'Site page',
    screen: '/site',
    page: (field) =>
      field('crawl_id') && field('site_url_id')
        ? `/site/crawls/${field('crawl_id')}/pages/${field('site_url_id')}`
        : null,
  },
  site_issue: { label: 'Site Health issue', screen: '/site' },
  site_link: { label: 'Internal link', screen: '/site' },
  traffic_snapshot: { label: 'Traffic snapshot', screen: '/performance' },
  demand_snapshot: { label: 'Search Demand snapshot', screen: '/demand' },
  query_snapshot: { label: 'Search Console snapshot', screen: '/performance' },
  query_row: { label: 'Search Console query', screen: '/performance' },
  search_run: { label: 'Keyword Research run', screen: '/search-intelligence' },
  search_dataset: { label: 'Keyword Research dataset', screen: '/search-intelligence' },
  search_row: { label: 'Keyword Research row', screen: '/search-intelligence' },
} as const satisfies Record<string, RecordKind>;

export type RecordKindName = keyof typeof RECORD_KINDS;

export function isRecordKind(kind: string): kind is RecordKindName {
  return Object.hasOwn(RECORD_KINDS, kind);
}

/** The screen that shows one record: its own page when its fields allow, else its kind's screen. */
export function recordScreen(kind: RecordKindName, field: Field): string {
  const entry: RecordKind = RECORD_KINDS[kind];
  return entry.page?.(field) ?? entry.screen;
}
