/**
 * Append-only Site Health evidence for one analyzed page: the fetch artifact,
 * one attempt row per real network call, the page analysis, its rule
 * evaluations and the issues they raise. Callers own the transaction.
 */
import { createHash, randomUUID } from 'node:crypto';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import { scalarText } from '../text-order.ts';
import type { FetchCall, FetchedPage } from '../projects/safe-fetch.ts';
import type { SiteTask } from '../queue/task-queue.ts';
import type { analyzePage } from './analysis/analyze-page.ts';
import { createsIssue, type RuleEvaluation } from './analysis/rules.ts';
import type { Facts } from './analysis/read-facts.ts';
import type { Crawl } from './task-fence.ts';
import { canonicalIdentity } from './url-identity.ts';

const pa = policy.site_health.page_analysis;
const versions = policy.site_health.versions;
const measurementVersions = policy.site_health.reads.measurement_versions;
const attemptOutcome = {
  success: 'success',
  error: policy.site_health.reads.fetch_attempt_error_outcome,
};

/** The acquisition provenance this stack records on artifacts and attempts. */
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
  fetch: { policyVersion: string; latencyMs: number; purpose: 'analyze' | 'discover' },
) {
  const { policyVersion, latencyMs, purpose } = fetch;
  const id = randomUUID();
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

/**
 * One attempt row per real network call, sharing the queue attempt number. A
 * call fails when it errored, answered 4xx/5xx, or ended an unsuccessful fetch;
 * only the successful final call links the artifact. A fetch that made no call
 * (a robots short-circuit) keeps one diagnostic row.
 */
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
          id: randomUUID(),
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
          id: randomUUID(),
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

/** The observation supporting membership in the current or an older stored sitemap manifest. */
async function sitemapObservation(db: Database, crawl: Crawl, siteUrlId: string) {
  const sitemap = record(record(crawl.site_facts).sitemap);
  const urls = Array.isArray(sitemap.urls)
    ? sitemap.urls.filter((url) => typeof url === 'string')
    : null;
  if (urls && !urls.length) return null;
  const row = await db
    .selectFrom('site_url_observations')
    .select(['id', 'observed_url'])
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('crawl_id', '=', crawl.id)
    .where('site_url_id', '=', siteUrlId)
    .where((eb) =>
      urls ? eb('observed_url', '=', eb.fn.any(eb.val(urls))) : eb('source_kind', '=', 'sitemap'),
    )
    .limit(1)
    .executeTakeFirst();
  return row ?? null;
}

/** Site-level facts belong to the crawl root's analysis only. */
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

/** Refresh the URL's lightweight state and fill a sparse admission observation from this fetch. */
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
      discovery_status: 'completed',
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

export async function insertEvaluations(
  db: Database,
  crawl: Crawl,
  analysisId: string,
  siteUrlId: string,
  artifactId: string,
  evaluations: (RuleEvaluation & { id: string })[],
) {
  const now = new Date();
  const rows = evaluations.map((evaluation) => ({
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
  if (rows.length) await db.insertInto('site_rule_evaluations').values(rows).execute();
  const issues = evaluations.flatMap((evaluation, index) =>
    createsIssue(evaluation)
      ? [
          {
            id: randomUUID(),
            workspace_id: crawl.workspace_id,
            project_id: crawl.project_id,
            crawl_id: crawl.id,
            site_url_id: siteUrlId,
            analysis_id: analysisId,
            evaluation_id: rows[index]!.id,
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
  if (issues.length) await db.insertInto('site_issues').values(issues).execute();
}

/** The provisional context to load before CPU-bound interpretation and recheck at commit. */
export async function pageAnalysisContext(
  db: Database,
  crawl: Crawl,
  task: SiteTask & { site_url_id: string },
) {
  const auditTime = crawl.started_at ?? crawl.created_at;
  const observation = await sitemapObservation(db, crawl, task.site_url_id);
  const observationId = observation?.id ?? null;
  const siteFacts = rootSiteFacts(crawl, task);
  const lastmod = record(record(record(crawl.site_facts).sitemap).lastmod);
  const declared = observation ? lastmod[observation.observed_url] : undefined;
  return {
    sitemapMember: observationId !== null,
    // The URL as the sitemap lists it: a redirect makes it differ from the final URL.
    sitemapUrl: observation?.observed_url ?? null,
    sitemapLastmod: typeof declared === 'string' ? declared : null,
    siteFacts,
    auditTime: auditTime ? new Date(auditTime).toISOString() : null,
    // The crawl owns setup facts and audit time; the observation owns membership.
    // Evaluation rows also retain extractor/analyzer/rule processing versions.
    sources: {
      sitemap_crawl_id: crawl.id,
      sitemap_observation_id: observationId,
      site_facts_crawl_id: siteFacts ? crawl.id : null,
      audit_time_crawl_id: auditTime ? crawl.id : null,
    },
  };
}

/** Append the precomputed provisional result; finalization adds cross-page checks later. */
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
  await db
    .updateTable('site_page_analyses')
    .set({ is_current: false })
    .where('workspace_id', '=', crawl.workspace_id)
    .where('crawl_id', '=', crawl.id)
    .where('site_url_id', '=', siteUrlId)
    .where('is_current', '=', true)
    .execute();
  const id = randomUUID();
  const scores = result.scores;
  const evaluations = result.evaluations.map((evaluation) => ({ ...evaluation, id: randomUUID() }));
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
  await insertEvaluations(db, crawl, id, siteUrlId, artifactId, evaluations);
  return { id, pageKind: result.assessment.page_kind };
}
