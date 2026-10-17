/** Descriptive comparisons over versioned, persisted page evidence. */
import { randomUUID } from 'node:crypto';
import { getDomain } from 'tldts';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import type { SourceScope } from './admission.ts';
import type { QueueTask } from '../queue/task-queue.ts';
import { fenceInspectionTask } from './task-fence.ts';
import { compareText, scalarText } from '../text-order.ts';
import { lexicalTokens } from '../analysis/lexical.ts';
import { groupBy } from '../lists.ts';

const p = policy.content_differentiation;
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
export type ComparisonPage = {
  id: string;
  headings: string[];
  tables: string[][];
  domains: string[];
};
/** The compared structural features, in the (alphabetical) order results list them. */
const FEATURES = ['heading_topics', 'outbound_sources', 'table_structures'] as const;
function features(page: ComparisonPage): Record<(typeof FEATURES)[number], Set<string>> {
  return {
    heading_topics: new Set(
      page.headings
        .map((heading) => [...lexicalTokens(heading)].sort(compareText).join(' '))
        .filter(Boolean),
    ),
    table_structures: new Set(
      page.tables.map(
        (headers) =>
          `table:${[...lexicalTokens(headers.join(' '))].sort(compareText).join(' ') || 'unlabelled'}`,
      ),
    ),
    outbound_sources: new Set(page.domains.filter(Boolean).map((domain) => domain.toLowerCase())),
  };
}
export function compareContent(
  owned: ComparisonPage | null,
  compared: ComparisonPage[],
  candidateIds: string[],
  snapshotIds: string[],
  context: unknown,
) {
  const denominator = compared.length;
  const base = {
    formula_version: p.formula_version,
    state: 'available',
    minimum_inspected_pages: p.min_inspected_pages,
    most_pages_ratio: p.most_pages_ratio,
    comparison_policy: {
      result_limit: p.result_limit,
      canonical_deduplication: 'one candidate per canonical source-page identity',
      duplicate_domain_treatment: 'distinct canonical pages on one domain are retained',
      freshness: 'provider observation timestamp recorded in search_context',
    },
    provenance: {
      selected_result_count: candidateIds.length,
      inspected_page_count: denominator,
      unusable_page_count: Math.max(0, candidateIds.length - denominator),
      candidate_ids: [...new Set(candidateIds)].sort(compareText),
      snapshot_ids: [...new Set(snapshotIds)].sort(compareText),
      search_context: record(context),
    },
    parity: [] as Entry[],
    gaps: [] as Entry[],
    unique_contributions: [] as Entry[],
    limitations: [] as string[],
  };
  if (denominator < p.min_inspected_pages)
    base.limitations.push('Too few selected organic results had usable inspected evidence.');
  if (!owned)
    base.limitations.push(
      'No current owned page had usable lexical relevance to the measured prompt.',
    );
  if (base.limitations.length) {
    base.state = 'insufficient_evidence';
    return base;
  }
  classify(owned!, compared, base);
  base.parity = base.parity.slice(0, p.max_feature_values);
  base.gaps = base.gaps.slice(0, p.max_feature_values);
  base.unique_contributions = base.unique_contributions.slice(0, p.max_feature_values);
  base.limitations = [
    'Comparison covers selected inspected organic results, not the whole search result set.',
    'Heading, table and outbound-domain structure are descriptive evidence, not quality or causation.',
  ];
  return base;
}
function countFeatureValues(compared: ComparisonPage[], feature: (typeof FEATURES)[number]) {
  const counts = new Map<string, number>();
  for (const page of compared)
    for (const value of features(page)[feature]) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}
/** Split feature values into parity, gaps and unique owned contributions. */
function classify(
  owned: ComparisonPage,
  compared: ComparisonPage[],
  into: { parity: Entry[]; gaps: Entry[]; unique_contributions: Entry[] },
) {
  const own = features(owned);
  const denominator = compared.length;
  const threshold = Math.max(1, Math.ceil(denominator * p.most_pages_ratio));
  for (const feature of FEATURES) {
    const counts = countFeatureValues(compared, feature);
    for (const [value, count] of [...counts].sort(([a], [b]) => compareText(a, b))) {
      if (count < threshold) continue;
      const target = own[feature].has(value) ? into.parity : into.gaps;
      target.push(entry(feature, value, count, denominator));
    }
    for (const value of [...own[feature]].sort(compareText))
      if (!counts.has(value)) into.unique_contributions.push(entry(feature, value, 0, denominator));
  }
}
type Entry = {
  feature: string;
  value: string;
  observed_pages: number;
  inspected_pages: number;
  share: number | null;
};
const entry = (feature: string, value: string, count: number, total: number): Entry => ({
  feature,
  value,
  observed_pages: count,
  inspected_pages: total,
  share: total ? Math.round((count / total) * 10000) / 10000 : null,
});
function sourceFacts(id: string, facts: unknown): ComparisonPage {
  const raw = record(facts);
  return {
    id,
    headings: strings(raw.headings),
    tables: Array.isArray(raw.table_headers) ? raw.table_headers.map(strings) : [],
    domains: strings(raw.outbound_domains),
  };
}
export function ownedFacts(id: string, facts: unknown, host: string): ComparisonPage {
  const raw = record(facts);
  const ownedDomain = getDomain(host) ?? host;
  const headings = Array.isArray(raw.primary_heading_outline)
    ? raw.primary_heading_outline.flatMap((item) => {
        const text = record(item).text;
        return typeof text === 'string' ? [text] : [];
      })
    : [];
  const anchors = record(raw.links).anchors;
  const domains = Array.isArray(anchors)
    ? anchors.flatMap((item) => {
        const anchor = record(item);
        if (anchor.is_internal || typeof anchor.url !== 'string') return [];
        try {
          const domain = getDomain(new URL(anchor.url).hostname);
          return domain && domain !== ownedDomain ? [domain] : [];
        } catch {
          return [];
        }
      })
    : [];
  return {
    id,
    headings,
    tables: Array.isArray(raw.primary_table_headers) ? raw.primary_table_headers.map(strings) : [],
    domains,
  };
}
export function refreshDifferentiation(
  db: Database,
  scope: SourceScope,
  auditId: string,
  inspectedIds: string[],
  task?: QueueTask,
) {
  return db.transaction().execute(async (trx) => {
    await fenceInspectionTask(trx, task);
    const affected = inspectedIds.length
      ? await trx
          .selectFrom('content_differentiation_candidates')
          .select('audit_task_id')
          .distinct()
          .where('workspace_id', '=', scope.workspaceId)
          .where('project_id', '=', scope.projectId)
          .where('source_page_id', 'in', inspectedIds)
          .execute()
      : [];
    const candidates = await trx
      .selectFrom('content_differentiation_candidates as candidate')
      .innerJoin('audits as audit', 'audit.id', 'candidate.audit_id')
      .selectAll('candidate')
      .select('audit.created_at as audit_time')
      .where('candidate.workspace_id', '=', scope.workspaceId)
      .where('candidate.project_id', '=', scope.projectId)
      .where('audit.workspace_id', '=', scope.workspaceId)
      .where('audit.project_id', '=', scope.projectId)
      .where((eb) =>
        affected.length
          ? eb.or([
              eb('candidate.audit_id', '=', auditId),
              eb(
                'candidate.audit_task_id',
                'in',
                affected.map((row) => row.audit_task_id),
              ),
            ])
          : eb('candidate.audit_id', '=', auditId),
      )
      .orderBy('candidate.rank')
      .orderBy('candidate.id')
      .execute();
    if (!candidates.length) return;
    // Only successful readings can be compared; failed attempts never load.
    const readings = await trx
      .selectFrom('source_page_snapshots as snapshot')
      .innerJoin('audits as audit', 'audit.id', 'snapshot.audit_id')
      .select([
        'snapshot.id',
        'snapshot.source_page_id',
        'snapshot.audit_id',
        'snapshot.outcome',
        'snapshot.page_facts',
        'snapshot.extracted_chars',
        'audit.created_at as audit_time',
      ])
      .where('snapshot.workspace_id', '=', scope.workspaceId)
      .where('snapshot.project_id', '=', scope.projectId)
      .where('snapshot.outcome', '=', 'inspected')
      .where('audit.workspace_id', '=', scope.workspaceId)
      .where('audit.project_id', '=', scope.projectId)
      .where('snapshot.source_page_id', 'in', [
        ...new Set(candidates.map((row) => row.source_page_id)),
      ])
      .orderBy('snapshot.fetched_at', 'desc')
      .orderBy('snapshot.id', 'desc')
      .execute();
    const snapshots = groupBy(readings, (row) => row.source_page_id);
    const ownedRows = await trx
      .selectFrom('site_page_analyses as analysis')
      .innerJoin('site_fetch_artifacts as artifact', 'artifact.id', 'analysis.artifact_id')
      .innerJoin('site_urls as url', 'url.id', 'analysis.site_url_id')
      .select(['url.id', 'url.host', 'url.latest_title', 'artifact.normalized_facts'])
      .where('analysis.workspace_id', '=', scope.workspaceId)
      .where('analysis.project_id', '=', scope.projectId)
      .where('url.workspace_id', '=', scope.workspaceId)
      .where('url.project_id', '=', scope.projectId)
      .where('artifact.workspace_id', '=', scope.workspaceId)
      .where('analysis.is_current', '=', true)
      .where('analysis.status', '=', 'completed')
      .whereRef('analysis.crawl_id', '=', 'url.last_seen_crawl_id')
      .orderBy('artifact.fetched_at', 'desc')
      .orderBy('url.id')
      .limit(p.max_owned_page_candidates)
      .execute();
    const groups = groupBy(candidates, (row) => row.audit_task_id);
    for (const [taskId, rows] of groups) {
      const [first] = rows;
      const terms = lexicalTokens(first.query_text);
      const selected = ownedRows
        .map((row) => {
          const page = ownedFacts(row.id, row.normalized_facts, row.host);
          const raw = record(row.normalized_facts);
          const available = lexicalTokens(
            `${scalarText(raw.title) || row.latest_title} ${page.headings.join(' ')} ${scalarText(raw.primary_content_text)}`,
          );
          return {
            row,
            page,
            score: terms.size
              ? [...terms].filter((term) => available.has(term)).length / terms.size
              : 0,
          };
        })
        .filter((choice) => choice.score > 0)
        .sort((a, b) => b.score - a.score || b.row.id.localeCompare(a.row.id))[0];
      const compared: ComparisonPage[] = [];
      const snapshotIds: string[] = [];
      for (const candidate of rows) {
        const available = snapshots.get(candidate.source_page_id) ?? [];
        const snapshot =
          available.find((row) => row.audit_id === candidate.audit_id) ??
          available
            .filter((row) => row.audit_time < candidate.audit_time)
            .sort((a, b) => b.audit_time.getTime() - a.audit_time.getTime())[0];
        const facts = record(snapshot?.page_facts);
        if (
          snapshot?.outcome !== 'inspected' ||
          facts.parsed !== true ||
          facts.text_truncated !== false ||
          snapshot.extracted_chars < p.min_source_chars
        )
          continue;
        compared.push(sourceFacts(candidate.source_page_id, facts));
        snapshotIds.push(snapshot.id);
      }
      const report = {
        ...compareContent(
          selected?.page ?? null,
          compared,
          rows.map((row) => row.id),
          snapshotIds,
          first.search_context,
        ),
        query: first.query_text,
        owned_page_selection: {
          method: 'highest_normalized_query_coverage',
          site_url_id: selected?.row.id ?? null,
        },
      };
      const values = {
        id: randomUUID(),
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        audit_id: first.audit_id,
        audit_task_id: taskId,
        owned_site_url_id: selected?.row.id ?? null,
        formula_version: p.formula_version,
        report: JSON.stringify(report),
        created_at: new Date(),
      };
      await trx
        .insertInto('content_differentiation_reports')
        .values(values)
        .onConflict((oc) =>
          oc.column('audit_task_id').doUpdateSet({
            report: values.report,
            owned_site_url_id: values.owned_site_url_id,
            formula_version: values.formula_version,
          }),
        )
        .execute();
    }
  });
}
