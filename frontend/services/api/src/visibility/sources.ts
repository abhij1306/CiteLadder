import type { visibilitySourcesSchema } from '@citeladder/contracts/visibility-evidence';
import { sql } from 'kysely';
import type { z } from 'zod';

import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import { wireUtcOf, wireUtcOrNull, utcText } from '../db/timestamps.ts';
import { fromEpochMicros, type ParsedDatetime } from '../http/datetimes.ts';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  InvalidCursorError,
} from '../http/keyset-cursor.ts';
import { compareText } from '../text-order.ts';
import { brandIdentities, leadingBrands, type BrandCount } from './brand-identities.ts';
import { gapPageHashes, pageStandings } from './page-standing.ts';
import { earnedPageActions } from '../opportunities/earned-page-actions.ts';
import { ratio } from './metrics.ts';
import { runSetComparisonStatus } from './run-sets.ts';
import { attachRetrieved, retrievalCoverage } from './source-retrieval.ts';
import {
  AnalysisNotFoundError,
  authorizedSelection,
  authorizeRunSet,
  observedAt,
  selectedCohorts,
  selectedRuns,
  TrendQueryError,
  type RunSelection,
} from './selection.ts';

export type SourcesResponse = z.input<typeof visibilitySourcesSchema>;
type SourceRow = SourcesResponse['items'][number];

export type SourceQuery = {
  domain: string | null;
  sourceClass: string | null;
  standing: 'gap' | null;
  dimension: 'domain' | 'url';
  asOf: ParsedDatetime | null;
  cursor: string | null;
  limit: number;
  baselineAuditIds: string[] | null;
};

type RowFilters = Pick<SourceQuery, 'domain' | 'sourceClass' | 'standing'>;
const UNFILTERED: RowFilters = { domain: null, sourceClass: null, standing: null };

const runsOf = (db: Database, selection: RunSelection) =>
  selectedRuns(db, selection).select(['audit.id', observedAt.as('observed_at')]);
type Runs = ReturnType<typeof runsOf>;

function sourcePosition(query: SourceQuery, filters: Record<string, unknown>) {
  if (query.asOf !== null && query.asOf.offsetSeconds === null)
    throw new TrendQueryError("'as_of' must be timezone-aware");
  const position = query.cursor
    ? decodeKeysetCursor(query.cursor, 'visibility-sources', filters)
    : null;
  const asOf =
    position?.[0] ?? wireUtcOf(query.asOf ?? fromEpochMicros(BigInt(Date.now()) * 1000n));
  if (!position) return { position, asOf };
  const direction = position[3];
  if (
    position.length !== 4 ||
    direction === undefined ||
    !['next', 'prev'].includes(direction) ||
    !Number.isFinite(Date.parse(asOf)) ||
    !Number.isSafeInteger(Number(position[1])) ||
    Number(position[1]) < 0
  )
    throw new InvalidCursorError('invalid sources cursor');
  if (query.asOf && wireUtcOf(query.asOf) !== asOf)
    throw new InvalidCursorError('invalid sources cursor');
  return { position, asOf };
}

function answerRows(db: Database, selection: RunSelection, runs: Runs, asOf: string) {
  let rows = db
    .selectFrom('audit_answer_aggregates as answer')
    .innerJoin(runs.as('run'), 'run.id', 'answer.audit_id')
    .where('answer.workspace_id', '=', selection.workspaceId)
    .where('answer.cohort', 'in', selectedCohorts(selection.cohort))
    .where('answer.created_at', '<=', sql<Date>`${asOf}::timestamptz`);
  if (selection.logicalEngine !== null)
    rows = rows.where('answer.logical_engine', '=', selection.logicalEngine);
  if (selection.topicId) rows = rows.where('answer.topic_id', '=', selection.topicId);
  return rows.select(['answer.analysis_ids', 'answer.prompt_keys']);
}

function sourceRows(
  db: Database,
  selection: RunSelection,
  input: { runs: Runs; asOf: string; pages: boolean; filters: RowFilters },
) {
  const { filters, pages } = input;
  let rows = db
    .selectFrom('audit_source_aggregates as source')
    .innerJoin(input.runs.as('run'), 'run.id', 'source.audit_id')
    .leftJoin('source_pages as page', (join) =>
      join
        .onRef('page.url_hash', '=', 'source.url_hash')
        .on('page.workspace_id', '=', selection.workspaceId)
        .on('page.project_id', '=', selection.projectId),
    )
    .where('source.workspace_id', '=', selection.workspaceId)
    .where('source.dimension', '=', pages ? 'url' : 'domain')
    .where('source.cohort', 'in', selectedCohorts(selection.cohort))
    .where('source.created_at', '<=', sql<Date>`${input.asOf}::timestamptz`);
  if (selection.logicalEngine !== null)
    rows = rows.where('source.logical_engine', '=', selection.logicalEngine);
  if (selection.topicId) rows = rows.where('source.topic_id', '=', selection.topicId);
  if (filters.domain) rows = rows.where('source.domain', '=', filters.domain);
  if (filters.standing === 'gap')
    rows = rows.where(sql<boolean>`source.url_hash in (${gapPageHashes(selection)})`);
  if (filters.sourceClass)
    rows = rows.where(pages ? 'page.page_format' : 'source.source_class', '=', filters.sourceClass);
  return rows.select([
    'source.key',
    'source.url_hash',
    'source.analysis_ids',
    'source.prompt_keys',
    'source.urls',
    'source.citation_ids',
    'source.classification',
    'source.source_class',
    'source.source_taxonomy_version',
    'run.observed_at',
    (pages ? sql<string | null>`page.page_format` : sql<string | null>`source.source_class`).as(
      'category',
    ),
  ]);
}

type GroupRow = {
  key: string;
  url_hash: string | null;
  responses: number;
  prompts: number;
  last_cited_at: string | null;
  annotations: number;
  urls: number;
  ownership: (string | null)[];
  categories: (string | null)[];
  versions: (string | null)[];
};

type Summary = {
  responses: number;
  prompts: number;
  missing: number;
  total: number;
  citations: number;
  category_totals: Record<string, number>;
  rows: GroupRow[];
};

function keysetAfter(position: string[] | null, backwards: boolean) {
  if (!position) return sql<boolean>`true`;
  const responses = Number(position[1]);
  return backwards
    ? sql<boolean>`responses > ${responses} or (responses = ${responses} and key collate "C" < ${position[2]})`
    : sql<boolean>`responses < ${responses} or (responses = ${responses} and key collate "C" > ${position[2]})`;
}

const present = (values: (string | null)[]) =>
  values.filter((value): value is string => Boolean(value)).sort(compareText);

function sourceItem(
  row: GroupRow,
  totals: { pages: boolean; responses: number; prompts: number; citations: number },
): SourceRow {
  const { pages } = totals;
  return {
    key: row.key,
    retrieved: null,
    url_hash: pages ? row.url_hash : null,
    last_cited_at: pages ? wireUtcOrNull(row.last_cited_at) : null,
    responses: row.responses,
    prompts: row.prompts,
    annotations: row.annotations,
    urls: row.urls,
    response_rate: ratio(row.responses, totals.responses),
    prompt_coverage: ratio(row.prompts, totals.prompts),
    retrieval_rate: pages ? null : ratio(row.urls, totals.responses),
    citation_share: ratio(row.annotations, totals.citations),
    citation_rate: ratio(row.annotations, row.responses),
    ownership: present(row.ownership),
    categories: present(row.categories),
    taxonomy_versions: present(row.versions),
    category_unavailable: row.categories.includes(null),
    response_delta: null,
    inspection_state: null,
    opportunity_id: null,
    standing: null,
    action_id: null,
    title: null,
    page_format: null,
    page_format_method: null,
    mentions: 0,
    brands: [],
  };
}

export async function getVisibilitySources(
  db: Database,
  requested: RunSelection,
  query: SourceQuery,
): Promise<SourcesResponse> {
  const selection = await authorizedSelection(db, requested);
  const pages = Boolean(query.domain) || query.dimension === 'url';
  if (query.standing && !pages)
    throw new TrendQueryError("'standing' applies to page rows: set 'dimension=url' or a domain");
  const filters = {
    ...selection,
    auditIds: [...(selection.auditIds ?? [])].sort(compareText),
    domain: query.domain,
    sourceClass: query.sourceClass,
    standing: query.standing,
    dimension: query.dimension,
    baselineAuditIds: [...(query.baselineAuditIds ?? [])].sort(compareText),
  };
  const { position, asOf } = sourcePosition(query, filters);
  const runs = runsOf(db, selection);
  const answers = answerRows(db, selection, runs, asOf);
  const selected = sourceRows(db, selection, { runs, asOf, pages, filters: query });
  const backwards = position?.[3] === 'prev';
  const order = backwards ? sql`asc` : sql`desc`;
  const keyOrder = backwards ? sql`desc` : sql`asc`;
  const after = keysetAfter(position, backwards);
  const { rows: summaryRows } = await sql<Summary>`
    with selected as materialized (${selected}),
    facts as (
      select key, min(url_hash) as url_hash, ${utcText(sql`max(observed_at)`)} as last_cited_at,
        sum(cardinality(citation_ids))::int as annotations,
        array_agg(distinct classification) as ownership,
        array_agg(distinct source_class) as categories,
        array_agg(distinct source_taxonomy_version) as versions
      from selected group by key),
    answered as (
      select key, count(distinct answer.id)::int as responses
      from selected, unnest(selected.analysis_ids) as answer(id) group by key),
    prompted as (
      select key, count(distinct prompt.value)::int as prompts
      from selected, unnest(selected.prompt_keys) as prompt(value) group by key),
    linked as (
      select key, count(distinct link.value)::int as urls
      from selected, unnest(selected.urls) as link(value) group by key),
    groups as (
      select facts.key, facts.url_hash, answered.responses, prompted.prompts,
        facts.last_cited_at, facts.annotations, linked.urls, facts.ownership, facts.categories,
        facts.versions
      from facts
      join answered using (key) join prompted using (key) join linked using (key)),
    page as (
      select * from groups where ${after}
      order by responses ${order}, key collate "C" ${keyOrder}
      limit ${query.limit + 1})
    select
      (select coalesce(sum(cardinality(answer.analysis_ids)), 0)::int
        from (${answers}) answer) as responses,
      (select count(distinct prompt.value)::int
        from (${answers}) answer, unnest(answer.prompt_keys) as prompt(value)) as prompts,
      (select count(*)::int from (${runs}) run
        where not exists (select 1 from audit_answer_aggregates computed
          where computed.audit_id = run.id
            and computed.workspace_id = ${selection.workspaceId})) as missing,
      (select count(*)::int from groups) as total,
      (select coalesce(sum(annotations), 0)::int from groups) as citations,
      (select coalesce(jsonb_object_agg(category, count), '{}'::jsonb) from
        (select category, sum(cardinality(citation_ids))::int as count
          from selected where category is not null group by category) categories)
        as category_totals,
      (select coalesce(jsonb_agg(to_jsonb(page)
        order by page.responses ${order}, page.key collate "C" ${keyOrder}), '[]'::jsonb)
        from page) as rows
  `.execute(db);
  const summary = summaryRows[0];
  if (!summary) throw new Error('The sources summary returned no row');
  if (summary.missing)
    throw new AnalysisNotFoundError('Sources not computed for a selected run', 'metrics_pending');
  const { responses, prompts, total, citations: totalCitations } = summary;
  const rows = summary.rows.slice(0, query.limit);
  if (backwards) rows.reverse();
  const last = rows.at(-1);
  const first = rows[0];
  const items = rows.map((row) =>
    sourceItem(row, { pages, responses, prompts, citations: totalCitations }),
  );
  const [, , retrieval] = await Promise.all([
    attachPageLinks(db, selection, items),
    pages ? attachRowMentions(db, selection, { runs, asOf, items }) : undefined,
    retrievalCoverage(db, selection, asOf),
  ]);
  await attachRetrieved(db, selection, { asOf, pages, coverage: retrieval, items });
  const hasPrevious = backwards ? summary.rows.length > query.limit : Boolean(position);
  const response: SourcesResponse = {
    total,
    responses,
    prompts,
    total_citations: totalCitations,
    category_totals: summary.category_totals,
    as_of: asOf,
    next_cursor:
      (backwards || summary.rows.length > query.limit) && last
        ? encodeKeysetCursor('visibility-sources', filters, [
            asOf,
            String(last.responses),
            last.key,
            'next',
          ])
        : null,
    previous_cursor:
      hasPrevious && first
        ? encodeKeysetCursor('visibility-sources', filters, [
            asOf,
            String(first.responses),
            first.key,
            'prev',
          ])
        : null,
    comparison_status: 'no_baseline',
    retrieval,
    items,
  };
  if (query.baselineAuditIds?.length) {
    response.comparison_status = await applySourceComparison(db, selection, response, {
      baselineIds: query.baselineAuditIds,
      filters: query,
      pages,
      asOf,
    });
  }
  return response;
}

async function attachPageLinks(
  db: Database,
  selection: RunSelection,
  items: SourceRow[],
): Promise<void> {
  const byHash = new Map<string, SourceRow[]>();
  for (const row of items) {
    if (row.url_hash) byHash.set(row.url_hash, [...(byHash.get(row.url_hash) ?? []), row]);
  }
  if (byHash.size === 0) return;
  const hashes = [...byHash.keys()];
  const scope = { workspaceId: selection.workspaceId, projectId: selection.projectId };
  const [pages, actions] = await Promise.all([
    pageStandings(db, scope, hashes),
    earnedPageActions(db, scope, hashes),
  ]);
  for (const page of pages.values()) {
    const title = record(page.page_facts).title;
    for (const row of byHash.get(page.url_hash) ?? []) {
      row.inspection_state = page.inspection_state;
      const listing = actions.get(page.url_hash);
      row.opportunity_id = listing?.opportunity_id ?? null;
      row.standing = page.standing;
      row.action_id = listing?.action_id ?? null;
      row.title = typeof title === 'string' && title ? title : null;
      row.page_format = page.page_format;
      row.page_format_method = page.page_format_method;
    }
  }
}

async function attachRowMentions(
  db: Database,
  selection: RunSelection,
  input: { runs: Runs; asOf: string; items: SourceRow[] },
): Promise<void> {
  const urls = input.items.map((row) => row.key).filter(Boolean);
  if (urls.length === 0) return;
  const cited = sourceRows(db, selection, {
    runs: input.runs,
    asOf: input.asOf,
    pages: true,
    filters: UNFILTERED,
  }).where('source.key', 'in', urls);
  const [{ rows: named }, identities] = await Promise.all([
    sql<{ url: string; kind: 'brand' | 'competitor'; name: string; responses: number }>`
      with cited as (
        select distinct source_row.key as url, answer.id as analysis_id
        from (${cited}) source_row, unnest(source_row.analysis_ids) as answer(id))
      select cited.url, 'brand' as kind, mention.brand_name as name,
        count(distinct cited.analysis_id)::int as responses
      from cited join brand_mentions mention on mention.analysis_id = cited.analysis_id
        and mention.workspace_id = ${selection.workspaceId}
      where mention.brand_name <> ''
      group by cited.url, mention.brand_name
      union all
      select cited.url, 'competitor' as kind, mention.competitor_name as name,
        count(distinct cited.analysis_id)::int as responses
      from cited join competitor_mentions mention on mention.analysis_id = cited.analysis_id
        and mention.workspace_id = ${selection.workspaceId}
      where mention.competitor_name <> ''
      group by cited.url, mention.competitor_name
    `.execute(db),
    brandIdentities(db, selection),
  ]);
  const found = new Map<string, BrandCount[]>();
  for (const row of named) {
    const list = found.get(row.url) ?? [];
    list.push({ kind: row.kind, name: row.name, responses: row.responses });
    found.set(row.url, list);
  }
  for (const row of input.items) {
    const entries = found.get(row.key);
    if (entries?.length) Object.assign(row, leadingBrands(entries, identities));
  }
}

async function applySourceComparison(
  db: Database,
  selection: RunSelection,
  response: SourcesResponse,
  input: { baselineIds: string[]; filters: RowFilters; pages: boolean; asOf: string },
): Promise<string> {
  await authorizeRunSet(db, selection, input.baselineIds);
  let currentIds: string[] = selection.auditId ? [selection.auditId] : [];
  if (selection.auditIds?.length) currentIds = selection.auditIds;
  const status = await runSetComparisonStatus(db, selection, {
    currentIds,
    baselineIds: input.baselineIds,
    responses: response.responses,
    engine: selection.logicalEngine,
    cohort: selection.cohort,
  });
  if (status !== 'comparable') return status;
  const baseline = {
    ...selection,
    auditId: null,
    auditIds: input.baselineIds,
    fromAt: null,
    toAt: null,
  };
  const runs = runsOf(db, baseline);
  const answers = answerRows(db, baseline, runs, input.asOf);
  const { answered } = await db
    .selectFrom(answers.as('answer'))
    .select(sql<number>`coalesce(sum(cardinality(answer.analysis_ids)), 0)::int`.as('answered'))
    .executeTakeFirstOrThrow();
  if (!answered) return 'no_observations';
  const keys = response.items.map((row) => row.key);
  if (keys.length === 0) return 'comparable';
  const cited = sourceRows(db, baseline, {
    runs,
    asOf: input.asOf,
    pages: input.pages,
    filters: input.filters,
  }).where('source.key', 'in', keys);
  const { rows: counted } = await sql<{ key: string; answers: number }>`
    select cited.key, count(distinct answer.id)::int as answers
    from (${cited}) cited, unnest(cited.analysis_ids) as answer(id)
    group by cited.key
  `.execute(db);
  const counts = new Map(counted.map((row) => [row.key, row.answers]));
  for (const row of response.items) {
    if (row.response_rate === null) continue;
    row.response_delta = (row.response_rate - (counts.get(row.key) ?? 0) / answered) * 100;
  }
  return 'comparable';
}
