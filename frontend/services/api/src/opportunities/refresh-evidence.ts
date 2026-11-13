/**
 * Persisted evidence one refresh's detectors read: Site Health defects,
 * confirmed prompt declines and one audit's visibility answers. Projections of existing rows only; nothing here
 * detects, scores or writes.
 */
import { sql } from 'kysely';

import { policy } from '../config.ts';
import type {
  AnalysisEvidence,
  CitationEvidence,
  DetectorHit,
  SiteEvidence,
  VisibilityEvidence,
} from '../analysis/opportunities/evidence.ts';
import type { Database } from '../db/database.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import { record } from '../db/json.ts';
import { viewIssuesSql, type ViewCrawl } from '../site-health/reads/crawl.ts';
import { siteCoverage, type CoverageCrawl } from './refresh-compute.ts';
import { compareText } from '../text-order.ts';
import { isNonEmpty, lastOf } from '../lists.ts';

const o = policy.opportunity.opportunities;
const r = policy.opportunity.refresh;

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);
const family = o.SITE_ISSUE_FAMILY;

/**
 * Each issue-family rule's defects in one crawl, grouped by owned page: the
 * exact affected page count and the first `COHORT_PAGES_MAX` pages in URL
 * order, so a large family's cohort is bounded but never undercounted.
 */
async function loadIssueFamilies(
  db: Database,
  crawl: ViewCrawl,
): Promise<SiteEvidence['families']> {
  const { rows } = await sql<{
    rule_id: string;
    severity: string;
    category: string;
    site_url_id: string;
    url: string;
    issue_ids: string[];
    page_count: number;
  }>`
    with pages as (
      select i.rule_id, i.site_url_id, u.normalized_url as url,
        min(coalesce(i.severity, '')) as severity, min(coalesce(i.category, '')) as category,
        array_agg(i.id::text order by i.id) as issue_ids
      from site_issues i
      join site_urls u on u.workspace_id = i.workspace_id and u.id = i.site_url_id
        and u.project_id = ${crawl.project_id}
      where ${viewIssuesSql(crawl)}
        and i.finding_class = ${r.finding_class_defect}
        and starts_with(i.rule_id, ${family.ISSUE_RULE_PREFIX})
      group by i.rule_id, i.site_url_id, u.normalized_url
    ), ranked as (
      select pages.*,
        row_number() over (partition by rule_id order by url collate "C", site_url_id) as page_rank,
        count(*) over (partition by rule_id) as page_count
      from pages
    )
    select rule_id, severity, category, site_url_id, url, issue_ids, page_count::int as page_count
    from ranked
    where page_rank <= ${family.COHORT_PAGES_MAX}
    order by rule_id collate "C", page_rank`.execute(db);
  const families = new Map<string, SiteEvidence['families'][number]>();
  for (const row of rows) {
    const page = { site_url_id: row.site_url_id, url: row.url, issue_ids: row.issue_ids };
    const found = families.get(row.rule_id);
    if (found) found.pages.push(page);
    else
      families.set(row.rule_id, {
        rule_id: row.rule_id,
        severity: row.severity,
        category: row.category,
        page_count: row.page_count,
        pages: [page],
      });
  }
  return [...families.values()];
}

export async function loadSiteEvidence(
  db: Database,
  workspaceId: string,
  crawl: CoverageCrawl & ViewCrawl,
): Promise<SiteEvidence> {
  const scope = new WorkspaceScope(workspaceId);
  const loaded = await scope
    .selectFrom(db, 'site_issues')
    .select(['id', 'rule_id', 'severity', 'category', 'finding_class', 'site_url_id', 'evidence'])
    // Each tracked page's latest audit and the crawl's site-level findings (SH-B9).
    .where(viewIssuesSql(crawl, 'site_issues').$castTo<boolean>())
    .where('finding_class', '=', r.finding_class_defect)
    // Issue-family rules load whole, by `loadIssueFamilies`, outside this cap.
    .where(sql<boolean>`not starts_with(rule_id, ${family.ISSUE_RULE_PREFIX})`)
    .orderBy('created_at')
    .orderBy('id')
    .limit(o.RECOMPUTE_MAX_ISSUES + 1)
    .execute();
  const issues = loaded.slice(0, o.RECOMPUTE_MAX_ISSUES);
  const urlIds = [...new Set(issues.map((issue) => issue.site_url_id))];
  const urls = urlIds.length
    ? await scope
        .selectFrom(db, 'site_urls')
        .select(['id', 'normalized_url'])
        .where('id', 'in', urlIds)
        .where('project_id', '=', crawl.project_id)
        .orderBy('id')
        .execute()
    : [];
  const [coverage, limitations] = siteCoverage(crawl);
  return {
    crawl_id: crawl.id,
    truncated: loaded.length > issues.length,
    issues: issues.map((issue) => ({
      issue_id: issue.id,
      rule_id: issue.rule_id,
      severity: issue.severity || '',
      category: issue.category || '',
      finding_class: issue.finding_class,
      site_url_id: issue.site_url_id,
      evidence: record(issue.evidence),
    })),
    urls: urls.map((url) => ({ site_url_id: url.id, normalized_url: url.normalized_url })),
    families: await loadIssueFamilies(db, crawl),
    coverage,
    limitations,
  };
}

/** Confirmed prompt movements, projected into the shared hit model. */
export async function confirmedDeclineHits(
  db: Database,
  workspaceId: string,
  auditId: string,
): Promise<DetectorHit[]> {
  const rows = await new WorkspaceScope(workspaceId)
    .selectFrom(db, 'prompt_metric_snapshots')
    .select([
      'id',
      'prompt_id',
      'prompt_index',
      'prompt_text',
      'per_engine_scores',
      'immediate_delta',
      'engine_agreement',
      'repetition_agreement',
      'trend_confidence',
      'source_analysis_ids',
      'rolling_four',
      'components',
    ])
    .where('audit_id', '=', auditId)
    .where('decline_confirmed', 'is', true)
    .orderBy('prompt_index')
    .execute();
  return rows.map((row) => declineHit(row, auditId));
}

type DeclineRow = {
  id: string;
  prompt_id: string | null;
  prompt_index: number;
  prompt_text: string;
  rolling_four: unknown;
  immediate_delta: number | null;
  per_engine_scores: unknown;
  engine_agreement: number;
  repetition_agreement: number;
  trend_confidence: number;
  components: unknown;
  source_analysis_ids: unknown;
};

/** Confidence ranks a confirmed decline between the floor and 1. */
export function declineValue(confidence: number): number {
  const floor = o.CONFIRMED_DECLINE_CONFIDENCE_FLOOR;
  return floor + (1 - floor) * Math.min(1, Math.max(0, confidence));
}

/** Size in multiples of the materiality the audit confirmed; at least one, capped. */
export function declineGap(delta: number | null): number {
  // An unmeasured size is the materiality the audit confirmed, never zero.
  if (delta === null) return 1;
  const multiple = Math.abs(delta) / policy.audits.analysis.prompt_decline_materiality_points;
  return Math.min(o.CONFIRMED_DECLINE_GAP_CAP, Math.max(1, multiple));
}

/** One confirmed prompt decline as an Opportunity hit. */
function declineHit(row: DeclineRow, auditId: string): DetectorHit {
  return {
    rule_id: 'confirmed_prompt_decline',
    target:
      row.prompt_id !== null
        ? { kind: 'prompt', prompt_id: row.prompt_id, theme: null }
        : { kind: 'prompt_index', audit_id: auditId, prompt_index: row.prompt_index, theme: null },
    evidence: {
      prompt: row.prompt_text,
      rolling_four: row.rolling_four,
      immediate_delta: row.immediate_delta,
      engines: Object.keys(record(row.per_engine_scores)).sort(compareText),
      engine_agreement: row.engine_agreement,
      repetition_agreement: row.repetition_agreement,
      trend_confidence: row.trend_confidence,
      components: row.components,
      content_goal: 'Improve the owned answer for this prompt.',
    },
    source_analysis_ids: strings(row.source_analysis_ids),
    source_issue_ids: [],
    source_metric_ids: [row.id],
    value_factor: declineValue(row.trend_confidence),
    gap_factor: declineGap(row.immediate_delta),
  };
}

/** The project's reviewed owned domains, in one deterministic order. */
/** Owned domains reach the workspace only through their scoped project. */
async function ownedDomainList(
  db: Database,
  scope: WorkspaceScope,
  projectId: string,
): Promise<string[]> {
  const rows = await scope
    .selectFrom(db, 'projects')
    .innerJoin('owned_domains', 'owned_domains.project_id', 'projects.id')
    .select('owned_domains.domain')
    .where('projects.id', '=', projectId)
    .orderBy('owned_domains.domain')
    .execute();
  return rows.map((row) => row.domain);
}

type Credits = { owned: Map<string, number>; competitors: Map<string, Set<string>> };

async function answerCredits(db: Database, scope: WorkspaceScope, analysisIds: string[]) {
  const credits: Credits = { owned: new Map(), competitors: new Map() };
  const citations = new Map<string, CitationEvidence[]>();
  if (!analysisIds.length) return { credits, citations };
  const cited = await scope
    .selectFrom(db, 'citations')
    .select(['analysis_id', 'domain', 'url', 'title', 'is_owned', 'matched_competitor'])
    .where('analysis_id', 'in', analysisIds)
    .orderBy('analysis_id')
    .orderBy('ordinal')
    .execute();
  const mentions = await scope
    .selectFrom(db, 'competitor_mentions')
    .select(['analysis_id', 'competitor_name'])
    .where('analysis_id', 'in', analysisIds)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const name = (id: string, value: string) => {
    const names = credits.competitors.get(id) ?? new Set<string>();
    names.add(value);
    credits.competitors.set(id, names);
  };
  for (const citation of cited) {
    if (citation.is_owned)
      credits.owned.set(citation.analysis_id, (credits.owned.get(citation.analysis_id) ?? 0) + 1);
    if (citation.matched_competitor) name(citation.analysis_id, citation.matched_competitor);
    const rows = citations.get(citation.analysis_id) ?? [];
    rows.push({
      domain: citation.domain || '',
      url: citation.url || '',
      title: citation.title || '',
      is_owned: citation.is_owned,
      matched_competitor: citation.matched_competitor,
    });
    citations.set(citation.analysis_id, rows);
  }
  for (const mention of mentions) {
    if (mention.competitor_name) name(mention.analysis_id, mention.competitor_name);
  }
  return { credits, citations };
}

/** One audit's analyses, citations, mentions and prompt snapshots, plus its metric snapshot id. */
export async function loadVisibilityEvidence(
  db: Database,
  workspaceId: string,
  audit: { id: string; project_id: string },
): Promise<[VisibilityEvidence, string | null, string[]]> {
  const scope = new WorkspaceScope(workspaceId);
  const loaded = await scope
    .selectFrom(db, 'response_analyses')
    .select([
      'id',
      'prompt_index',
      'logical_engine',
      'brand_mentioned',
      'artifact_id',
      'entity_assessments',
    ])
    .where('audit_id', '=', audit.id)
    .orderBy('prompt_index')
    .orderBy('id')
    .limit(o.RECOMPUTE_MAX_ANALYSES + 1)
    .execute();
  // A prompt cut at the cap would keep only some engines' answers and read as
  // absent where a dropped engine mentioned the brand, so it is dropped whole.
  const cut =
    loaded.length > o.RECOMPUTE_MAX_ANALYSES && isNonEmpty(loaded)
      ? lastOf(loaded).prompt_index
      : null;
  const analyses = cut === null ? loaded : loaded.filter((row) => row.prompt_index < cut);
  const limitations =
    cut === null
      ? []
      : [`Answers from prompt ${cut + 1} onward exceeded the analysis cap and were not ranked.`];
  const { credits, citations } = await answerCredits(
    db,
    scope,
    analyses.map((row) => row.id),
  );
  const snapshots = await db
    .selectFrom('audit_prompt_snapshots')
    .select([
      'id',
      'prompt_index',
      'prompt_id',
      'text',
      'theme',
      'intent',
      'buyer_stage',
      'prompt_intent',
    ])
    .where('audit_id', '=', audit.id)
    .orderBy('prompt_index')
    .execute();
  const owned = await ownedDomainList(db, scope, audit.project_id);
  const metric = await scope
    .selectFrom(db, 'metric_snapshots')
    .select('id')
    .where('audit_id', '=', audit.id)
    .executeTakeFirst();
  const evidence: VisibilityEvidence = {
    audit_id: audit.id,
    analyses: analyses.map((row): AnalysisEvidence => ({
      analysis_id: row.id,
      prompt_index: row.prompt_index,
      logical_engine: row.logical_engine || '',
      owned_citation_count: credits.owned.get(row.id) ?? 0,
      brand_mentioned: Boolean(row.brand_mentioned),
      competitor_names: [...(credits.competitors.get(row.id) ?? [])].sort(compareText),
      citations: citations.get(row.id) ?? [],
      artifact_id: row.artifact_id,
      entity_assessments: Array.isArray(row.entity_assessments)
        ? (row.entity_assessments as Record<string, unknown>[])
        : [],
    })),
    prompt_snapshots: snapshots.map((row) => ({
      prompt_index: row.prompt_index,
      prompt_id: row.prompt_id,
      text: row.text || '',
      theme: row.theme || '',
      intent: row.intent || '',
      buyer_stage: row.buyer_stage || '',
      prompt_intent: row.prompt_intent || '',
      snapshot_id: row.id,
    })),
    owned_domains: [...owned].sort(compareText),
  };
  return [evidence, metric?.id ?? null, limitations];
}
