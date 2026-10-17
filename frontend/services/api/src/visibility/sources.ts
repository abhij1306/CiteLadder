/**
 * The Sources table: cited domains, or cited pages, over a selection.
 *
 * Shared API/MCP projection. Every rate's denominator is the
 * selection bounded by `as_of`, so paging never picks up a run that finished
 * mid-read. Totals follow the same filters as the rows. Page rows carry what
 * this project knows about the page (its standing and the Action to get listed
 * on it) and the brands named in the answers that cited it, which is
 * co-occurrence, never presence on the page.
 */
import type { visibilitySourcesSchema } from '@citeladder/contracts/visibility-evidence';
import { sql } from 'kysely';
import type { z } from 'zod';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import { wireUtcOf, wireUtcOrNull, utcText } from '../db/timestamps.ts';
import { fromEpochMicros, type ParsedDatetime } from '../http/datetimes.ts';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  InvalidCursorError,
} from '../http/keyset-cursor.ts';
import { latestReadings, readingPresences } from '../source-pages/reading.ts';
import { compareText } from '../text-order.ts';
import { brandIdentities, identityKey } from './brand-identities.ts';
import { earnedPageActions, gapPageHashes, pageStanding } from './page-standing.ts';
import { ratio } from './metrics.ts';
import { runSetComparisonStatus } from './run-sets.ts';
import { attachRetrieved, retrievalCoverage } from './source-retrieval.ts';
import {
  authorizedSelection,
  authorizeRunSet,
  evidenceScope,
  observedAt,
  TrendQueryError,
  type RunSelection,
} from './selection.ts';

export type SourcesResponse = z.input<typeof visibilitySourcesSchema>;
type SourceRow = SourcesResponse['items'][number];

// Chips a cell holds before the rest become the "+N" overflow.
const SOURCE_ROW_MAX_BRANDS = 3;
const PAGE_TARGET_PREFIX = policy.opportunity.earned_actions.EARNED_PAGE_TARGET_PREFIX;

export type SourceQuery = {
  domain: string | null;
  sourceClass: string | null;
  /** `gap`: only pages that list a tracked competitor and not the business. */
  standing: 'gap' | null;
  dimension: 'domain' | 'url';
  asOf: ParsedDatetime | null;
  cursor: string | null;
  limit: number;
  baselineAuditIds: string[] | null;
};

type Scope = ReturnType<typeof scopeOf>;

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

/** Every answer in the selection up to `as_of`, with the prompt it answered. */
function scopeOf(db: Database, selection: RunSelection, asOf: string) {
  return evidenceScope(db, selection)
    .where('ra.created_at', '<=', sql<Date>`${asOf}::timestamptz`)
    .select([
      'ra.id as analysis_id',
      // Coalesced to the frozen text: a deleted prompt's snapshot has no id.
      sql<string>`coalesce(snapshot.prompt_id::text, snapshot.text)`.as('prompt_key'),
      observedAt.as('observed_at'),
    ])
    .as('scope');
}

/**
 * The citations the rows count. A domain row is filtered by its publisher
 * class, a page row by its own page format, exactly as the type ring is.
 */
function filteredCitations(
  db: Database,
  scope: Scope,
  selection: RunSelection,
  query: SourceQuery,
  pages: boolean,
) {
  let citations = db
    .selectFrom('citations as citation')
    .innerJoin(scope, 'scope.analysis_id', 'citation.analysis_id')
    .where('citation.workspace_id', '=', selection.workspaceId);
  if (query.domain) citations = citations.where('citation.domain', '=', query.domain);
  if (query.standing === 'gap')
    citations = citations.where(sql<boolean>`citation.url_hash in (${gapPageHashes(selection)})`);
  if (!query.sourceClass) return citations;
  if (!pages) return citations.where('citation.source_class', '=', query.sourceClass);
  return citations
    .innerJoin('source_pages as page', (join) =>
      join
        .onRef('page.url_hash', '=', 'citation.url_hash')
        .on('page.workspace_id', '=', selection.workspaceId)
        .on('page.project_id', '=', selection.projectId),
    )
    .where('page.page_format', '=', query.sourceClass);
}

/** The compact citation rows shared by source paging and category totals. */
function citationSelection(
  db: Database,
  scope: Scope,
  selection: RunSelection,
  query: SourceQuery,
  pages: boolean,
) {
  const key = pages ? 'citation.url' : 'citation.domain';
  let citations = filteredCitations(db, scope, selection, query, pages);
  if (pages)
    citations = citations.leftJoin('source_pages as format_page', (join) =>
      join
        .onRef('format_page.url_hash', '=', 'citation.url_hash')
        .on('format_page.workspace_id', '=', selection.workspaceId)
        .on('format_page.project_id', '=', selection.projectId),
    );
  return citations.select([
    'citation.id',
    'citation.analysis_id',
    'citation.url_hash',
    'citation.url',
    'citation.classification',
    'citation.source_class',
    'citation.source_taxonomy_version',
    'scope.prompt_key',
    'scope.observed_at',
    sql<string>`${sql.ref(key)}`.as('key'),
    (pages
      ? sql<string | null>`format_page.page_format`
      : sql<string | null>`citation.source_class`
    ).as('category'),
  ]);
}

export async function getVisibilitySources(
  db: Database,
  requested: RunSelection,
  query: SourceQuery,
): Promise<SourcesResponse> {
  const selection = await authorizedSelection(db, requested);
  // Selecting a domain is the drill-down into its pages; the URL dimension
  // is pages across every domain.
  const pages = Boolean(query.domain) || query.dimension === 'url';
  // Standing belongs to a page; a publisher row has none to filter on.
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
  const scope = scopeOf(db, selection, asOf);
  const denominator = await db
    .selectFrom(scope)
    .select([
      sql<string>`count(scope.analysis_id)`.as('responses'),
      sql<string>`count(distinct scope.prompt_key)`.as('prompts'),
    ])
    .executeTakeFirstOrThrow();
  const responses = Number(denominator.responses);
  const prompts = Number(denominator.prompts);
  const selected = citationSelection(db, scope, selection, query, pages);
  const base = db.with(
    (cte) => cte('selected').materialized(),
    () => selected,
  );
  const group = base
    .selectFrom('selected')
    .select([
      'key',
      sql<string | null>`min(url_hash)`.as('url_hash'),
      sql<number>`count(distinct analysis_id)::int`.as('responses'),
      sql<number>`count(distinct prompt_key)::int`.as('prompts'),
      utcText(sql`max(observed_at)`).as('last_cited_at'),
      sql<number>`count(id)::int`.as('annotations'),
      sql<number>`count(distinct url)::int`.as('urls'),
      sql<(string | null)[]>`array_agg(distinct classification)`.as('ownership'),
      sql<(string | null)[]>`array_agg(distinct source_class)`.as('categories'),
      sql<(string | null)[]>`array_agg(distinct source_taxonomy_version)`.as('versions'),
    ])
    .groupBy('key');
  const grouped = base.with('groups', () => group);
  const backwards = position?.[3] === 'prev';
  let page = grouped
    .selectFrom('groups')
    .selectAll()
    .orderBy('responses', backwards ? 'asc' : 'desc')
    .orderBy(sql`key collate "C"`, backwards ? 'desc' : 'asc')
    .limit(query.limit + 1);
  if (position)
    page = page.where(
      backwards
        ? sql<boolean>`responses > ${Number(position[1])} or (responses = ${Number(position[1])} and key collate "C" < ${position[2]})`
        : sql<boolean>`responses < ${Number(position[1])} or (responses = ${Number(position[1])} and key collate "C" > ${position[2]})`,
    );
  const summary = await grouped
    .selectNoFrom([
      sql<number>`(select count(*)::int from groups)`.as('total'),
      sql<number>`(select coalesce(sum(annotations), 0)::int from groups)`.as('citations'),
      sql<
        Record<string, number>
      >`(select coalesce(jsonb_object_agg(category, count), '{}'::jsonb) from
      (select category, count(*)::int as count from selected where category is not null group by category) categories)`.as(
        'category_totals',
      ),
      sql<
        Awaited<ReturnType<typeof group.execute>>
      >`(select coalesce(jsonb_agg(to_jsonb(page)), '[]'::jsonb) from (${page}) page)`.as('rows'),
    ])
    .executeTakeFirstOrThrow();
  const total = summary.total;
  const totalCitations = summary.citations;
  const rows = summary.rows.slice(0, query.limit);
  if (backwards) rows.reverse();
  const last = rows.at(-1);
  const first = rows[0];
  const items: SourceRow[] = rows.map((row) => {
    const rowResponses = Number(row.responses);
    const annotations = Number(row.annotations);
    const urls = Number(row.urls);
    const present = (values: (string | null)[]) =>
      values.filter((value): value is string => Boolean(value)).sort(compareText);
    return {
      key: row.key,
      retrieved: null,
      url_hash: pages ? row.url_hash : null,
      // "Last seen" is asked of a page, never of a publisher.
      last_cited_at: pages ? wireUtcOrNull(row.last_cited_at) : null,
      responses: rowResponses,
      prompts: Number(row.prompts),
      annotations,
      urls,
      response_rate: ratio(rowResponses, responses),
      prompt_coverage: ratio(Number(row.prompts), prompts),
      // How much of a publisher the engines reached; a page is one URL.
      retrieval_rate: pages ? null : ratio(urls, responses),
      citation_share: ratio(annotations, totalCitations),
      // Per answer the source was retrieved in, never per answer selected.
      citation_rate: ratio(annotations, rowResponses),
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
  });
  await attachPageLinks(db, selection, items);
  if (pages) await attachRowMentions(db, selection, scope, items);
  const retrieval = await retrievalCoverage(db, selection, asOf);
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
      domain: query.domain,
      pages,
      asOf,
    });
  }
  return response;
}

/**
 * Each page row's inspection state, standing, live Opportunity and Action, and
 * page facts. A page this project has no record of keeps every field unset:
 * nobody looked, which is not the same as nothing wrong. Two cited URLs can
 * resolve to one page.
 */
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
  // The Action lookup needs only the hashes, so it runs beside the page read.
  const [pages, actions] = await Promise.all([
    db
      .selectFrom('source_pages as page')
      .leftJoin('opportunities as opportunity', (join) =>
        join
          .on('opportunity.target_key', '=', sql<string>`${PAGE_TARGET_PREFIX} || page.url_hash`)
          .on('opportunity.workspace_id', '=', selection.workspaceId)
          .onRef('opportunity.project_id', '=', 'page.project_id')
          .on('opportunity.superseded_at', 'is', null),
      )
      .leftJoin('source_page_snapshots as snapshot', 'snapshot.id', 'page.latest_snapshot_id')
      .select([
        'page.id',
        'page.url_hash',
        'page.source_class',
        'page.inspection_state',
        'page.page_format',
        'page.page_format_method',
        'snapshot.page_facts',
        'opportunity.id as opportunity_id',
      ])
      .where('page.workspace_id', '=', selection.workspaceId)
      .where('page.project_id', '=', selection.projectId)
      .where('page.url_hash', 'in', hashes)
      // The highest-priority live action first, should a page ever have two.
      .orderBy('page.url_hash')
      .orderBy(sql`opportunity.priority_score desc nulls last`)
      .execute(),
    earnedPageActions(db, selection, hashes),
  ]);
  const scope = { workspaceId: selection.workspaceId, projectId: selection.projectId };
  const readings = await latestReadings(db, scope, [...new Set(pages.map((page) => page.id))]);
  const presences = await readingPresences(
    db,
    scope,
    [...readings.values()].map((reading) => reading.id),
  );
  const seen = new Set<string>();
  for (const page of pages) {
    if (seen.has(page.url_hash)) continue;
    seen.add(page.url_hash);
    const title = record(page.page_facts).title;
    const reading = readings.get(page.id);
    const standing = pageStanding(page, reading, reading ? (presences.get(reading.id) ?? []) : []);
    for (const row of byHash.get(page.url_hash) ?? []) {
      row.inspection_state = page.inspection_state;
      row.opportunity_id = page.opportunity_id;
      row.standing = standing;
      row.action_id = actions.get(page.url_hash) ?? null;
      row.title = typeof title === 'string' && title ? title : null;
      row.page_format = page.page_format;
      row.page_format_method = page.page_format_method;
    }
  }
}

/** The brands named in the answers that cited each loaded page, in place. */
async function attachRowMentions(
  db: Database,
  selection: RunSelection,
  scope: Scope,
  items: SourceRow[],
): Promise<void> {
  const urls = items.map((row) => row.key).filter(Boolean);
  if (urls.length === 0) return;
  const cited = db
    .selectFrom('citations as citation')
    .innerJoin(scope, 'scope.analysis_id', 'citation.analysis_id')
    .where('citation.workspace_id', '=', selection.workspaceId)
    .where('citation.url', 'in', urls);
  const brand = await cited
    .innerJoin('brand_mentions as mention', 'mention.analysis_id', 'citation.analysis_id')
    .where('mention.brand_name', '!=', '')
    .select([
      'citation.url',
      'mention.brand_name as name',
      sql<string>`count(distinct mention.analysis_id)`.as('responses'),
    ])
    .groupBy(['citation.url', 'mention.brand_name'])
    .execute();
  const competitor = await cited
    .innerJoin('competitor_mentions as mention', 'mention.analysis_id', 'citation.analysis_id')
    .where('mention.competitor_name', '!=', '')
    .select([
      'citation.url',
      'mention.competitor_name as name',
      sql<string>`count(distinct mention.analysis_id)`.as('responses'),
    ])
    .groupBy(['citation.url', 'mention.competitor_name'])
    .execute();
  const found = new Map<
    string,
    { kind: 'brand' | 'competitor'; name: string; responses: number }[]
  >();
  for (const [kind, rows] of [
    ['brand', brand],
    ['competitor', competitor],
  ] as const) {
    for (const row of rows) {
      const list = found.get(row.url) ?? [];
      list.push({ kind, name: row.name, responses: Number(row.responses) });
      found.set(row.url, list);
    }
  }
  const identities = await brandIdentities(db, selection.projectId);
  for (const row of items) {
    const named = found.get(row.key);
    if (!named?.length) continue;
    named.sort(
      (left, right) => right.responses - left.responses || compareText(left.name, right.name),
    );
    row.mentions = named.length;
    row.brands = named.slice(0, SOURCE_ROW_MAX_BRANDS).map((entry) => {
      const identity = identities.get(identityKey(entry.name));
      return { ...entry, logo_url: identity?.logo_url ?? null, website: identity?.website ?? null };
    });
  }
}

/**
 * Each row's movement in response rate against a baseline run set, when the
 * two sets are comparable; returns the comparison status.
 */
async function applySourceComparison(
  db: Database,
  selection: RunSelection,
  response: SourcesResponse,
  input: { baselineIds: string[]; domain: string | null; pages: boolean; asOf: string },
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
  const baseline = evidenceScope(db, {
    ...selection,
    auditId: null,
    auditIds: null,
    fromAt: null,
    toAt: null,
  })
    .where('ra.audit_id', 'in', input.baselineIds)
    .where('ra.created_at', '<=', sql<Date>`${input.asOf}::timestamptz`)
    .select('ra.id');
  const { answers } = await db
    .selectFrom(baseline.as('baseline'))
    .select(sql<string>`count(*)`.as('answers'))
    .executeTakeFirstOrThrow();
  const denominator = Number(answers);
  if (!denominator) return 'no_observations';
  const keys = response.items.map((row) => row.key);
  if (keys.length === 0) return 'comparable';
  const key = input.pages ? 'citation.url' : 'citation.domain';
  let counted = db
    .selectFrom('citations as citation')
    .where('citation.workspace_id', '=', selection.workspaceId)
    .where('citation.analysis_id', 'in', baseline)
    .where(key, 'in', keys);
  if (input.domain) counted = counted.where('citation.domain', '=', input.domain);
  const counts = new Map(
    (
      await counted
        .select([
          sql<string>`${sql.ref(key)}`.as('key'),
          sql<string>`count(distinct citation.analysis_id)`.as('answers'),
        ])
        .groupBy(key)
        .execute()
    ).map((row) => [row.key, Number(row.answers)]),
  );
  for (const row of response.items) {
    if (row.response_rate === null) continue;
    row.response_delta = (row.response_rate - (counts.get(row.key) ?? 0) / denominator) * 100;
  }
  return 'comparable';
}
