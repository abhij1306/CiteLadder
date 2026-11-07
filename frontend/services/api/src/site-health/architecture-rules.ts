import type { PageKindEvidence, PageListEvidence } from '@citeladder/contracts/site-health';
import { policy } from '../config.ts';
import { compareText } from '../text-order.ts';
import type { ArchitecturePage, buildArchitecture } from './architecture-model.ts';

const p = policy.site_health.architecture;

/** The bounded sample a finding names: its pages or its page kinds. */
type Sample = Pick<PageListEvidence, 'pages'> | Pick<PageKindEvidence, 'page_kinds'>;
const pageSample = (pages: PageListEvidence['pages']) => ({ pages });
const kindSample = (page_kinds: PageKindEvidence['page_kinds']) => ({ page_kinds });

/**
 * The affected pages of each page kind, over every row rather than the bounded
 * sample: the Issues page-kind filter counts a site-level finding by these.
 */
function pageKindCounts<Row extends { page_kind: string }>(
  rows: readonly Row[],
  pagesOf: (row: Row) => number = () => 1,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows)
    if (row.page_kind) counts[row.page_kind] = (counts[row.page_kind] ?? 0) + pagesOf(row);
  return counts;
}

function evaluation<Row extends { page_kind: string }>(
  id: string,
  rows: Row[],
  sample: (rows: Row[]) => Sample,
  coverage: string,
  requiresComplete = false,
  pagesOf?: (row: Row) => number,
) {
  const rule = policy.site_health.rule_catalog.find((item) => item.rule_id === id);
  if (!rule) throw new Error(`Architecture rule '${id}' is absent from its catalog`);
  const unavailable = requiresComplete && coverage !== 'complete';
  let outcome = rows.length ? 'missing' : 'satisfied';
  if (unavailable) outcome = 'unknown';
  return {
    rule,
    outcome,
    reason: unavailable ? 'coverage_not_complete' : '',
    evidence: unavailable
      ? { reason: 'coverage_not_complete', coverage_state: coverage }
      : ({
          count: rows.length,
          ...sample(rows.slice(0, p.max_evidence_items)),
          page_kind_counts: pageKindCounts(rows, pagesOf),
          coverage_state: coverage,
        } satisfies PageListEvidence | PageKindEvidence),
  };
}
/** The first two path segments: `/blogs/testimonials/a-review` is `/blogs/testimonials`. */
function sectionOf(url: string) {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    return `/${segments.slice(0, 2).join('/')}`;
  } catch {
    return '/';
  }
}

/** Unreachable pages grouped by section, largest first, each with one example. */
function sections(pages: { url: string }[]) {
  const groups = new Map<
    string,
    { path_prefix: string; page_count: number; example_url: string }
  >();
  for (const page of pages) {
    const prefix = sectionOf(page.url);
    const group = groups.get(prefix);
    if (group) group.page_count += 1;
    else groups.set(prefix, { path_prefix: prefix, page_count: 1, example_url: page.url });
  }
  return [...groups.values()]
    .sort((a, b) => b.page_count - a.page_count || compareText(a.path_prefix, b.path_prefix))
    .slice(0, p.max_evidence_items);
}

/**
 * Pages other pages link to but no link path from the homepage reaches: a
 * section linked only from itself. Orphans (no inbound link at all) are
 * `architecture.orphan_pages`, so they never repeat here. Without an observed
 * homepage no page has a depth, and nothing can be called unreachable.
 */
function unreachableFromHome(
  pages: ReturnType<typeof buildArchitecture>['hierarchy'],
  byId: Map<string, ArchitecturePage>,
  coverage: string,
) {
  const unreachable = pages.filter(
    (page) =>
      page.page_kind !== 'homepage' &&
      page.depth_from_home === null &&
      byId.get(page.site_url_id)!.inbound > 0,
  );
  const result = evaluation(
    'architecture.unreachable_from_home',
    unreachable,
    pageSample,
    coverage,
    true,
  );
  if (result.outcome === 'unknown') return result;
  if (!pages.some((page) => page.depth_from_home === 0))
    return {
      ...result,
      outcome: 'unknown',
      reason: 'homepage_not_observed',
      evidence: { reason: 'homepage_not_observed', coverage_state: coverage },
    };
  return { ...result, evidence: { ...result.evidence, sections: sections(unreachable) } };
}

export function architectureRules(
  model: ReturnType<typeof buildArchitecture>,
  source: ArchitecturePage[],
  coverage: string,
) {
  const pages = model.hierarchy;
  const kinds = model.page_kinds;
  const byId = new Map(source.map((page) => [page.id, page]));
  const parents = new Map(pages.map((page) => [page.site_url_id, page.parent_site_url_id]));
  return [
    evaluation(
      'architecture.excessive_depth',
      pages.filter(
        (page) => page.depth_from_home !== null && page.depth_from_home >= p.excessive_depth_min,
      ),
      pageSample,
      coverage,
      // Depth is shortest path over the observed graph: a link the crawl did
      // not see can only make a page shallower, so it needs complete coverage.
      true,
    ),
    evaluation(
      'architecture.breadcrumb_hierarchy_conflict',
      pages.filter(
        (page) =>
          page.breadcrumb_parent_site_url_id &&
          page.explicit_parent_site_url_id &&
          page.breadcrumb_parent_site_url_id !== page.explicit_parent_site_url_id,
      ),
      pageSample,
      coverage,
    ),
    evaluation(
      'architecture.duplicate_metadata_in_page_kind',
      kinds.filter(
        (kind) =>
          kind.page_count >= p.duplicate_metadata_min_urls &&
          kind.duplicate_metadata_count / kind.page_count >= p.duplicate_metadata_rate,
      ),
      kindSample,
      coverage,
      false,
      // The finding is the duplicated pages, as its group counts them.
      (kind) => kind.duplicate_metadata_count,
    ),
    evaluation(
      'architecture.orphan_pages',
      pages.filter(
        (page) => page.page_kind !== 'homepage' && byId.get(page.site_url_id)!.inbound === 0,
      ),
      pageSample,
      coverage,
      true,
    ),
    unreachableFromHome(pages, byId, coverage),
    evaluation(
      'architecture.parentless_detail_pages',
      pages.filter(
        (page) => p.detail_page_kinds.includes(page.page_kind) && page.parent_site_url_id === null,
      ),
      pageSample,
      coverage,
      true,
    ),
    evaluation(
      'architecture.unhubbed_page_kind',
      kinds.filter(
        (kind) =>
          kind.page_count >= p.unhubbed_page_kind_min_urls &&
          kind.site_url_ids.every(
            (id) => p.detail_page_kinds.includes(byId.get(id)!.kind) && parents.get(id) === null,
          ),
      ),
      kindSample,
      coverage,
      true,
      (kind) => kind.page_count,
    ),
  ];
}
