/** Conservative structure over a bounded observed crawl; no inferred missing pages. */
import { policy } from '../config.ts';
import { record } from '../db/json.ts';
import { compareText, stripTrailing } from '../text-order.ts';
import { onlyOf } from '../lists.ts';
import { assessArchetype } from './archetypes.ts';
import { canonicalUrl } from './url-identity.ts';

export type ArchitecturePage = {
  id: string;
  analysisId: string;
  artifactId: string;
  metricId: string;
  url: string;
  title: string;
  description: string;
  kind: string;
  depth: number | null;
  inbound: number;
  outbound: number;
  /** Outbound links placed in the page's main content, not its shared menus. */
  contentOutbound: number;
  indexable: boolean | null;
  facts: Record<string, unknown>;
};
const p = policy.site_health.architecture;
function normalized(value: string) {
  return value.toLowerCase().trim().replaceAll(/\s+/gu, ' ');
}
function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (!sorted.length) return null;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
function kindRow(kind: string, members: ArchitecturePage[]) {
  const signatures = new Map<string, number>();
  for (const page of members) {
    const title = normalized(page.title);
    const description = normalized(page.description);
    if (!title && !description) continue;
    const key = JSON.stringify([title, description]);
    signatures.set(key, (signatures.get(key) ?? 0) + 1);
  }
  return {
    page_kind: kind,
    page_count: members.length,
    median_depth: median(members.flatMap((page) => (page.depth === null ? [] : [page.depth]))),
    indexable_count: members.filter((page) => page.indexable === true).length,
    duplicate_metadata_count: [...signatures.values()]
      .filter((count) => count > 1)
      .reduce((sum, count) => sum + count, 0),
    orphan_count: members.filter((page) => page.kind !== 'homepage' && page.inbound === 0).length,
    site_url_ids: members.map((page) => page.id),
  };
}
function pageKinds(pages: ArchitecturePage[]) {
  const kinds = [...new Set(pages.map((page) => page.kind))].sort(compareText);
  return kinds.map((kind) =>
    kindRow(
      kind,
      pages.filter((page) => page.kind === kind),
    ),
  );
}
function linking(pages: ArchitecturePage[]) {
  const incoming = pages.filter((page) => page.inbound > 0).length;
  const orphans = pages.filter((page) => page.kind !== 'homepage' && page.inbound === 0);
  return {
    // Unique destinations per page, summed; site-wide menus repeat on every page.
    internal_link_count: pages.reduce((sum, page) => sum + page.outbound, 0),
    content_link_count: pages.reduce((sum, page) => sum + page.contentOutbound, 0),
    pages_with_incoming_count: incoming,
    pages_with_incoming_percentage: pages.length
      ? Number((incoming / pages.length).toFixed(4))
      : null,
    orphan_page_count: orphans.length,
    orphan_pages: orphans.slice(0, p.max_evidence_items).map((page) => ({
      site_url_id: page.id,
      url: page.url,
      title: page.title,
      page_kind: page.kind,
    })),
  };
}
function depthSummary(pages: ArchitecturePage[]) {
  const depths = pages.flatMap((page) => (page.depth === null ? [] : [page.depth]));
  const counts = [
    depths.filter((depth) => depth === 0).length,
    depths.filter((depth) => depth === 1).length,
    depths.filter((depth) => depth === 2).length,
    depths.filter((depth) => depth >= 3).length,
  ];
  return {
    measured_page_count: depths.length,
    unmeasured_page_count: pages.length - depths.length,
    buckets: ['depth_0', 'depth_1', 'depth_2', 'depth_3_plus'].map((key, index) => ({
      key,
      page_count: counts[index]!,
      percentage: depths.length ? Number((counts[index]! / depths.length).toFixed(4)) : null,
    })),
  };
}
function absolute(raw: unknown, base: string) {
  return canonicalUrl(raw, base) ?? '';
}
function relationshipUrls(page: ArchitecturePage) {
  const breadcrumbs = record(page.facts.commerce).breadcrumb_links;
  const visible = Array.isArray(breadcrumbs)
    ? breadcrumbs.map((item) => absolute(record(item).url, page.url)).filter(Boolean)
    : [];
  const raw = page.facts.structured_data;
  const values = Array.isArray(raw) ? raw : record(raw).blocks;
  const blocks = Array.isArray(values) ? values.map(record) : [];
  const schema = blocks.flatMap((block) =>
    Array.isArray(block.breadcrumb_items)
      ? block.breadcrumb_items.map((value) => absolute(value, page.url)).filter(Boolean)
      : [],
  );
  const parts = blocks.map((block) => absolute(block.is_part_of_url, page.url)).filter(Boolean);
  return { visible, explicit: [...schema, ...parts] };
}
function parentSource(breadcrumb: unknown, explicit: unknown, parent: unknown) {
  if (breadcrumb) return 'breadcrumb';
  if (explicit) return 'explicit_structure';
  return parent ? 'url_parent' : 'unknown';
}
function pathParent(url: string) {
  try {
    const parsed = new URL(url);
    const path = stripTrailing(parsed.pathname, '/');
    if (!path) return '';
    parsed.pathname = path.slice(0, path.lastIndexOf('/')) || '/';
    parsed.search = '';
    parsed.hash = '';
    return parsed.href;
  } catch {
    return '';
  }
}
function resolved(urls: string[], id: string, nodes: Map<string, string>) {
  for (const url of [...urls].reverse()) {
    const candidate = nodes.get(url);
    if (candidate && candidate !== id) return candidate;
  }
  return null;
}
function hierarchyRow(
  page: ArchitecturePage,
  nodes: Map<string, string>,
  kinds: Map<string, string>,
) {
  const urls = relationshipUrls(page);
  const breadcrumb = resolved(urls.visible, page.id, nodes);
  const explicit = resolved(urls.explicit, page.id, nodes);
  const candidate = nodes.get(pathParent(page.url)) ?? null;
  const parent = candidate && p.hub_page_kinds.includes(kinds.get(candidate)!) ? candidate : null;
  return {
    site_url_id: page.id,
    url: page.url,
    title: page.title,
    page_kind: page.kind,
    parent_site_url_id: breadcrumb ?? explicit ?? parent,
    parent_source: parentSource(breadcrumb, explicit, parent),
    breadcrumb_parent_site_url_id: breadcrumb,
    explicit_parent_site_url_id: explicit,
    depth_from_home: page.depth,
    cycle_suppressed: false,
  };
}
function breakCycles(rows: ReturnType<typeof hierarchyRow>[]) {
  const parents = new Map(rows.map((row) => [row.site_url_id, row.parent_site_url_id]));
  for (const row of rows) {
    let parent = parents.get(row.site_url_id);
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      if (parent === row.site_url_id) {
        row.cycle_suppressed = true;
        row.parent_site_url_id = null;
        row.parent_source = 'unknown';
        parents.set(row.site_url_id, null);
        break;
      }
      seen.add(parent);
      parent = parents.get(parent);
    }
  }
  return rows;
}
function hierarchy(pages: ArchitecturePage[]) {
  const urls = new Map<string, string[]>();
  for (const page of pages) urls.set(page.url, [...(urls.get(page.url) ?? []), page.id]);
  const nodes = new Map(
    [...urls].flatMap(([url, ids]) => {
      const id = onlyOf(ids);
      return id === undefined ? [] : [[url, id] as const];
    }),
  );
  const kinds = new Map(pages.map((page) => [page.id, page.kind]));
  return breakCycles(pages.map((page) => hierarchyRow(page, nodes, kinds)));
}
export function buildArchitecture(input: ArchitecturePage[], coverage: string, context: unknown) {
  const pages = [...input]
    .sort((a, b) => compareText(a.url, b.url) || compareText(a.id, b.id))
    .slice(0, p.max_pages);
  return {
    hierarchy: hierarchy(pages),
    page_kinds: pageKinds(pages),
    internal_linking: linking(pages),
    structure_depth: depthSummary(pages),
    archetype: assessArchetype(pages, coverage, context),
  };
}
