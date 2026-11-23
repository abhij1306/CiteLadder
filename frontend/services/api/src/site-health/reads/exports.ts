import type { AffectedPage } from '@citeladder/contracts/site-health';

import { policy } from '../../config.ts';
import type { Database } from '../../db/database.ts';
import { tableCsv, tableMarkdown } from '../../http/table-export.ts';
import { compareText } from '../../text-order.ts';
import { siteReadSettings } from '../runtime.ts';
import {
  issueGroup,
  issueOccurrences,
  issues,
  type IssueFilters,
  type IssueView,
  type Paging,
} from './issues.ts';
import type { PageRowFilters } from './page-filters.ts';
import type { PageSort } from './page-rows.ts';
import { pages } from './pages.ts';

export const VIEW_NAMES = ['pages', 'issues'] as const;
const PAGE_COLUMNS = [
  'site_url_id',
  'normalized_url',
  'display_url',
  'title',
  'monitored',
  'analysis_status',
  'error_code',
  'page_kind',
  'depth_from_home',
  'inbound_count',
  'issue_count',
  'web_fundamentals_score',
  'aeo_readiness_score',
  'aeo_measurement_coverage',
  'aeo_measurement_state',
  'aeo_measurement_reason',
  'last_audited',
];
const ISSUES_TITLE = 'Site Health — Issues';
const ISSUE_COLUMNS = [
  'group_id',
  'rule_id',
  'title',
  'dimension',
  'category',
  'severity',
  'page_kind',
  'affected_url_count',
  'description',
  'remediation',
  'analyzer_version',
  'rule_version',
  'created_at',
];

const EXPORT_PAGE = policy.site_health.reads.export_page_size;

type ExportScope = { workspaceId: string; crawlId: string };
export type TableExportRequest = ExportScope &
  (
    | { view: 'pages'; filters: PageRowFilters; sort: PageSort }
    | { view: 'issues'; format: 'csv' | 'md'; filters: IssueFilters; issueView: IssueView }
  );

async function drain<T>(
  read: (paging: Paging) => Promise<{ items: T[]; next_cursor: string | null }>,
) {
  const max = siteReadSettings().maxExportItems;
  const rows: T[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page = await read({ limit: EXPORT_PAGE, cursor }); // NOSONAR
    rows.push(...page.items);
    cursor = page.next_cursor;
    if (rows.length >= max || cursor === null)
      return { rows: rows.slice(0, max), truncated: cursor !== null || rows.length > max };
  }
}

export async function tableExport(db: Database, request: TableExportRequest) {
  const { workspaceId, crawlId } = request;
  if (request.view === 'pages') {
    const { rows, truncated } = await drain((paging) =>
      pages(db, workspaceId, crawlId, request.filters, request.sort, paging),
    );
    return { body: tableCsv(PAGE_COLUMNS, rows), truncated };
  }
  const { rows, truncated } = await drain((paging) =>
    issues(db, workspaceId, crawlId, request.filters, paging, request.issueView),
  );
  const cells = rows.map((row) => ({ ...row, page_kind: row.page_kinds.join(', ') }));
  return {
    body:
      request.format === 'csv'
        ? tableCsv(ISSUE_COLUMNS, cells)
        : tableMarkdown(ISSUES_TITLE, ISSUE_COLUMNS, cells),
    truncated,
  };
}

const ISSUE_PAGE_COLUMNS = ['normalized_url', 'page_kind', 'value', 'value_length'];
const VALUE_EVIDENCE: Record<AffectedPage['value']['kind'], readonly string[]> = {
  title: ['title', 'length'],
  meta_description: ['meta_description', 'length'],
  h1_count: ['h1_count'],
  word_count: ['word_count'],
  none: [],
  unavailable: [],
};

function valueCells(value: AffectedPage['value']) {
  switch (value.kind) {
    case 'title':
    case 'meta_description':
      return { value: value.text, value_length: value.length };
    case 'h1_count':
    case 'word_count':
      return { value: value.count, value_length: null };
    case 'none':
    case 'unavailable':
      return { value: null, value_length: null };
    default: {
      const unhandled: never = value;
      return unhandled;
    }
  }
}

export async function issueExport(db: Database, request: ExportScope & { groupId: string }) {
  const group = await issueGroup(db, request);
  const { rows: shown, truncated } = await drain((paging) =>
    issueOccurrences(db, group, { paging }),
  );
  const { remediation } = group.representative;
  const repeated = new Set(shown.flatMap((page) => VALUE_EVIDENCE[page.value.kind]));
  const evidenceKeys = [...new Set(shown.flatMap((page) => Object.keys(page.evidence)))]
    .filter((key) => !repeated.has(key))
    .sort(compareText);
  const rows = shown.map((page) => ({
    normalized_url: page.normalized_url,
    page_kind: page.page_kind,
    ...valueCells(page.value),
    ...Object.fromEntries(evidenceKeys.map((key) => [`evidence.${key}`, page.evidence[key]])),
    remediation,
  }));
  const columns = [
    ...ISSUE_PAGE_COLUMNS,
    ...evidenceKeys.map((key) => `evidence.${key}`),
    'remediation',
  ];
  return { body: tableCsv(columns, rows), truncated };
}
