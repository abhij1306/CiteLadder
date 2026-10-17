/**
 * Persisted evidence one refresh's detectors read: Site Health defects,
 * confirmed prompt declines and one audit's visibility answers. Projections of existing rows only; nothing here
 * detects, scores or writes.
 */
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
import { siteCoverage, type CoverageCrawl } from './refresh-compute.ts';
import { compareText } from '../text-order.ts';
import { isNonEmpty, lastOf } from '../lists.ts';

const o = policy.opportunity.opportunities;
const r = policy.opportunity.refresh;

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

export async function loadSiteEvidence(
  db: Database,
  workspaceId: string,
  crawl: CoverageCrawl & { id: string; project_id: string },
): Promise<SiteEvidence> {
  const scope = new WorkspaceScope(workspaceId);
  const loaded = await scope
    .selectFrom(db, 'site_issues')
    .select(['id', 'rule_id', 'severity', 'category', 'finding_class', 'site_url_id', 'evidence'])
    .where('crawl_id', '=', crawl.id)
    .where('finding_class', '=', r.finding_class_defect)
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
    target_key:
      row.prompt_id !== null
        ? `prompt:${row.prompt_id}`
        : `prompt-index:${auditId}:${row.prompt_index}`,
    target_prompt_id: row.prompt_id,
    target_url: null,
    target_theme: null,
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
