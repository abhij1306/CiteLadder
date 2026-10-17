/**
 * Site Health downloads: the inventory, pages and issues tables, and the
 * observed architecture as a tree. Each renders the same workspace-scoped
 * projection the JSON API returns, so an export never discloses more.
 */
import { policy } from '../../config.ts';
import type { Database } from '../../db/database.ts';
import { tableCsv, tableMarkdown } from '../../http/table-export.ts';
import { onlyOf } from '../../lists.ts';
import { compareText } from '../../text-order.ts';
import { siteReadSettings } from '../runtime.ts';
import { loadCrawl } from './crawl.ts';
import { issues, pageKindsByRule } from './issues.ts';
import { inventory, pages } from './pages.ts';
import { architecture } from './projections.ts';

const MEASUREMENT = [
  'issue_count',
  'web_fundamentals_score',
  'aeo_readiness_score',
  'aeo_measurement_coverage',
  'aeo_measurement_state',
  'aeo_measurement_reason',
  'last_audited',
];
/** The exportable table views, in the order the export route lists them. */
const VIEW_NAMES = ['inventory', 'pages', 'issues'] as const;
export type TableView = (typeof VIEW_NAMES)[number];
export const TABLE_VIEWS: TableView[] = [...VIEW_NAMES];
const VIEWS = {
  inventory: {
    title: 'Site Health — URL Inventory',
    columns: [
      'site_url_id',
      'normalized_url',
      'display_url',
      'title',
      'content_type',
      'source',
      'depth',
      'monitored',
      'page_kind',
      ...MEASUREMENT,
    ],
  },
  pages: {
    title: 'Site Health — Analyzed Pages',
    columns: [
      'site_url_id',
      'normalized_url',
      'display_url',
      'title',
      'monitored',
      'analysis_status',
      'error_code',
      'page_kind',
      ...MEASUREMENT,
    ],
  },
  issues: {
    title: 'Site Health — Issues',
    columns: [
      'group_id',
      'rule_id',
      'title',
      'dimension',
      'category',
      'severity',
      'finding_class',
      // The distinct page kinds of the group's affected pages.
      'page_kind',
      'affected_url_count',
      'description',
      'remediation',
      'analyzer_version',
      'rule_version',
      'created_at',
    ],
  },
} as const satisfies Record<TableView, { title: string; columns: readonly string[] }>;

const EXPORT_PAGE = policy.site_health.reads.export_page_size;

/** Rows of one table view, at most `max_export_items`, and whether more were left out. */
async function tableRows(db: Database, workspaceId: string, crawlId: string, view: TableView) {
  const max = siteReadSettings().maxExportItems;
  const rows: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  const paging = () => ({ limit: EXPORT_PAGE, cursor });
  for (;;) {
    let page: { items: Record<string, unknown>[]; next_cursor: string | null };
    if (view === 'inventory') page = await inventory(db, workspaceId, crawlId, {}, paging());
    else if (view === 'pages') page = await pages(db, workspaceId, crawlId, {}, 'status', paging());
    else
      page = await issues(
        db,
        workspaceId,
        crawlId,
        {
          query: null,
          severity: null,
          category: null,
          dimension: null,
          rule: null,
          siteUrlId: null,
          pageKind: null,
          findingClass: 'defect',
        },
        paging(),
      );
    rows.push(...page.items);
    cursor = page.next_cursor;
    if (rows.length >= max)
      return { rows: rows.slice(0, max), truncated: cursor !== null || rows.length > max };
    if (cursor === null) return { rows, truncated: false };
  }
}

export async function tableExport(
  db: Database,
  workspaceId: string,
  crawlId: string,
  view: TableView,
  format: 'csv' | 'md',
) {
  const { rows, truncated } = await tableRows(db, workspaceId, crawlId, view);
  if (view === 'issues' && rows.length > 0) {
    const kinds = await pageKindsByRule(db, await loadCrawl(db, workspaceId, crawlId), null, null);
    for (const row of rows) row.page_kind = (kinds.get(String(row.rule_id)) ?? []).join(', ');
  }
  const { title, columns } = VIEWS[view];
  return {
    body: format === 'csv' ? tableCsv(columns, rows) : tableMarkdown(title, columns, rows),
    truncated,
  };
}

const COVERAGE_NOTES: Record<string, string> = {
  complete: 'Coverage: complete — the discovery frontier was exhausted.',
  partial:
    'Coverage: partial — the crawl hit its page budget, so this is what CiteLadder observed, not the whole site.',
  unknown: 'Coverage: unknown — the crawl could not prove it saw the whole site.',
};

type Node = {
  site_url_id: string;
  url: string;
  page_kind: string;
  parent_site_url_id: string | null;
};

const byUrl = (a: Node, b: Node) =>
  compareText(a.url, b.url) || compareText(a.site_url_id, b.site_url_id);

/**
 * Children by parent, where every node no root reaches becomes a root: its
 * parent is outside the projection, it names itself, or it sits in a cycle.
 * A tree that silently drops pages is worse than a flat one.
 */
function rootedTree(nodes: Node[]) {
  const children = new Map<string | null, Node[]>();
  for (const node of nodes) {
    const parent = node.parent_site_url_id || null;
    children.set(parent, [...(children.get(parent) ?? []), node]);
  }
  for (const group of children.values()) group.sort(byUrl);
  const known = new Set(nodes.map((node) => node.site_url_id));
  const roots = [...(children.get(null) ?? [])];
  for (const [parent, group] of children) {
    if (parent === null) continue;
    if (!known.has(parent)) roots.push(...group);
    else roots.push(...group.filter((node) => node.site_url_id === parent));
  }
  const reached = new Set(roots.map((node) => node.site_url_id));
  const queue = [...reached];
  while (queue.length) {
    for (const child of children.get(queue.pop()!) ?? []) {
      if (child.site_url_id && !reached.has(child.site_url_id)) {
        reached.add(child.site_url_id);
        queue.push(child.site_url_id);
      }
    }
  }
  roots.push(...nodes.filter((node) => !reached.has(node.site_url_id)));
  children.set(null, roots.toSorted(byUrl));
  return children;
}

function treeLines(
  nodeId: string | null,
  children: Map<string | null, Node[]>,
  prefix: string,
  seen: Set<string>,
): string[] {
  const group = children.get(nodeId) ?? [];
  const kind = onlyOf(new Set(group.map((node) => node.page_kind)));
  // A large homogeneous set of leaf pages reads as one count, not a URL list.
  const collapse =
    nodeId !== null &&
    group.length >= policy.site_health.architecture.page_kind_collapse_min &&
    kind !== undefined &&
    kind !== '' &&
    !group.some((node) => children.get(node.site_url_id)?.length);
  if (collapse) return [`${prefix}\`-- [${group.length} ${kind}]`];
  const lines: string[] = [];
  group.forEach((node, index) => {
    const last = index === group.length - 1;
    if (!node.site_url_id || seen.has(node.site_url_id)) return;
    seen.add(node.site_url_id);
    const label = node.page_kind ? `${node.url}  [${node.page_kind}]` : node.url;
    lines.push(
      `${prefix}${last ? '`-- ' : '|-- '}${label}`,
      ...treeLines(node.site_url_id, children, prefix + (last ? '    ' : '|   '), seen),
    );
  });
  return lines;
}

/** The crawl's observed architecture as Markdown with an ASCII tree, coverage stated. */
export async function architectureMarkdown(db: Database, workspaceId: string, crawlId: string) {
  const crawl = await loadCrawl(db, workspaceId, crawlId);
  const model = await architecture(db, workspaceId, crawl.project_id, crawl.id);
  const coverage = COVERAGE_NOTES[model.coverage_state] ?? COVERAGE_NOTES.unknown;
  return [
    '# Site Health — Observed architecture',
    '',
    `${model.nodes.length} pages sampled · ${coverage}`,
    '',
    '## Tree',
    '',
    '```',
    '/',
    ...treeLines(null, rootedTree(model.nodes), '', new Set()),
    '```',
    '',
  ].join('\n');
}
