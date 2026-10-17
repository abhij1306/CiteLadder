/**
 * Record references (`citeladder://<kind>/<id>`) as a reader sees them: a
 * labelled source and, where the product has one, the screen that shows it.
 * The references come from persisted replies and revisions; this never
 * resolves or fetches a record.
 */

type RecordKind = { label: string; screen: string; record?: (id: string) => string };

const RECORD_KIND: Record<string, RecordKind> = {
  opportunity: { label: 'Recommendation', screen: '/agent/actions' },
  action: { label: 'Action', screen: '/agent/actions', record: (id) => `/agent/actions/${id}` },
  audit: { label: 'Visibility run', screen: '/runs', record: (id) => `/runs/${id}` },
  visibility_result: { label: 'Visibility answer', screen: '/visibility' },
  citation: { label: 'Citation', screen: '/visibility' },
  prompt: { label: 'Prompt', screen: '/prompts' },
  site_snapshot: { label: 'Site Health snapshot', screen: '/site' },
  site_crawl: { label: 'Site crawl', screen: '/site' },
  site_page: { label: 'Site page', screen: '/site' },
  site_link: { label: 'Internal link', screen: '/site' },
  traffic_snapshot: { label: 'Traffic snapshot', screen: '/performance' },
  demand_snapshot: { label: 'Search Demand snapshot', screen: '/demand' },
  query_snapshot: { label: 'Search Console snapshot', screen: '/performance' },
  query_row: { label: 'Search Console query', screen: '/performance' },
  search_run: { label: 'Search Intelligence run', screen: '/search-intelligence' },
  search_dataset: { label: 'Search Intelligence dataset', screen: '/search-intelligence' },
  search_row: { label: 'Search Intelligence row', screen: '/search-intelligence' },
};

const FALLBACK_LABEL = 'CiteLadder record';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EvidenceGroup = { label: string; count: number; href: string | null };

function parse(ref: string): { kind: string; id: string } {
  if (!ref.startsWith('citeladder://')) return { kind: '', id: '' };
  const [kind = '', id = ''] = ref.slice('citeladder://'.length).split('/');
  return { kind, id };
}

/**
 * References grouped by kind, in first-cited order. A group links to its
 * screen; a single record links to its own page when it has one.
 */
export function groupEvidence(refs: readonly string[]): EvidenceGroup[] {
  const groups = new Map<string, { kind: RecordKind | undefined; ids: string[] }>();
  for (const ref of new Set(refs)) {
    const { kind, id } = parse(ref);
    const known = RECORD_KIND[kind];
    const label = known?.label ?? FALLBACK_LABEL;
    const group = groups.get(label) ?? { kind: known, ids: [] };
    group.ids.push(id);
    groups.set(label, group);
  }
  return [...groups].map(([label, { kind, ids }]) => {
    const single = ids.length === 1 && UUID.test(ids[0] ?? '') ? ids[0] : undefined;
    let href = kind?.screen ?? null;
    if (single && kind?.record) href = kind.record(single);
    return { label, count: ids.length, href };
  });
}
