import { createHash } from 'node:crypto';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { timeOrderedId } from '../db/ids.ts';
import { record } from '../db/json.ts';
import { scalarText } from '../text-order.ts';
import type { FetchCall, FetchedPage } from '../safe-fetch.ts';
import type { SiteTask } from '../queue/task-queue.ts';
import type { analyzePage } from './analysis/analyze-page.ts';
import { createsIssue, type RuleEvaluation } from './analysis/rules.ts';
import type { Facts } from './analysis/read-facts.ts';
import { refreshIssueCurrency, syncIssueCurrency } from './issue-currency.ts';
import type { Crawl } from './site-task.ts';
import { refreshTerminalCounters } from './terminal-counters.ts';
import { canonicalIdentity } from './url-identity.ts';

const pa = policy.site_health.page_analysis;
const versions = policy.site_health.versions;
const measurementVersions = policy.site_health.reads.measurement_versions;
const attemptOutcome = {
  success: 'success',
  error: policy.site_health.reads.fetch_attempt_error_outcome,
};

function provenance(policyVersion: string) {
  return {
    acquisition_transport: pa.acquisition.provenance.transport_node,
    acquisition_rung: 1,
    acquisition_trigger: pa.acquisition.provenance.trigger_initial,
    impersonation_profile: '',
    acquisition_options: null,
    acquisition_policy_version: policyVersion.slice(0, 32),
  };
}

const extractorVersion = (crawl: Crawl) => crawl.extractor_version || versions.extractor;
const analyzerVersion = (crawl: Crawl) => crawl.analyzer_version || versions.analyzer;

export async function writeArtifact(
  db: Database,
  crawl: Crawl,
  task: SiteTask,
  page: FetchedPage,
  facts: Facts | null,
  fetch: {
    policyVersion: string;
    latencyMs: number;
    purpose: 'analyze' | 'discover';
    robotsExcluded: boolean;
  },
) {
  const { policyVersion, latencyMs, purpose, robotsExcluded } = fetch;
  const id = timeOrderedId();
  const now = new Date();
  await db
    .insertInto('site_fetch_artifacts')
    .values({
      id,
      task_id: task.id,
      crawl_id: crawl.id,
      workspace_id: crawl.workspace_id,
      fetch_purpose: purpose,
      requested_url: task.requested_url,
      final_url: page.url,
      redirect_chain: JSON.stringify(
        (page.redirectChain ?? []).map((hop) => ({
          from_url: hop.from,
          to_url: hop.to,
          status_code: hop.status,
        })),
      ),
      status_code: page.status,
      redacted_headers: JSON.stringify(page.headers ?? {}),
      content_type: page.contentType.slice(0, 128),
      content_hash: createHash('sha256').update(page.body).digest('hex'),
      http_version: (page.httpVersion ?? '').slice(0, 16),
      ttfb_ms: page.ttfbMs ?? null,
      latency_ms: latencyMs,
      wire_bytes: page.wireBytes ?? page.body.length,
      decoded_bytes: page.body.length,
      ...provenance(policyVersion),
      acquisition_options: robotsExcluded ? JSON.stringify({ robots_excluded: true }) : null,
      extractor_version: extractorVersion(crawl),
      normalized_facts: facts ? JSON.stringify(facts) : null,
      fetched_at: now,
      created_at: now,
    })
    .execute();
  return id;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replaceAll(/[[\]]/gu, '').slice(0, 255);
  } catch {
    return '';
  }
};

export type AttemptOutcome = {
  succeeded: boolean;
  errorCode: string;
  statusCode: number | null;
  latencyMs: number | null;
  calls: FetchCall[];
};

export async function writeAttempts(
  db: Database,
  crawl: Crawl,
  task: SiteTask,
  outcome: AttemptOutcome,
  artifactId: string | null,
  policyVersion: string,
) {
  const attemptNumber = task.attempt_count + 1;
  const common = {
    task_id: task.id,
    crawl_id: crawl.id,
    workspace_id: crawl.workspace_id,
    attempt_number: attemptNumber,
    method: 'GET',
    ...provenance(policyVersion),
    created_at: new Date(),
  };
  const rows = outcome.calls.length
    ? outcome.calls.map((call, index) => {
        const final = index === outcome.calls.length - 1;
        const error = call.error || (final && !outcome.succeeded) ? outcome.errorCode : '';
        const failed = Boolean(error) || (call.status !== null && call.status >= 400);
        return {
          ...common,
          id: timeOrderedId(),
          request_ordinal: index,
          target_host: hostOf(call.url),
          outcome: failed ? attemptOutcome.error : attemptOutcome.success,
          error_code: error.slice(0, 32),
          status_code: call.status,
          latency_ms: call.latencyMs,
          wire_bytes: call.wireBytes,
          decoded_bytes: call.decodedBytes,
          artifact_id: final && outcome.succeeded ? artifactId : null,
        };
      })
    : [
        {
          ...common,
          id: timeOrderedId(),
          request_ordinal: 0,
          target_host: hostOf(task.requested_url),
          outcome: outcome.succeeded ? attemptOutcome.success : attemptOutcome.error,
          error_code: outcome.errorCode.slice(0, 32),
          status_code: outcome.statusCode,
          latency_ms: outcome.latencyMs,
          wire_bytes: null,
          decoded_bytes: null,
          artifact_id: artifactId,
        },
      ];
  await db.insertInto('site_fetch_attempts').values(rows).execute();
}

async function sitemapObservation(db: Database, crawl: Crawl, siteUrlId: string) {
  const row = await db
    .selectFrom('site_sitemap_entries as e')
    .innerJoin('site_url_observations as o', (join) =>
      join
        .onRef('o.workspace_id', '=', 'e.workspace_id')
        .onRef('o.crawl_id', '=', 'e.crawl_id')
        .onRef('o.site_url_id', '=', 'e.site_url_id'),
    )
    .select(['o.id', 'e.listed_url', 'e.lastmod'])
    .where('e.workspace_id', '=', crawl.workspace_id)
    .where('e.project_id', '=', crawl.project_id)
    .where('e.crawl_id', '=', crawl.id)
    .where('e.site_url_id', '=', siteUrlId)
    .executeTakeFirst();
  return row ?? null;
}

function rootSiteFacts(crawl: Crawl, task: SiteTask): Facts | null {
  if (!crawl.site_facts) return null;
  try {
    return canonicalIdentity(crawl.root_url).hash === task.url_hash
      ? record(crawl.site_facts)
      : null;
  } catch {
    return null;
  }
}

async function refreshUrlState(
  db: Database,
  crawl: Crawl,
  siteUrlId: string,
  artifactId: string,
  facts: Facts,
) {
  const title = typeof facts.title === 'string' ? facts.title : '';
  const contentType = typeof facts.content_type === 'string' ? facts.content_type : '';
  await db
    .updateTable('site_urls')
    .set({
      ...(title ? { latest_title: title.slice(0, 1024) } : {}),
      latest_content_type: contentType.slice(0, 128),
      last_seen_crawl_id: crawl.id,
    })
    .where('id', '=', siteUrlId)
    .where('workspace_id', '=', crawl.workspace_id)
    .execute();
  const delivery = record(facts.delivery);
  await db
    .updateTable('site_url_observations')
    .set({
      status_code: typeof delivery.status_code === 'number' ? delivery.status_code : null,
      final_url: scalarText(delivery.final_url).slice(0, 2048),
      content_type: contentType.slice(0, 128),
      title: title.slice(0, 1024),
      source_artifact_id: artifactId,
    })
    .where('crawl_id', '=', crawl.id)
    .where('workspace_id', '=', crawl.workspace_id)
    .where('site_url_id', '=', siteUrlId)
    .where('status_code', 'is', null)
    .execute();
}

export type EvaluationGroup = {
  analysisId: string;
  siteUrlId: string;
  artifactId: string;
  evaluations: (RuleEvaluation & { id: string })[];
};

/** Rows per statement: both row shapes stay far under PostgreSQL's 65535 bind parameters. */
const INSERT_CHUNK = 1000;
const chunksOf = <T>(rows: T[]) =>
  Array.from({ length: Math.ceil(rows.length / INSERT_CHUNK) }, (_, index) =>
    rows.slice(index * INSERT_CHUNK, (index + 1) * INSERT_CHUNK),
  );

export async function insertEvaluations(db: Database, crawl: Crawl, groups: EvaluationGroup[]) {
  const now = new Date();
  const pairs = groups.flatMap((group) =>
    group.evaluations.map((evaluation) => ({ group, evaluation })),
  );
  const rows = pairs.map(({ group: { analysisId, artifactId }, evaluation }) => ({
    id: evaluation.id,
    workspace_id: crawl.workspace_id,
    analysis_id: analysisId,
    source_artifact_id: artifactId,
    rule_id: evaluation.rule_id,
    dimension: evaluation.dimension,
    category: evaluation.category,
    severity: evaluation.severity,
    finding_class: evaluation.finding_class,
    scope: evaluation.scope,
    weight: evaluation.weight,
    outcome: evaluation.outcome,
    display_applicability: evaluation.display_applicability,
    score_applicability: evaluation.score_applicability,
    reason_code: evaluation.reason_code,
    score_roles: evaluation.score_roles,
    readiness_dimension: evaluation.readiness_dimension,
    readiness_weight: evaluation.readiness_weight,
    evidence: JSON.stringify(evaluation.evidence),
    supporting_artifact_ids: [artifactId],
    extractor_version: extractorVersion(crawl),
    analyzer_version: analyzerVersion(crawl),
    rule_version: evaluation.rule_version,
    created_at: now,
  }));
  for (const chunk of chunksOf(rows))
    await db.insertInto('site_rule_evaluations').values(chunk).execute(); // NOSONAR -- In order, in the caller's transaction.
  const issues = pairs.flatMap(({ group: { analysisId, siteUrlId, artifactId }, evaluation }) =>
    createsIssue(evaluation)
      ? [
          {
            id: timeOrderedId(),
            workspace_id: crawl.workspace_id,
            project_id: crawl.project_id,
            crawl_id: crawl.id,
            site_url_id: siteUrlId,
            analysis_id: analysisId,
            evaluation_id: evaluation.id,
            source_artifact_id: artifactId,
            rule_id: evaluation.rule_id,
            dimension: evaluation.dimension,
            category: evaluation.category,
            severity: evaluation.severity,
            finding_class: evaluation.finding_class,
            evidence: JSON.stringify(evaluation.evidence),
            description: evaluation.description,
            remediation: evaluation.remediation,
            analyzer_version: analyzerVersion(crawl),
            rule_version: evaluation.rule_version,
            created_at: now,
          },
        ]
      : [],
  );
  for (const chunk of chunksOf(issues)) await db.insertInto('site_issues').values(chunk).execute(); // NOSONAR -- In order, in the caller's transaction.
}

export async function pageAnalysisContext(
  db: Database,
  crawl: Crawl,
  task: SiteTask & { site_url_id: string },
) {
  const auditTime = crawl.started_at ?? crawl.created_at;
  const observation = await sitemapObservation(db, crawl, task.site_url_id);
  const observationId = observation?.id ?? null;
  const siteFacts = rootSiteFacts(crawl, task);
  return {
    sitemapMember: observationId !== null,
    sitemapUrl: observation?.listed_url ?? null,
    sitemapLastmod: observation?.lastmod ?? null,
    siteFacts,
    auditTime: auditTime ? new Date(auditTime).toISOString() : null,
    sources: {
      sitemap_crawl_id: crawl.id,
      sitemap_observation_id: observationId,
      site_facts_crawl_id: siteFacts ? crawl.id : null,
      audit_time_crawl_id: auditTime ? crawl.id : null,
    },
  };
}

export async function writePageAnalysis(
  db: Database,
  crawl: Crawl,
  task: SiteTask & { site_url_id: string },
  artifactId: string,
  facts: Facts,
  result: ReturnType<typeof analyzePage>,
) {
  const siteUrlId = task.site_url_id;
  await refreshUrlState(db, crawl, siteUrlId, artifactId, facts);
  const superseded = await db
    .updateTable('site_page_analyses')
    .set({ is_current: false })
    .where('workspace_id', '=', crawl.workspace_id)
    .where('crawl_id', '=', crawl.id)
    .where('site_url_id', '=', siteUrlId)
    .where('is_current', '=', true)
    .returning(['id', 'supersedes_analysis_id', 'finalized_at'])
    .execute();
  const id = timeOrderedId();
  const scores = result.scores;
  const evaluations = result.evaluations.map((evaluation) => ({
    ...evaluation,
    id: timeOrderedId(),
  }));
  await db
    .insertInto('site_page_analyses')
    .values({
      id,
      workspace_id: crawl.workspace_id,
      project_id: crawl.project_id,
      crawl_id: crawl.id,
      site_url_id: siteUrlId,
      artifact_id: artifactId,
      status: 'completed',
      ...scores,
      expected_checkpoint_profile: JSON.stringify(scores.expected_checkpoint_profile),
      readiness_dimensions: JSON.stringify(scores.readiness_dimensions),
      profile_version: measurementVersions.profile,
      schema_contract_version: measurementVersions.schema_contract,
      presentation_version: measurementVersions.presentation,
      analyzer_version: analyzerVersion(crawl),
      scoring_version: crawl.scoring_version || policy.site_health.reads.scoring_version,
      page_kind: result.assessment.page_kind,
      classifier_version: result.assessment.evidence.classifier_version,
      page_kind_evidence: JSON.stringify(result.assessment.evidence),
      page_traits: result.traits,
      traits_version: pa.traits.version,
      source_artifact_ids: [artifactId],
      source_evaluation_ids: evaluations.map((evaluation) => evaluation.id),
      is_current: true,
      supersedes_analysis_id: null,
      finalized_at: null,
      created_at: new Date(),
    })
    .execute();
  await insertEvaluations(db, crawl, [{ analysisId: id, siteUrlId, artifactId, evaluations }]);
  await syncIssueCurrency(db, crawl, [
    id,
    ...superseded.map((row) => row.supersedes_analysis_id ?? row.id),
  ]);
  if (superseded.some((row) => row.finalized_at !== null)) {
    await refreshIssueCurrency(db, crawl, { resync: false });
    await refreshTerminalCounters(db, crawl);
  }
  return { id, pageKind: result.assessment.page_kind };
}
