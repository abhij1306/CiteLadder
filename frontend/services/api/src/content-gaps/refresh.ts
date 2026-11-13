/**
 * The `content_angle_refresh` analytics task (content optimization section 1).
 *
 * Reads commit before any model call and no transaction spans one. The run is
 * keyed on three input keys; when the latest succeeded run has the same keys
 * nothing is written (a failed run never blocks a retry). Otherwise the
 * clustering of an earlier succeeded run is reused while its key is unchanged
 * (and its owned match while that key is too), and the rest is computed. The
 * run, its lineages, angles, members and owned matches persist in the worker's
 * fenced terminal transaction under a per-project lock that re-checks the
 * inputs and keys, so concurrent tasks over the same inputs write one run and
 * a task whose audit or crawl was superseded meanwhile writes none. A
 * succeeded run announces itself to the Opportunity refresh, joining one
 * already queued; a model failure, a rejected output or a refused call
 * persists a `failed` run and enqueues nothing.
 */
import { randomUUID } from 'node:crypto';

import type { z } from 'zod';

import { lexicalTokens } from '../analysis/lexical.ts';
import { plannedPageKey } from '../opportunities/targets/registry.ts';
import { meterFor } from '../models/metering.ts';
import { policy } from '../config.ts';
import { subjectXactLock } from '../db/advisory-lock.ts';
import type { Database } from '../db/database.ts';
import { storedInstant } from '../db/timestamps.ts';
import { parseUuid } from '../http/uuid.ts';
import { groupBy } from '../lists.ts';
import type { ModelGateway } from '../models/gateway.ts';
import { enqueueDerivedOpportunityRefresh } from '../opportunities/enqueue.ts';
import { resolveCrawlId, type Scope } from '../opportunities/sources.ts';
import { canonicalPage } from '../page-identity.ts';
import { callStructured, configuredGateway, type ModelCall } from '../perception/model-call.ts';
import { payloadString, taskProject, type Executor } from '../queue/executor.ts';
import type { QueueTask } from '../queue/task-queue.ts';
import { compareText } from '../text-order.ts';
import { latestBrandRunId } from '../visibility/selection.ts';
import { aggregateAngle } from './aggregate.ts';
import { aggregateKey, clusterKey, matchKey } from './keys.ts';
import { assignLineages } from './lineage.ts';
import {
  contentPages,
  latestSucceededRun,
  loadAngleInputs,
  resolveAnchor,
  type AngleInputs,
  type CitedUrl,
  type Limitation,
  type SucceededRun,
} from './load.ts';
import {
  angleId,
  clusterPrompt,
  clusterResponseSchema,
  matchPrompt,
  matchResponseSchema,
  memberId,
  pageId,
} from './model.ts';
import { ownedCandidates, tokenizePages } from './prefilter.ts';
import { validateAngles, validateMatches, type Validated } from './validate.ts';

const p = policy.content_optimization;

type Trigger = { kind: string; id: string };
type Keys = { cluster: string; match: string; aggregate: string };
type TopicGroup = { topicId: string | null; urls: CitedUrl[] };

/** An angle with its members, before its owned match. */
type Clustered = { topicId: string | null; label: string; members: CitedUrl[] };
/** The owned content page an angle matched; its URL is null once the page is gone. */
type OwnedPage = { siteUrlId: string; canonicalUrl: string | null };
/** An angle with its owned match, before aggregation. */
type Matched = Clustered & { page: OwnedPage | null };

type Prepared = {
  scope: Scope;
  inputs: AngleInputs;
  groups: TopicGroup[];
  keys: Keys;
  limitations: Limitation[];
};

type Outcome =
  | { outcome: 'succeeded'; angles: Matched[]; calls: StepCall[] }
  | { outcome: 'failed'; reason: string; calls: StepCall[] };

type StepCall = { step: 'cluster' | 'match'; topicId: string | null; call: ModelCall };

const topicOrder = (a: string | null, b: string | null) => compareText(a ?? '', b ?? '');

/**
 * The topics worth clustering, each with its most-cited URLs. A topic below
 * the citation or domain minimum can never raise a gap, so it is recorded as a
 * limitation instead of sent to the model.
 */
function topicGroups(external: readonly CitedUrl[]) {
  const limitations: Limitation[] = [];
  const groups: TopicGroup[] = [];
  let thin = 0;
  let truncated = 0;
  let dropped = 0;
  const byTopic = [...groupBy(external, (url) => url.topicId)].sort(([a], [b]) => topicOrder(a, b));
  for (const [topicId, urls] of byTopic) {
    const citations = urls.reduce((sum, url) => sum + url.citations.length, 0);
    const domains = new Set(urls.map((url) => url.domain.toLowerCase())).size;
    if (citations < p.min_citations || domains < p.min_domains) {
      thin += 1;
      continue;
    }
    const ranked = [...urls].sort(
      (a, b) =>
        b.citations.length - a.citations.length || compareText(a.canonicalUrl, b.canonicalUrl),
    );
    if (ranked.length > p.max_urls_per_topic) {
      truncated += 1;
      dropped += ranked.length - p.max_urls_per_topic;
    }
    groups.push({ topicId, urls: ranked.slice(0, p.max_urls_per_topic) });
  }
  if (thin) limitations.push({ code: 'too_few_citations', topics: thin });
  if (truncated) limitations.push({ code: 'urls_truncated', topics: truncated, dropped });
  return { groups, limitations };
}

/** The inputs, the groups the model would see and the three keys, or null without an audit. */
async function prepare(db: Database, scope: Scope, model: string | null): Promise<Prepared | null> {
  const anchor = await resolveAnchor(db, scope);
  if (anchor === null) return null;
  const inputs = await loadAngleInputs(db, scope, anchor);
  const { groups, limitations } = topicGroups(inputs.external);
  const cluster = clusterKey({
    methodologyVersion: p.methodology_version,
    model,
    language: inputs.market.language,
    config: {
      gap_sources: p.gap_sources,
      max_urls_per_topic: p.max_urls_per_topic,
      min_citations: p.min_citations,
      min_domains: p.min_domains,
      max_label_chars: p.max_label_chars,
    },
    urls: groups.flatMap((group) => group.urls),
  });
  const keys = {
    cluster,
    match: matchKey({
      clusterKey: cluster,
      crawlId: inputs.crawlId,
      methodologyVersion: p.methodology_version,
      model,
      config: {
        owned_candidates_per_angle: p.owned_candidates_per_angle,
        content_page_kinds: p.content_page_kinds,
        content_excerpt_chars: p.content_excerpt_chars,
        max_content_pages: p.max_content_pages,
      },
    }),
    aggregate: aggregateKey({ formulaVersion: p.formula_version, auditIds: inputs.audits.ids }),
  };
  return { scope, inputs, groups, keys, limitations: [...inputs.limitations, ...limitations] };
}

const sameKeys = (run: SucceededRun | undefined, keys: Keys) =>
  run !== undefined &&
  run.cluster_key === keys.cluster &&
  run.match_key === keys.match &&
  run.aggregate_key === keys.aggregate;

/** One angle of an earlier succeeded run, as reuse and lineage assignment read it. */
type PreviousAngle = {
  lineageId: string;
  topicId: string | null;
  label: string;
  page: OwnedPage | null;
  memberUrls: string[];
};

/** A run's angles with their members and owned match. */
async function runAngles(db: Database, scope: Scope, runId: string): Promise<PreviousAngle[]> {
  const angles = await db
    .selectFrom('content_angles as angle')
    .leftJoin('content_angle_owned_matches as match', (join) =>
      join
        .onRef('match.angle_id', '=', 'angle.id')
        .on('match.workspace_id', '=', scope.workspaceId),
    )
    .leftJoin('site_urls as url', (join) =>
      join
        .onRef('url.id', '=', 'match.site_url_id')
        .on('url.workspace_id', '=', scope.workspaceId)
        .on('url.project_id', '=', scope.projectId),
    )
    .select([
      'angle.id',
      'angle.lineage_id',
      'angle.topic_id',
      'angle.label',
      'match.site_url_id',
      'url.normalized_url',
    ])
    .where('angle.workspace_id', '=', scope.workspaceId)
    .where('angle.run_id', '=', runId)
    .orderBy('angle.id')
    .execute();
  const members = angles.length
    ? await db
        .selectFrom('content_angle_members')
        .select(['angle_id', 'canonical_url'])
        .where('workspace_id', '=', scope.workspaceId)
        .where(
          'angle_id',
          'in',
          angles.map((angle) => angle.id),
        )
        .execute()
    : [];
  const urls = groupBy(members, (member) => member.angle_id);
  return angles.map((angle) => ({
    lineageId: angle.lineage_id,
    topicId: angle.topic_id,
    label: angle.label,
    page:
      angle.site_url_id === null
        ? null
        : {
            siteUrlId: angle.site_url_id,
            canonicalUrl:
              angle.normalized_url === null
                ? null
                : (canonicalPage(angle.normalized_url) ?? angle.normalized_url),
          },
    memberUrls: (urls.get(angle.id) ?? []).map((member) => member.canonical_url),
  }));
}

/**
 * A task's reads of earlier runs' angles, each run read once: runs and their
 * angles are insert-only, so the persist step reuses what the compute read.
 */
function angleReader(scope: Scope) {
  const read = new Map<string, Promise<PreviousAngle[]>>();
  return (db: Database, runId: string) => {
    let angles = read.get(runId);
    if (angles === undefined) {
      angles = runAngles(db, scope, runId);
      read.set(runId, angles);
    }
    return angles;
  };
}

type AngleReader = ReturnType<typeof angleReader>;

/** The earlier clustering mapped onto the current URLs, or null when any member is gone. */
function reusedClustering(previous: readonly PreviousAngle[], groups: readonly TopicGroup[]) {
  const current = new Map(
    groups.flatMap((group) =>
      group.urls.map((url) => [JSON.stringify([url.topicId, url.canonicalUrl]), url] as const),
    ),
  );
  const angles: Matched[] = [];
  for (const angle of previous) {
    const members = angle.memberUrls.map((url) =>
      current.get(JSON.stringify([angle.topicId, url])),
    );
    if (members.includes(undefined)) return null;
    angles.push({
      topicId: angle.topicId,
      label: angle.label,
      members: members.filter((member) => member !== undefined),
      page: angle.page,
    });
  }
  return angles;
}

type Step<T> =
  | { ok: true; value: T; call: ModelCall }
  | { ok: false; reason: string; call: ModelCall | null };

/** One structured call, its output validated; a rejected output is a failure, not a retry. */
async function modelStep<Value, T>(
  gateway: ModelGateway,
  request: { system: string; user: string; inputHash: string },
  schema: z.ZodType<Value>,
  validate: (value: Value) => Validated<T>,
): Promise<Step<T>> {
  const { call, outcome } = await callStructured(
    gateway,
    { ...request, schema, maxAttempts: p.model_max_attempts },
    validate,
  );
  if ('outcome' in outcome)
    return {
      ok: false,
      reason: outcome.outcome === 'model_error' ? `model_error:${outcome.reason}` : outcome.outcome,
      call,
    };
  if (!outcome.ok) return { ok: false, reason: `rejected:${outcome.reason}`, call };
  return { ok: true, value: outcome.value, call };
}

async function cluster(
  gateway: ModelGateway,
  prepared: Prepared,
  checkCancelled: (boundary: string) => Promise<void>,
  calls: StepCall[],
): Promise<Validated<Clustered[]>> {
  const angles: Clustered[] = [];
  for (const group of prepared.groups) {
    await checkCancelled('content_angle_cluster_call'); // NOSONAR -- One bounded call per topic, in order.
    const request = clusterPrompt({
      language: prepared.inputs.market.language,
      maxLabelChars: p.max_label_chars,
      urls: group.urls,
    });
    const step = await modelStep(gateway, request, clusterResponseSchema, (value) =>
      validateAngles(value, {
        memberIds: group.urls.map((_, index) => memberId(index)),
        maxLabelChars: p.max_label_chars,
      }),
    );
    if (step.call) calls.push({ step: 'cluster', topicId: group.topicId, call: step.call });
    if (!step.ok) return { ok: false, reason: step.reason };
    const byId = new Map(group.urls.map((url, index) => [memberId(index), url]));
    for (const angle of step.value)
      angles.push({
        topicId: group.topicId,
        label: angle.label,
        members: angle.memberIds.flatMap((id) => byId.get(id) ?? []),
      });
  }
  return { ok: true, value: angles };
}

const angleTerms = (angle: Clustered) =>
  lexicalTokens([angle.label, ...angle.members.map((member) => member.title)].join(' '));

async function match(
  db: Database,
  gateway: ModelGateway | null,
  prepared: Prepared,
  angles: readonly Clustered[],
  checkCancelled: (boundary: string) => Promise<void>,
  calls: StepCall[],
): Promise<Validated<Matched[]>> {
  const { scope, inputs } = prepared;
  // Content pages are read only when there is an angle to match.
  const pages = tokenizePages(
    angles.length && inputs.crawlId !== null ? await contentPages(db, scope, inputs.crawlId) : [],
  );
  const matched: Matched[] = [];
  for (const [topicId, topicAngles] of groupBy(angles, (angle) => angle.topicId)) {
    const candidates = topicAngles.map((angle) =>
      ownedCandidates(angleTerms(angle), pages, p.owned_candidates_per_angle),
    );
    // No content page covers any term: nothing to pick, so no call.
    if (candidates.every((list) => !list.length)) {
      matched.push(...topicAngles.map((angle) => ({ ...angle, page: null })));
      continue;
    }
    if (gateway === null) return { ok: false, reason: 'model_not_configured' };
    const offered = [...new Map(candidates.flat().map((page) => [page.siteUrlId, page])).values()];
    const pageIds = new Map(offered.map((page, index) => [page.siteUrlId, pageId(index)]));
    const byPageId = new Map(offered.map((page, index) => [pageId(index), page]));
    await checkCancelled('content_angle_match_call'); // NOSONAR -- One bounded call per topic, in order.
    const request = matchPrompt({
      language: inputs.market.language,
      angles: topicAngles.map((angle, index) => ({
        label: angle.label,
        titles: angle.members.map((member) => member.title),
        candidates: candidates[index]!.map((page) => page.siteUrlId),
      })),
      pages: offered,
      pageIds,
    });
    const step = await modelStep(gateway, request, matchResponseSchema, (value) =>
      validateMatches(value, {
        angles: topicAngles.map((_, index) => ({
          id: angleId(index),
          candidateIds: candidates[index]!.map((page) => pageIds.get(page.siteUrlId)!),
        })),
      }),
    );
    if (step.call) calls.push({ step: 'match', topicId, call: step.call });
    if (!step.ok) return { ok: false, reason: step.reason };
    topicAngles.forEach((angle, index) => {
      const picked = step.value.get(angleId(index));
      const page = picked === undefined || picked === null ? undefined : byPageId.get(picked);
      matched.push({
        ...angle,
        page: page ? { siteUrlId: page.siteUrlId, canonicalUrl: page.canonicalUrl } : null,
      });
    });
  }
  return { ok: true, value: matched };
}

/** The run's angles, reusing what the latest succeeded run computed over the same keys. */
async function compute(
  db: Database,
  prepared: Prepared,
  previous: { run: SucceededRun | undefined; angles: AngleReader },
  raw: ModelGateway | null,
  checkCancelled: (boundary: string) => Promise<void>,
): Promise<Outcome> {
  const calls: StepCall[] = [];
  const gateway = raw && meterFor(db, prepared.scope.workspaceId).gateway(raw, 'content_angles');
  const fail = (reason: string): Outcome => ({ outcome: 'failed', reason, calls });
  const { run } = previous;
  // The earlier run's angles are read only when its clustering can be reused.
  const reused =
    run?.cluster_key === prepared.keys.cluster
      ? reusedClustering(await previous.angles(db, run.id), prepared.groups)
      : null;
  if (reused && run?.match_key === prepared.keys.match)
    return { outcome: 'succeeded', calls, angles: reused };
  let clustered: Clustered[];
  if (reused) clustered = reused;
  else if (!prepared.groups.length) clustered = [];
  else if (gateway === null) return fail('model_not_configured');
  else {
    const result = await cluster(gateway, prepared, checkCancelled, calls);
    if (!result.ok) return fail(result.reason);
    clustered = result.value;
  }
  const matched = await match(db, gateway, prepared, clustered, checkCancelled, calls);
  if (!matched.ok) return fail(matched.reason);
  return { outcome: 'succeeded', angles: matched.value, calls };
}

const usageOf = (calls: readonly StepCall[]) =>
  calls.length
    ? JSON.stringify(
        calls.map(({ step, topicId, call }) => ({
          step,
          topic_id: topicId,
          input_hash: call.inputHash,
          latency_ms: call.latencyMs,
          ...call.usage,
        })),
      )
    : null;

/** Whether the anchor audit or the latest crawl differs from the ones `prepared` read. */
async function inputsMoved(trx: Database, prepared: Prepared) {
  const { scope, inputs } = prepared;
  // One transaction connection runs one statement at a time.
  const auditId = await latestBrandRunId(trx, { ...scope, marketId: null });
  return (
    auditId !== inputs.audits.anchor.auditId ||
    (await resolveCrawlId(trx, scope)) !== inputs.crawlId
  );
}

/** Persist one run under the per-project lock; nothing when the latest succeeded run has its keys. */
function persist(
  prepared: Prepared,
  trigger: Trigger,
  model: { provider: string | null; model: string | null },
  outcome: Outcome,
  previousAngles: AngleReader,
) {
  return async (trx: Database) => {
    const { scope, inputs, keys } = prepared;
    await subjectXactLock(trx, ['content-angles', scope.workspaceId, scope.projectId].join(':'));
    // A newer audit or crawl landed while this task computed: writing would put
    // stale inputs over a newer run. Its own trigger enqueues the recompute.
    if (await inputsMoved(trx, prepared)) return;
    const latest = await latestSucceededRun(trx, scope);
    if (sameKeys(latest, keys)) return;
    const runId = randomUUID();
    const now = new Date();
    const tenancy = { workspace_id: scope.workspaceId, project_id: scope.projectId };
    await trx
      .insertInto('content_angle_runs')
      .values({
        id: runId,
        ...tenancy,
        trigger_kind: trigger.kind,
        trigger_id: trigger.id,
        market_country: inputs.market.country,
        market_language: inputs.market.language,
        window_start: storedInstant(inputs.audits.anchor.windowStart),
        window_end: storedInstant(inputs.audits.anchor.windowEnd),
        audit_ids: inputs.audits.ids,
        crawl_id: inputs.crawlId,
        cluster_key: keys.cluster,
        match_key: keys.match,
        aggregate_key: keys.aggregate,
        model_provider: model.provider,
        model: model.model,
        methodology_version: p.methodology_version,
        formula_version: p.formula_version,
        outcome: outcome.outcome,
        outcome_reason: outcome.outcome === 'failed' ? outcome.reason : null,
        limitations: JSON.stringify(prepared.limitations),
        usage: usageOf(outcome.calls),
        created_at: now,
      })
      .execute();
    if (outcome.outcome === 'failed') return;
    // Lineage is decided under the lock, against the latest succeeded run before this one.
    const previous = latest ? await previousAngles(trx, latest.id) : [];
    await insertAngles(trx, prepared, { id: runId, previous }, outcome.angles, now);
    await enqueueDerivedOpportunityRefresh(trx, {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      triggerKind: 'content_angles',
      triggerId: runId,
    });
  };
}

async function insertAngles(
  trx: Database,
  prepared: Prepared,
  run: { id: string; previous: readonly PreviousAngle[] },
  angles: readonly Matched[],
  now: Date,
) {
  if (!angles.length) return;
  const { id: runId, previous } = run;
  const { scope, inputs } = prepared;
  const tenancy = { workspace_id: scope.workspaceId, project_id: scope.projectId };
  const keyed = angles.map((angle) => ({ ...angle, id: randomUUID() }));
  const inherited = assignLineages(
    previous,
    keyed.map((angle) => ({
      key: angle.id,
      topicId: angle.topicId,
      memberUrls: angle.members.map((member) => member.canonicalUrl),
    })),
    p.lineage_min_overlap,
  );
  const lineages = new Map(
    keyed.map((angle) => [angle.id, inherited.get(angle.id) ?? randomUUID()]),
  );
  const fresh = keyed.filter((angle) => !inherited.get(angle.id));
  // A lineage's planned-page key is its first label's, fixed here and never
  // rewritten, so a relabelled angle keeps its planned-page Action.
  if (fresh.length)
    await trx
      .insertInto('content_angle_lineages')
      .values(
        fresh.map((angle) => ({
          id: lineages.get(angle.id)!,
          ...tenancy,
          topic_id: angle.topicId,
          planned_page_key: plannedPageKey(angle.label),
          first_run_id: runId,
          created_at: now,
        })),
      )
      .execute();
  const aggregates = keyed.map((angle) =>
    aggregateAngle(angle, angle.page?.canonicalUrl ?? null, inputs.owned),
  );
  await trx
    .insertInto('content_angles')
    .values(
      keyed.map((angle, index) => ({
        id: angle.id,
        ...tenancy,
        run_id: runId,
        lineage_id: lineages.get(angle.id)!,
        topic_id: angle.topicId,
        label: angle.label,
        citation_count: aggregates[index]!.citationCount,
        domain_count: aggregates[index]!.domainCount,
        competitor_count: aggregates[index]!.competitorCount,
        prompt_ids: aggregates[index]!.promptIds,
        engines: aggregates[index]!.engines,
        created_at: now,
      })),
    )
    .execute();
  await trx
    .insertInto('content_angle_members')
    .values(
      keyed.flatMap((angle) =>
        angle.members.map((member) => ({
          id: randomUUID(),
          ...tenancy,
          angle_id: angle.id,
          canonical_url: member.canonicalUrl,
          url_hash: member.urlHash,
          title: member.title,
          domain: member.domain,
          classification: member.classification,
          matched_competitor: member.matchedCompetitor,
          source_class: member.sourceClass,
          citation_count: member.citations.length,
          citation_ids: member.citations.map((citation) => citation.id).sort(compareText),
          created_at: now,
        })),
      ),
    )
    .execute();
  await trx
    .insertInto('content_angle_owned_matches')
    .values(
      keyed.map((angle, index) => ({
        id: randomUUID(),
        ...tenancy,
        angle_id: angle.id,
        site_url_id: angle.page?.siteUrlId ?? null,
        method: angle.page === null ? 'none' : 'model_pick',
        owned_cited: aggregates[index]!.ownedCited,
        owned_citation_ids: aggregates[index]!.ownedCitationIds,
        created_at: now,
      })),
    )
    .execute();
}

function taskTrigger(task: QueueTask): Trigger {
  const kind = payloadString(task, 'trigger_kind');
  const id = parseUuid(payloadString(task, 'trigger_id'));
  if (kind === null || id === null)
    throw new Error('content_angle_refresh payload missing trigger_kind/trigger_id');
  return { kind, id };
}

/** The task body: settle a run for the project's current inputs, or nothing when they are unchanged. */
async function refreshContentAngles(
  db: Database,
  scope: Scope,
  task: QueueTask,
  context: {
    gateway: ModelGateway | null;
    checkCancelled: (boundary: string) => Promise<void>;
  },
) {
  const trigger = taskTrigger(task);
  const raw = context.gateway;
  const prepared = await prepare(db, scope, raw?.model ?? null);
  if (prepared === null) return;
  const latest = await latestSucceededRun(db, scope);
  if (sameKeys(latest, prepared.keys)) return;
  const angles = angleReader(scope);
  const outcome = await compute(db, prepared, { run: latest, angles }, raw, context.checkCancelled);
  const model = {
    provider: raw?.adapter ?? null,
    model: outcome.calls.at(-1)?.call.model ?? raw?.model ?? null,
  };
  return { error: null, persist: persist(prepared, trigger, model, outcome, angles) };
}

/** The `content_angle_refresh` executor over the deployment's gateway (tests pass a fake). */
export function contentAngleRefresh(
  gatewayFactory: () => ModelGateway | null = configuredGateway,
): Executor {
  return async (task, { db, checkCancelled }) => {
    const scope = { workspaceId: task.workspace_id, projectId: await taskProject(db, task) };
    return refreshContentAngles(db, scope, task, { gateway: gatewayFactory(), checkCancelled });
  };
}

/** A task that exhausted its attempts still leaves a failed run explaining it. */
export async function compensateContentAngles(db: Database, task: QueueTask) {
  const scope = { workspaceId: task.workspace_id, projectId: await taskProject(db, task) };
  const raw = configuredGateway();
  const prepared = await prepare(db, scope, raw?.model ?? null);
  if (prepared === null) return;
  await db
    .transaction()
    .execute(
      persist(
        prepared,
        taskTrigger(task),
        { provider: raw?.adapter ?? null, model: raw?.model ?? null },
        { outcome: 'failed', reason: 'task_failed', calls: [] },
        angleReader(scope),
      ),
    );
}
