/**
 * Keyword gaps from published Search Intelligence datasets: searches a saved
 * competitor ranks for in the project's market and the project does not. Only
 * reviewed, published datasets are read; nothing here calls a provider. Gates
 * abstain on unknown values and count them, a search Search Console already
 * shows is left to Demand, and a page whose title and H1 cover every term is
 * improved instead of planning a new one.
 */
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { getDomain } from 'tldts';
import { z } from 'zod';
import type { KeywordGapEvidence } from '@citeladder/contracts/opportunities';

import { policy } from '../config.ts';
import type { DetectorHit } from '../analysis/opportunities/evidence.ts';
import { lexicalTokens } from '../analysis/lexical.ts';
import type { Database } from '../db/database.ts';
import { record, strings } from '../db/json.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import { classifyProjectQueries, normalizeQuery } from '../demand/classification.ts';
import { latestQuerySnapshot } from '../demand/query-evidence.ts';
import { preferencesBody } from '../routes/search-intelligence-contracts.ts';
import { competitorTarget, ownedTargets, searchMarket } from '../search-intelligence/targets.ts';
import { normalizeQuery as trafficQueryKey } from '../traffic/normalization.ts';
import { canonicalJson } from '../search-intelligence/requests.ts';
import { compareText } from '../text-order.ts';
import { OWNED_RANK, searchTerms } from './keyword-verification.ts';
import type { CrawlSource, DemandSource, Scope } from './sources.ts';

const g = policy.opportunity.opportunities.SEARCH_GAP;
const USABLE_COVERAGE = new Set(['complete', 'partial', 'empty']);
const savedDomains = z.array(z.string());

type Market = { location_code: number | null; language_code: string };
type Competitor = { id: string; name: string; domain: string };
type GapDataset = {
  id: string;
  competitor: Competitor;
  target_origin: string;
  coverage: string;
  truncated: boolean;
  published_at: string;
};

/** What a refresh reads for keyword gaps, resolved without loading rows. */
export type SearchGapSource = {
  revision: string;
  market: Market;
  datasets: GapDataset[];
  /** Owned ranking and shared-keyword datasets that contradict a gap. */
  ranked_dataset_ids: string[];
  competitors: Competitor[];
};

function hostDomain(origin: string): string | null {
  try {
    return getDomain(new URL(origin).hostname, { allowPrivateDomains: false });
  } catch {
    return null;
  }
}

/**
 * What branded-query classification reads beyond the project row: the brand's
 * names and the newest override. Overrides are append-only, so the highest
 * ordinal moves whenever one is added.
 */
async function brandRevision(db: Database, scope: Scope) {
  const [names, override] = await Promise.all([
    db
      .selectFrom('brands as b')
      .leftJoin('brand_aliases as a', 'a.brand_id', 'b.id')
      .select(['b.name', 'a.alias'])
      .where('b.project_id', '=', scope.projectId)
      .execute(),
    new WorkspaceScope(scope.workspaceId)
      .selectFrom(db, 'branded_query_overrides')
      .select(sql<string | null>`max(ordinal)::text`.as('latest'))
      .where('project_id', '=', scope.projectId)
      .executeTakeFirst(),
  ]);
  return {
    names: [...new Set(names.flatMap((row) => [row.name, row.alias ?? '']))]
      .filter(Boolean)
      .sort(compareText),
    latest_override: override?.latest ?? null,
  };
}

async function projectContext(db: Database, scope: Scope) {
  const workspace = new WorkspaceScope(scope.workspaceId);
  const project = await workspace
    .selectFrom(db, 'projects')
    .select(['name', 'brand_name', 'website_url', 'language_code', 'serp_language_code'])
    .select('serp_location_code')
    .select('search_intelligence_preferences')
    .where('id', '=', scope.projectId)
    .executeTakeFirst();
  if (!project) return null;
  const [domains, competitors, brand] = await Promise.all([
    db
      .selectFrom('owned_domains')
      .select(['id', 'domain'])
      .where('project_id', '=', scope.projectId)
      .execute(),
    db
      .selectFrom('competitors')
      .select(['id', 'name', 'domains'])
      .where('project_id', '=', scope.projectId)
      .orderBy('created_at')
      .orderBy('id')
      .execute(),
    brandRevision(db, scope),
  ]);
  const saved = preferencesBody.parse(project.search_intelligence_preferences);
  return {
    brand: {
      ...brand,
      project_name: project.brand_name,
      domains: domains.map((row) => row.domain).sort(compareText),
    },
    owned: ownedTargets(project, domains).map((target) => target.origin),
    // The market readiness shows.
    market: searchMarket(project, saved),
    competitors: competitors.flatMap((row) => {
      const target = competitorTarget(row, savedDomains.parse(row.domains));
      return target ? [{ id: row.id, name: row.name, domain: target.registrable_domain }] : [];
    }),
  };
}

/** The datasets a refresh would read for gaps now, and their identity. */
export async function searchGapSource(
  db: Database,
  scope: Scope,
  at: Date,
): Promise<SearchGapSource | null> {
  const context = await projectContext(db, scope);
  if (!context?.owned.length || context.market.location_code === null) return null;
  const since = new Date(at.getTime() - g.MAX_DATASET_AGE_DAYS * 86_400_000);
  const candidates = await new WorkspaceScope(scope.workspaceId)
    .selectFrom(db, 'search_intelligence_datasets')
    .select(['id', 'dataset_kind', 'target_origin', 'comparison_origin', 'coverage', 'truncated'])
    .select(
      sql<string>`to_char(published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`.as(
        'published',
      ),
    )
    .where('project_id', '=', scope.projectId)
    .where('status', '=', 'published')
    .where('dataset_kind', 'in', ['missing_keywords', ...Object.keys(OWNED_RANK)])
    .where('target_origin', 'in', context.owned)
    .where('location_code', '=', context.market.location_code)
    .where('language_code', '=', context.market.language_code)
    .where('published_at', '>=', since)
    .orderBy('published_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  const byDomain = new Map(context.competitors.map((item) => [item.domain, item]));
  const latest = new Map<
    string,
    { dataset: (typeof candidates)[number]; competitor: Competitor | undefined }
  >();
  for (const dataset of candidates) {
    const domain = dataset.comparison_origin ? hostDomain(dataset.comparison_origin) : '';
    const competitor = domain ? byDomain.get(domain) : undefined;
    // A comparison with a competitor no longer saved is not evidence about this project.
    if (domain && !competitor) continue;
    const key = `${dataset.dataset_kind}:${dataset.target_origin}:${domain}`;
    if (!latest.has(key)) latest.set(key, { dataset, competitor });
  }
  // The newest reading decides; an unusable one does not revive an older one.
  for (const [key, { dataset }] of latest)
    if (!USABLE_COVERAGE.has(dataset.coverage)) latest.delete(key);
  const datasets = [...latest.values()].flatMap(({ dataset, competitor }) =>
    dataset.dataset_kind === 'missing_keywords' && competitor
      ? [
          {
            id: dataset.id,
            competitor,
            target_origin: dataset.target_origin,
            coverage: dataset.coverage,
            truncated: dataset.truncated,
            published_at: dataset.published,
          },
        ]
      : [],
  );
  if (!datasets.length) return null;
  const ranked = [...latest.values()]
    .filter(({ dataset }) => dataset.dataset_kind !== 'missing_keywords')
    .map(({ dataset }) => dataset.id)
    .sort(compareText);
  return {
    revision: createHash('sha256')
      .update(
        canonicalJson([
          datasets.map((dataset) => dataset.id).sort(compareText),
          ranked,
          context.market,
          context.competitors,
          context.brand,
        ]),
      )
      .digest('hex'),
    market: context.market,
    datasets,
    ranked_dataset_ids: ranked,
    competitors: context.competitors,
  };
}

export type GapRow = {
  id: string;
  dataset_id: string;
  keyword: string;
  search_volume: number | null;
  rank_group: number | null;
  intent: string;
  url: string;
};
type GapPage = { site_url_id: string; analysis_id: string; url: string; text: string };
export type GapInputs = {
  source: SearchGapSource;
  rows: GapRow[];
  rows_truncated: boolean;
  /** Normalized searches the project already ranks for in the same market. */
  ranked: ReadonlySet<string>;
  /** Normalized searches classified branded or ambiguous for the project. */
  branded: ReadonlySet<string>;
  /** Normalized searches Search Console already shows, or null without Demand. */
  search_console: ReadonlySet<string> | null;
  pages: GapPage[];
};

/** Why a row was not promoted, in gate order. */
const ABSTAIN_REASONS = [
  'unknown_volume',
  'low_volume',
  'unknown_rank',
  'low_rank',
  'intent',
  'branded',
  'competitor_named',
  'already_ranking',
  'search_console',
] as const;
type AbstainReason = (typeof ABSTAIN_REASONS)[number];
type PageTerms = { page: GapPage; tokens: ReadonlySet<string> };
type SourcedRow = { row: GapRow; dataset: GapDataset };
/** One search: every row that passed the gates for its term set, never none. */
type Gap = { terms: string; rows: [SourcedRow, ...SourcedRow[]] };

/** The row a merged gap is named after: the highest volume, then the first keyword. */
const leadsBefore = (a: GapRow, b: GapRow) =>
  ((a.search_volume ?? 0) - (b.search_volume ?? 0) || compareText(b.keyword, a.keyword)) > 0;

const namedTerms = (competitor: Competitor) =>
  [competitor.name, competitor.domain.split('.')[0] ?? ''].map(normalizeQuery).filter(Boolean);

/** Whether `query` names any of `terms` as whole words. */
const names = (query: string, terms: string[]) =>
  terms.some((term) => ` ${query} `.includes(` ${term} `));

function gate(
  row: GapRow,
  normalized: string,
  inputs: GapInputs,
  named: string[],
): AbstainReason | null {
  if (row.search_volume === null) return 'unknown_volume';
  if (row.search_volume < g.MIN_SEARCH_VOLUME) return 'low_volume';
  if (row.rank_group === null) return 'unknown_rank';
  if (row.rank_group > g.MAX_COMPETITOR_RANK) return 'low_rank';
  const intent = row.intent.split(',')[0]?.trim() ?? '';
  if (g.EXCLUDED_INTENTS.includes(intent)) return 'intent';
  if (inputs.branded.has(normalized)) return 'branded';
  if (names(normalized, named)) return 'competitor_named';
  if (inputs.ranked.has(normalized)) return 'already_ranking';
  if (inputs.search_console?.has(normalized)) return 'search_console';
  return null;
}

/** One page whose title and H1 hold every term, or why there is none. */
function resolvePage(keyword: string, pages: readonly PageTerms[]) {
  const terms = [...lexicalTokens(keyword)];
  if (!terms.length) return { state: 'no_usable_terms' as const, candidates: [] };
  const covering = pages
    .filter(({ tokens }) => terms.every((term) => tokens.has(term)))
    .map(({ page }) => page);
  const [only, ...others] = covering;
  if (only && !others.length) return { state: 'resolved' as const, page: only, candidates: [] };
  return {
    state: covering.length ? ('ambiguous' as const) : ('no_covering_page' as const),
    candidates: covering.slice(0, 5).map((page) => page.url),
  };
}

const valueFactor = (volume: number) =>
  Math.min(1, Math.max(g.MIN_VALUE_FACTOR, Math.log10(Math.max(volume, 1)) / g.VALUE_LOG_DIVISOR));
const gapFactor = (competitors: number) =>
  Math.min(
    g.GAP_FACTOR_CAP,
    g.GAP_FACTOR_BASE + (competitors - 1) * g.GAP_FACTOR_PER_EXTRA_COMPETITOR,
  );

/** The gates, merge and targeting, over loaded rows. Deterministic. */
export function searchGapDecisions(inputs: GapInputs): {
  hits: DetectorHit[];
  limitations: string[];
} {
  const datasets = new Map(inputs.source.datasets.map((dataset) => [dataset.id, dataset]));
  const abstained = new Map<AbstainReason, number>(ABSTAIN_REASONS.map((reason) => [reason, 0]));
  const named = inputs.source.competitors.flatMap(namedTerms);
  const gaps = new Map<string, Gap>();
  for (const row of inputs.rows) {
    // Rows are read only from the source's datasets; each carries its own from here on.
    const dataset = datasets.get(row.dataset_id);
    const normalized = normalizeQuery(row.keyword);
    if (!dataset || !normalized) continue;
    const reason = gate(row, normalized, inputs, named);
    if (reason) {
      abstained.set(reason, (abstained.get(reason) ?? 0) + 1);
      continue;
    }
    // One gap per term set: "shoes running" and "running shoes" are one search.
    const terms = searchTerms(normalized).key;
    const entry = gaps.get(terms);
    if (entry) entry.rows.push({ row, dataset });
    else gaps.set(terms, { terms, rows: [{ row, dataset }] });
  }
  const ranked = [...gaps.values()]
    .map((gap) => {
      const lead = gap.rows.reduce((best, item) =>
        leadsBefore(item.row, best.row) ? item : best,
      ).row;
      const competitors = new Set(gap.rows.map(({ dataset }) => dataset.competitor.id)).size;
      return { gap, lead, competitors };
    })
    .sort(
      (a, b) =>
        b.competitors - a.competitors ||
        (b.lead.search_volume ?? 0) - (a.lead.search_volume ?? 0) ||
        compareText(a.gap.terms, b.gap.terms),
    );
  const kept = ranked.slice(0, g.MAX_HITS_PER_REFRESH);
  const pages = inputs.pages.map((page) => ({ page, tokens: lexicalTokens(page.text) }));
  const hits = kept.map(({ gap, lead, competitors }) =>
    gapHit({ market: inputs.source.market, pages, gap, lead, competitors }),
  );
  const limitations: string[] = [];
  if (ranked.length > kept.length)
    limitations.push(
      `${ranked.length - kept.length} more keyword gaps passed the gates; only the strongest ${kept.length} became Actions.`,
    );
  if (inputs.rows_truncated)
    limitations.push(`Only the ${g.MAX_ROWS_READ} highest-volume gap rows were read.`);
  if (inputs.source.datasets.some((dataset) => dataset.coverage === 'partial' || dataset.truncated))
    limitations.push('Some keyword-gap datasets are partial; more gaps may exist.');
  if (inputs.search_console === null)
    limitations.push(
      'Search Console is not connected; some keyword gaps may already earn impressions.',
    );
  const skipped = [...abstained].filter(([, count]) => count > 0);
  if (skipped.length) limitations.push(`Keyword gaps not promoted: ${skippedSummary(skipped)}.`);
  return { hits, limitations };
}

function gapHit({
  market,
  pages,
  gap: { rows, terms },
  lead,
  competitors,
}: {
  market: Market;
  pages: readonly PageTerms[];
  gap: Gap;
  lead: GapRow;
  /** How many distinct competitors rank for the search. */
  competitors: number;
}): DetectorHit {
  const normalized = normalizeQuery(lead.keyword);
  const resolution = resolvePage(lead.keyword, pages);
  const page = resolution.state === 'resolved' ? resolution.page : null;
  const sources = rows.map(({ dataset }) => dataset);
  return {
    rule_id: g.RULE_ID,
    target_key: `search-gap:${terms}`,
    target_prompt_id: null,
    target_url: page?.url ?? null,
    target_theme: lead.keyword,
    evidence: {
      keyword: lead.keyword,
      normalized_keyword: normalized,
      query_key: trafficQueryKey(lead.keyword),
      search_volume: lead.search_volume,
      intent: lead.intent || null,
      market,
      owned_origin: rows[0].dataset.target_origin,
      competitors: rows.map(({ row, dataset }) => ({
        competitor_id: dataset.competitor.id,
        name: dataset.competitor.name,
        keyword: row.keyword,
        rank_group: row.rank_group,
        url: row.url || null,
        dataset_id: dataset.id,
        row_id: row.id,
        published_at: dataset.published_at,
        coverage: dataset.coverage,
      })),
      competitor_names: [...new Set(sources.map((dataset) => dataset.competitor.name))].sort(
        compareText,
      ),
      target_resolution: {
        state: resolution.state,
        candidates: resolution.candidates,
      },
      ...(page ? { site_url_id: page.site_url_id } : {}),
      provider: 'dataforseo',
      statement:
        'DataForSEO estimates that competitors rank for this search and you do not. It is a ranking estimate, not measured traffic.',
    } satisfies KeywordGapEvidence,
    source_analysis_ids: page ? [page.analysis_id] : [],
    source_issue_ids: [],
    source_metric_ids: [
      ...new Set([...rows.map(({ row }) => row.id), ...sources.map((dataset) => dataset.id)]),
    ].sort(compareText),
    value_factor: valueFactor(lead.search_volume ?? 0),
    gap_factor: gapFactor(competitors),
  };
}

async function gapRows(db: Database, scope: Scope, source: SearchGapSource) {
  const rows = await new WorkspaceScope(scope.workspaceId)
    .selectFrom(db, 'search_intelligence_rows')
    .select(['id', 'dataset_id', 'keyword', 'search_volume', 'rank_group', 'intent', 'url'])
    .where('project_id', '=', scope.projectId)
    .where(
      'dataset_id',
      'in',
      source.datasets.map((dataset) => dataset.id),
    )
    .orderBy(sql`search_volume desc nulls last`)
    .orderBy('id')
    .limit(g.MAX_ROWS_READ + 1)
    .execute();
  return { rows: rows.slice(0, g.MAX_ROWS_READ), truncated: rows.length > g.MAX_ROWS_READ };
}

async function rankedSearches(db: Database, scope: Scope, source: SearchGapSource) {
  if (!source.ranked_dataset_ids.length) return new Set<string>();
  const rows = await new WorkspaceScope(scope.workspaceId)
    .selectFrom(db, 'search_intelligence_rows')
    .select('keyword')
    .where('project_id', '=', scope.projectId)
    .where('dataset_id', 'in', source.ranked_dataset_ids)
    .where((eb) =>
      eb.or(
        Object.entries(OWNED_RANK).map(([kind, column]) =>
          eb.and([eb('row_kind', '=', kind), eb(column, 'is not', null)]),
        ),
      ),
    )
    .execute();
  return new Set(rows.map((row) => normalizeQuery(row.keyword)));
}

/** Searches Demand already sees: promoted query signals and any query with impressions. */
async function searchConsoleSearches(db: Database, scope: Scope, demand: DemandSource | null) {
  if (!demand) return null;
  const workspace = new WorkspaceScope(scope.workspaceId);
  const snapshot = await workspace
    .selectFrom(db, 'demand_snapshots')
    .select([
      sql<string>`window_start::date::text`.as('start'),
      sql<string>`window_end::date::text`.as('end'),
    ])
    .where('project_id', '=', scope.projectId)
    .where('id', '=', demand.id)
    .executeTakeFirst();
  if (!snapshot) return null;
  const queries = new Set<string>();
  const evidence = await latestQuerySnapshot(db, {
    ...scope,
    windowStart: snapshot.start,
    windowEnd: snapshot.end,
  });
  if (evidence) {
    const rows = await workspace
      .selectFrom(db, 'query_evidence_rows')
      .select('normalized_query')
      .distinct()
      .where('project_id', '=', scope.projectId)
      .where('snapshot_id', '=', evidence.id)
      .where('impressions', '>', 0)
      .execute();
    for (const row of rows) queries.add(normalizeQuery(row.normalized_query));
  }
  const signals = await workspace
    .selectFrom(db, 'demand_signals')
    .select('evidence')
    .where('project_id', '=', scope.projectId)
    .where('snapshot_id', '=', demand.id)
    .where('state', '=', 'active')
    .execute();
  for (const signal of signals) {
    const found = record(signal.evidence);
    if (found.target_kind === 'query' && typeof found.target === 'string')
      queries.add(normalizeQuery(found.target));
  }
  return queries;
}

/** The latest crawl's analyzed pages, with only the title and H1 text a match reads. */
async function crawlPages(
  db: Database,
  scope: Scope,
  crawl: CrawlSource | null,
): Promise<GapPage[]> {
  if (!crawl) return [];
  const rows = await db
    .selectFrom('site_page_analyses as a')
    .innerJoin('site_fetch_artifacts as f', 'f.id', 'a.artifact_id')
    .innerJoin('site_urls as u', 'u.id', 'a.site_url_id')
    .select(['a.id as analysis_id', 'a.site_url_id', 'u.normalized_url'])
    .select(sql<string>`coalesce(f.normalized_facts->>'title', '')`.as('title'))
    .select(sql<unknown>`f.normalized_facts->'headings'->'h1_texts'`.as('h1'))
    .where('a.workspace_id', '=', scope.workspaceId)
    .where('a.project_id', '=', scope.projectId)
    .where('f.workspace_id', '=', scope.workspaceId)
    .where('u.project_id', '=', scope.projectId)
    .where('a.crawl_id', '=', crawl.id)
    .where('a.is_current', '=', true)
    .where('a.finalized_at', 'is not', null)
    .execute();
  return rows.map((row) => ({
    site_url_id: row.site_url_id,
    analysis_id: row.analysis_id,
    url: row.normalized_url,
    text: [row.title, ...strings(row.h1)].join(' '),
  }));
}

/** Keyword-gap hits for one refresh, with what the gates left out. */
export async function searchGapHits(
  db: Database,
  scope: Scope,
  source: SearchGapSource | null,
  demand: DemandSource | null,
  crawl: CrawlSource | null,
): Promise<{ hits: DetectorHit[]; limitations: string[] }> {
  if (source === null) return { hits: [], limitations: [] };
  // Only classification waits on the rows; the other reads are independent.
  const [gaps, ranked, searchConsole, pages] = await Promise.all([
    gapRows(db, scope, source).then(async ({ rows, truncated }) => ({
      rows,
      truncated,
      classifications: await classifyProjectQueries(
        db,
        scope.workspaceId,
        scope.projectId,
        rows.map((row) => row.keyword),
      ),
    })),
    rankedSearches(db, scope, source),
    searchConsoleSearches(db, scope, demand),
    crawlPages(db, scope, crawl),
  ]);
  return searchGapDecisions({
    source,
    rows: gaps.rows,
    rows_truncated: gaps.truncated,
    ranked,
    branded: new Set(
      [...gaps.classifications.values()]
        .filter((item) => item.classification !== 'non_branded')
        .map((item) => item.normalized_query),
    ),
    search_console: searchConsole,
    pages,
  });
}

function skippedSummary(skipped: [string, number][]) {
  return skipped.map(([reason, count]) => `${count} ${reason.replaceAll('_', ' ')}`).join(', ');
}
