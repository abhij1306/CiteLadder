/**
 * The persisted inputs of one content-angle refresh (content optimization
 * section 1): the window's audits, the competitor and editorial pages their
 * answers cited, the owned pages they cited, and the latest crawl's content
 * pages. The window's answers are Visibility's evidence statement
 * (`evidenceScope`), so a citation counts here exactly when Visibility counts
 * it. Reads only; every query is scoped to the workspace and project.
 */
import { sql } from 'kysely';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { storedInstant, utcTextOf } from '../db/timestamps.ts';
import { hash } from '../crypto-text.ts';
import { chunked, groupBy } from '../lists.ts';
import { resolveCrawlId, type Scope } from '../opportunities/sources.ts';
import { canonicalPage } from '../page-identity.ts';
import { outlineHeadings } from '../source-pages/differentiation.ts';
import { compareText } from '../text-order.ts';
import {
  evidenceScope,
  latestBrandRunId,
  observedAt,
  selectedRuns,
  type RunSelection,
} from '../visibility/selection.ts';

const p = policy.content_optimization;

/** One citation of a URL, with the prompt and engine of the answer that made it. */
type CitationRef = { id: string; promptId: string; engine: string };

/** One cited competitor or editorial URL under one prompt topic (null: topicless prompts). */
export type CitedUrl = {
  topicId: string | null;
  canonicalUrl: string;
  urlHash: string;
  title: string;
  /** The title was empty in every citation, so it is the URL's path slug. */
  titleFromSlug: boolean;
  domain: string;
  classification: string;
  matchedCompetitor: string | null;
  sourceClass: string | null;
  citations: CitationRef[];
};

/** One owned URL cited in the window, with each citation's prompt. */
export type OwnedCitation = { canonicalUrl: string; citations: CitationRef[] };

/** A content page of the latest crawl, as the prefilter and the model read it. */
export type CandidatePage = {
  siteUrlId: string;
  canonicalUrl: string;
  title: string;
  headings: string[];
  excerpt: string;
};

export type Limitation =
  | { code: 'topicless_prompts'; count: number; total: number }
  | { code: 'empty_titles'; count: number; total: number }
  | { code: 'too_few_citations'; topics: number }
  | { code: 'urls_truncated'; topics: number; dropped: number }
  | { code: 'no_gap_citations' }
  | { code: 'no_content_crawl' };

/** The newest dashboard-ready brand audit of the default market, and the window it anchors. */
export type Anchor = {
  auditId: string;
  /** UTC text with microseconds (`utcText`), so the anchor itself is never cut out. */
  windowStart: string;
  windowEnd: string;
};

export type AngleInputs = {
  audits: { anchor: Anchor; ids: string[] };
  market: { country: string; language: string };
  crawlId: string | null;
  external: CitedUrl[];
  owned: OwnedCitation[];
  limitations: Limitation[];
};

/**
 * The latest succeeded run, or undefined. A failed run never counts, so a
 * refused or failed computation is retried by the next trigger over the same
 * inputs, and the Opportunity refresh keeps reading the run before it.
 */
export function latestSucceededRun(db: Database, scope: Scope) {
  return db
    .selectFrom('content_angle_runs')
    .select([
      'id',
      'cluster_key',
      'match_key',
      'aggregate_key',
      'window_start',
      'window_end',
      'methodology_version',
      'formula_version',
      'limitations',
    ])
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('outcome', '=', 'succeeded')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
}

export type SucceededRun = NonNullable<Awaited<ReturnType<typeof latestSucceededRun>>>;

/** The anchor audit and its window, or null when the project has no dashboard-ready audit. */
export async function resolveAnchor(db: Database, scope: Scope): Promise<Anchor | null> {
  const auditId = await latestBrandRunId(db, { ...scope, marketId: null });
  if (auditId === null) return null;
  const observed = sql`coalesce(completed_at, created_at)`;
  const row = await db
    .selectFrom('audits')
    .select([
      utcTextOf(observed).as('end_text'),
      utcTextOf(sql`(${observed} - make_interval(days => ${p.window_days}::integer))`).as(
        'start_text',
      ),
    ])
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('id', '=', auditId)
    .executeTakeFirstOrThrow();
  return { auditId, windowStart: row.start_text, windowEnd: row.end_text };
}

/**
 * The crawl's current, completed analyses of content pages (CO15), joined to
 * their site URL: the one statement the owned match and a page chat's target
 * check read content pages from.
 */
export function contentPageAnalyses(db: Database, scope: Scope, crawlId: string) {
  return db
    .selectFrom('site_page_analyses as analysis')
    .innerJoin('site_urls as url', 'url.id', 'analysis.site_url_id')
    .where('analysis.workspace_id', '=', scope.workspaceId)
    .where('analysis.project_id', '=', scope.projectId)
    .where('url.workspace_id', '=', scope.workspaceId)
    .where('url.project_id', '=', scope.projectId)
    .where('analysis.crawl_id', '=', crawlId)
    .where('analysis.is_current', '=', true)
    .where('analysis.status', '=', 'completed')
    .where('analysis.page_kind', 'in', p.content_page_kinds);
}

/** The path slug a page with no title is named by. */
function slugTitle(url: string): string {
  try {
    const parsed = new URL(url);
    const segment = parsed.pathname.split('/').findLast(Boolean);
    const text = segment
      ? decodeURIComponent(segment)
          .replace(/\.[a-z0-9]{1,5}$/iu, '')
          .replaceAll(/[-_+]+/gu, ' ')
          .trim()
      : '';
    return text || parsed.hostname;
  } catch {
    return url;
  }
}

/** The most frequent non-empty title, ties in text order; '' when every title is empty. */
function commonTitle(titles: string[]): string {
  const counts = new Map<string, number>();
  for (const title of titles.map((value) => value.trim()).filter(Boolean))
    counts.set(title, (counts.get(title) ?? 0) + 1);
  return (
    [...counts].sort(([a, ca], [b, cb]) => cb - ca || compareText(a, b)).map(([t]) => t)[0] ?? ''
  );
}

const isGapSource = (row: { classification: string; source_class: string | null }) =>
  (p.gap_sources.classifications as readonly string[]).includes(row.classification) ||
  (row.source_class !== null &&
    (p.gap_sources.source_classes as readonly string[]).includes(row.source_class));

/**
 * Visibility's selection of the default market's runs, every engine and both
 * brand cohorts; `auditIds` names the window's runs once they are known.
 */
const windowSelection = (scope: Scope, auditIds: string[] | null): RunSelection => ({
  ...scope,
  marketId: null,
  auditId: null,
  auditIds,
  logicalEngine: null,
  cohort: policy.visibility.all_cohort,
  fromAt: null,
  toAt: null,
});

async function windowAuditIds(db: Database, scope: Scope, anchor: Anchor) {
  const rows = await selectedRuns(db, windowSelection(scope, null))
    .select('audit.id')
    .where(observedAt, '>=', storedInstant(anchor.windowStart))
    .where(observedAt, '<=', storedInstant(anchor.windowEnd))
    .orderBy('audit.id')
    .execute();
  return rows.map((row) => row.id);
}

/**
 * The window's citations from answers to tracked prompts only (AS5): an answer
 * whose snapshot names no prompt, or whose prompt the library no longer has,
 * is not read, so every angle has at least one prompt.
 */
function citationRows(db: Database, scope: Scope, auditIds: string[]) {
  return chunked(auditIds, (chunk) =>
    evidenceScope(db, windowSelection(scope, chunk))
      .innerJoin('citations as c', 'c.analysis_id', 'ra.id')
      .innerJoin('prompts as prompt', (join) =>
        join
          .onRef('prompt.id', '=', 'snapshot.prompt_id')
          .on('prompt.workspace_id', '=', scope.workspaceId),
      )
      .select([
        'c.id',
        'c.url',
        'c.canonical_url',
        'c.url_hash',
        'c.title',
        'c.domain',
        'c.classification',
        'c.source_class',
        'c.matched_competitor',
        'c.is_owned',
        'c.is_unintended',
        'ra.logical_engine as engine',
        'prompt.id as prompt_id',
        'prompt.topic_id',
      ])
      .where('c.workspace_id', '=', scope.workspaceId)
      .orderBy('c.id')
      .execute(),
  );
}

type CitationRow = Awaited<ReturnType<typeof citationRows>>[number];

const canonicalOf = (row: CitationRow) => {
  const raw = row.canonical_url ?? row.url;
  return canonicalPage(raw) ?? raw;
};

function externalUrls(rows: CitationRow[]): CitedUrl[] {
  const groups = groupBy(rows, (row) => JSON.stringify([row.topic_id, canonicalOf(row)]));
  return [...groups.values()].map((group) => {
    const [first] = group;
    const canonicalUrl = canonicalOf(first);
    const title = commonTitle(group.map((row) => row.title));
    const competitor = group.find((row) => row.classification === 'competitor');
    const representative = competitor ?? first;
    return {
      topicId: first.topic_id,
      canonicalUrl,
      urlHash: group.find((row) => row.url_hash)?.url_hash ?? hash(canonicalUrl),
      title: title || slugTitle(canonicalUrl),
      titleFromSlug: !title,
      domain: representative.domain,
      classification: representative.classification,
      matchedCompetitor: group.find((row) => row.matched_competitor)?.matched_competitor ?? null,
      sourceClass: group.find((row) => row.source_class)?.source_class ?? null,
      citations: group.map((row) => ({ id: row.id, promptId: row.prompt_id, engine: row.engine })),
    };
  });
}

function ownedUrls(rows: CitationRow[]): OwnedCitation[] {
  return [...groupBy(rows, canonicalOf)].map(([canonicalUrl, group]) => ({
    canonicalUrl,
    citations: group.map((row) => ({ id: row.id, promptId: row.prompt_id, engine: row.engine })),
  }));
}

/** A scalar normalized fact as text (`scalarText` in SQL): '' when absent or not a scalar. */
const factText = (key: string) =>
  sql<string>`coalesce(case when jsonb_typeof(artifact.normalized_facts -> ${key}::text)
    in ('string', 'number', 'boolean') then artifact.normalized_facts ->> ${key}::text end, '')`;

/** The crawl's content pages the owned match reads: title, headings and an excerpt only. */
export async function contentPages(
  db: Database,
  scope: Scope,
  crawlId: string,
): Promise<CandidatePage[]> {
  const rows = await contentPageAnalyses(db, scope, crawlId)
    .innerJoin('site_fetch_artifacts as artifact', 'artifact.id', 'analysis.artifact_id')
    .select([
      'url.id',
      'url.normalized_url',
      'url.latest_title',
      factText('title').as('title'),
      sql<unknown>`artifact.normalized_facts -> 'primary_heading_outline'`.as('outline'),
      sql<string>`left(${factText('primary_content_text')}, ${p.content_excerpt_chars}::integer)`.as(
        'excerpt',
      ),
    ])
    .where('artifact.workspace_id', '=', scope.workspaceId)
    .orderBy('url.id')
    .limit(p.max_content_pages)
    .execute();
  return rows.map((row) => ({
    siteUrlId: row.id,
    canonicalUrl: canonicalPage(row.normalized_url) ?? row.normalized_url,
    title: row.title || row.latest_title,
    headings: outlineHeadings(row.outline),
    excerpt: row.excerpt,
  }));
}

/** Everything one refresh reads, anchored at `anchor`, except the content pages. */
export async function loadAngleInputs(
  db: Database,
  scope: Scope,
  anchor: Anchor,
): Promise<AngleInputs> {
  const [ids, project, crawlId] = await Promise.all([
    windowAuditIds(db, scope, anchor),
    db
      .selectFrom('projects')
      .select(['country_code', 'language_code'])
      .where('workspace_id', '=', scope.workspaceId)
      .where('id', '=', scope.projectId)
      .executeTakeFirstOrThrow(),
    resolveCrawlId(db, scope),
  ]);
  const rows = await citationRows(db, scope, ids);
  const external = externalUrls(
    rows.filter((row) => !row.is_owned && !row.is_unintended && isGapSource(row)),
  );
  const limitations: Limitation[] = [];
  const prompts = new Map(rows.map((row) => [row.prompt_id, row.topic_id]));
  const topicless = [...prompts.values()].filter((topic) => topic === null).length;
  if (topicless)
    limitations.push({ code: 'topicless_prompts', count: topicless, total: prompts.size });
  const untitled = external.filter((url) => url.titleFromSlug).length;
  if (untitled) limitations.push({ code: 'empty_titles', count: untitled, total: external.length });
  if (!external.length) limitations.push({ code: 'no_gap_citations' });
  if (crawlId === null) limitations.push({ code: 'no_content_crawl' });
  return {
    audits: { anchor, ids },
    market: { country: project.country_code, language: project.language_code },
    crawlId,
    external,
    owned: ownedUrls(rows.filter((row) => row.is_owned)),
    limitations,
  };
}
