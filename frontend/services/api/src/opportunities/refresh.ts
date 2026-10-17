/**
 * The Opportunity refresh: read persisted evidence, detect,
 * score, and supersede the project's live set with one immutable snapshot.
 *
 * A missing source is not an error. With a prior snapshot and no resolvable
 * audit, crawl or demand snapshot, the prior snapshot is returned unchanged,
 * so an in-flight crawl never empties the live set; zero hits WITH a source
 * still supersedes, and so does a snapshot whose keyword gaps have aged out. A refresh whose source identity the latest snapshot
 * already describes loads no evidence. Evidence loads outside the project
 * lock; under it the identity is resolved again, and a refresh whose sources
 * moved meanwhile writes nothing and fails for a retry over the newer state.
 * No provider or network I/O happens anywhere in the refresh.
 */
import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import { record } from '../db/json.ts';
import { policy } from '../config.ts';

const o = policy.opportunity.opportunities;

import {
  detectSiteIssueOpportunities,
  detectBrandAbsentHighValuePrompt,
  detectOwnedPageNotCited,
} from '../analysis/opportunities/detectors.ts';
import type { DetectorHit } from '../analysis/opportunities/evidence.ts';
import {
  buildSourceProjection,
  emptySourceProjection,
} from '../analysis/opportunities/source-mix.ts';
import type { Database } from '../db/database.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import { notFound } from '../errors.ts';
import { acquireProjectLock } from '../prompts/locks.ts';
import { taskProject, type Executor } from '../workers/executor.ts';
import { syncActions } from './action-sync.ts';
import { earnedPageHits } from './earned-page-hits.ts';
import {
  availableFamilies,
  buildSnapshot,
  newOpportunity,
  projectSnapshot,
  sameIdentity,
  scoreHits,
  snapshotIsCurrent,
  type SourceIdentity,
  stampSourceMix,
  type NewOpportunity,
  type Scored,
} from './refresh-compute.ts';
import {
  confirmedDeclineHits,
  loadSiteEvidence,
  loadVisibilityEvidence,
} from './refresh-evidence.ts';
import { changeHits, commerceHits, demandHits } from './refresh-hits.ts';
import { internalLinkHits, internalLinkRunId } from './internal-link-hits.ts';
import { searchGapHits, searchGapSource, type SearchGapSource } from './search-gap-hits.ts';
import {
  currentDemandSnapshot,
  latestSnapshot,
  resolveAudit,
  resolveCrawl,
  type AuditSource,
  type CrawlSource,
  type DemandSource,
  type Scope,
} from './sources.ts';
import { firstOf } from '../lists.ts';

type Collected = {
  /** Evidence a load cap left out, carried onto the snapshot. */
  limitations: string[];
  audit: AuditSource | null;
  demand: DemandSource | null;
  hits: DetectorHit[];
  sourceMix: Record<string, unknown>;
};
type Sources = {
  audit: AuditSource | null;
  crawl: CrawlSource | null;
  demand: DemandSource | null;
  gaps: SearchGapSource | null;
  identity: SourceIdentity;
};

const INSERT_BATCH = 500;

async function auditHits(
  db: Database,
  scope: Scope,
  audit: AuditSource,
): Promise<{
  audit: AuditSource | null;
  hits: DetectorHit[];
  sourceMix: Record<string, unknown>;
  limitations: string[];
}> {
  const [visibility, metricId, limitations] = await loadVisibilityEvidence(
    db,
    scope.workspaceId,
    audit,
  );
  if (metricId === null)
    return { audit: null, hits: [], sourceMix: emptySourceProjection(), limitations: [] };
  let hits = [
    ...detectBrandAbsentHighValuePrompt(visibility),
    ...detectOwnedPageNotCited(visibility),
  ];
  const gaps = [
    ...new Set(
      hits.flatMap((hit) =>
        'prompt_index' in hit.evidence ? [Number(hit.evidence.prompt_index)] : [],
      ),
    ),
  ];
  const sourceMix: Record<string, unknown> = buildSourceProjection(visibility.analyses, gaps);
  stampSourceMix(audit.id, visibility.prompt_snapshots, gaps, sourceMix);
  // Page-keyed, over the FULL eligible answer set rather than the gap prompts.
  hits.push(...(await earnedPageHits(db, scope, audit, visibility)));
  hits = hits.map((hit) => ({ ...hit, source_metric_ids: [metricId] }));
  hits.push(
    ...(await commerceHits(db, scope, audit.id)),
    ...(await confirmedDeclineHits(db, scope.workspaceId, audit.id)),
  );
  return { audit, hits, sourceMix, limitations };
}

/**
 * The source-page state earned-page hits read: the newest inspected reading
 * (older readings are immutable) and the latest change to any page's state,
 * which a failed or blocked inspection moves without a new reading.
 */
async function sourcePagesRevision(db: Database, scope: Scope) {
  const { rows } = await sql<{ reading: string | null; pages: string | null }>`
    select
      (select id from source_page_snapshots
        where workspace_id = ${scope.workspaceId} and project_id = ${scope.projectId}
          and outcome = ${policy.opportunity.refresh.source_page_outcome_inspected}
        order by fetched_at desc, id desc limit 1)::text as reading,
      (select max(updated_at) from source_pages
        where workspace_id = ${scope.workspaceId} and project_id = ${scope.projectId})::text as pages
  `.execute(db);
  const { reading = null, pages = null } = rows[0] ?? {};
  return reading === null && pages === null ? null : `${reading ?? ''}@${pages ?? ''}`;
}

/**
 * The sources a refresh would read now, without loading their evidence. `at`
 * is the one instant a refresh judges dataset age by, so both resolutions agree.
 */
async function resolveSources(db: Database, scope: Scope, at: Date): Promise<Sources> {
  const audit = await resolveAudit(db, scope);
  const crawl = await resolveCrawl(db, scope);
  const demand = await currentDemandSnapshot(db, scope);
  const gaps = await searchGapSource(db, scope, at);
  return {
    audit,
    crawl,
    demand,
    gaps,
    identity: {
      audit_id: audit?.id ?? null,
      site_crawl_id: crawl?.id ?? null,
      demand_snapshot_id: demand?.id ?? null,
      demand_source_revision: demand?.source_hash ?? null,
      internal_link_run_id: crawl ? await internalLinkRunId(db, scope, crawl.id) : null,
      source_pages_revision: await sourcePagesRevision(db, scope),
      search_gap_revision: gaps?.revision ?? null,
    },
  };
}

async function collectHits(db: Database, scope: Scope, sources: Sources): Promise<Collected> {
  const collected: Collected = {
    limitations: [],
    audit: sources.audit,
    demand: sources.demand,
    hits: await demandHits(db, scope, sources.demand),
    sourceMix: emptySourceProjection(),
  };
  if (sources.audit !== null) {
    const found = await auditHits(db, scope, sources.audit);
    collected.audit = found.audit;
    collected.hits.push(...found.hits);
    collected.sourceMix = found.sourceMix;
    collected.limitations.push(...found.limitations);
  }
  if (sources.crawl !== null) {
    const site = await loadSiteEvidence(db, scope.workspaceId, sources.crawl);
    collected.hits.push(...detectSiteIssueOpportunities(site));
    if (site.truncated)
      collected.limitations.push(
        `Only the first ${o.RECOMPUTE_MAX_ISSUES} Site Health findings were ranked; later ones are not shown.`,
      );
    collected.hits.push(
      ...(await internalLinkHits(db, scope, sources.identity.internal_link_run_id)),
      ...(await changeHits(db, scope.workspaceId, sources.crawl)),
    );
  }
  const gaps = await searchGapHits(db, scope, sources.gaps, sources.demand, sources.crawl);
  collected.hits.push(...gaps.hits);
  collected.limitations.push(...gaps.limitations);
  return collected;
}

const idsJson = (values: string[]) => JSON.stringify(values);

async function insertOpportunities(
  trx: Database,
  scope: Scope,
  rows: NewOpportunity[],
  actions: Map<string, string>,
  createdAt: string,
) {
  for (let start = 0; start < rows.length; start += INSERT_BATCH) {
    await trx
      .insertInto('opportunities')
      .values(
        rows.slice(start, start + INSERT_BATCH).map((row) => ({
          ...row,
          workspace_id: scope.workspaceId,
          project_id: scope.projectId,
          evidence: JSON.stringify(row.evidence),
          source_analysis_ids: idsJson(row.source_analysis_ids),
          source_issue_ids: idsJson(row.source_issue_ids),
          source_metric_ids: idsJson(row.source_metric_ids),
          action_id: actions.get(row.id) ?? null,
          created_at: createdAt,
          updated_at: createdAt,
        })),
      )
      .execute();
  }
}

/** Supersede the live set with `scored` and one snapshot; the projected snapshot. */
async function writeRefresh(
  trx: Database,
  scope: Scope,
  collected: Collected,
  sources: Sources,
  scored: Scored[],
) {
  const crawl = sources.crawl;
  const workspace = new WorkspaceScope(scope.workspaceId);
  const live = await workspace
    .selectFrom(trx, 'opportunities')
    .select(['id', 'rule_id', 'target_key'])
    .where('project_id', '=', scope.projectId)
    .where('superseded_at', 'is', null)
    .execute();
  const rows: NewOpportunity[] = scored.map(([hit, score]) => ({
    id: randomUUID(),
    ...newOpportunity(hit, score),
  }));
  const successors = new Map(
    rows.map((row) => [JSON.stringify([row.rule_id, row.target_key]), row.id]),
  );
  // One microsecond database time for the whole refresh, so two refreshes in
  // the same millisecond still order by created_at rather than by random id.
  const { rows: clock } = await sql<{
    now: string;
  }>`select clock_timestamp()::text as now`.execute(trx);
  const now = firstOf(clock, 'the database clock row').now;
  if (live.length) {
    await trx
      .updateTable('opportunities')
      .set({ superseded_at: now, updated_at: now })
      .where(
        'id',
        'in',
        live.map((row) => row.id),
      )
      .execute();
  }
  const snapshot = {
    id: randomUUID(),
    ...buildSnapshot(
      { auditId: collected.audit?.id ?? null, crawl, demand: collected.demand },
      rows,
      scored,
      collected.sourceMix,
    ),
  };
  await trx
    .insertInto('opportunity_snapshots')
    .values({
      ...snapshot,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      coverage: JSON.stringify({
        ...record(snapshot.coverage),
        source_identity: sources.identity,
      }),
      limitations: JSON.stringify([...snapshot.limitations, ...collected.limitations]),
      source_mix: JSON.stringify(snapshot.source_mix),
      counts_by_type: JSON.stringify(snapshot.counts_by_type),
      counts_by_severity: JSON.stringify(snapshot.counts_by_severity),
      source_analysis_ids: idsJson(snapshot.source_analysis_ids),
      source_issue_ids: idsJson(snapshot.source_issue_ids),
      created_at: now,
    })
    .execute();
  const actions = await syncActions(
    trx,
    scope,
    rows,
    snapshot.id,
    availableFamilies({
      audit: collected.audit !== null,
      demand: collected.demand !== null,
      crawl: crawl !== null,
      searchIntelligence: sources.gaps !== null,
    }),
  );
  await insertOpportunities(trx, scope, rows, actions, now);
  const links = live.flatMap((row) => {
    const successor = successors.get(JSON.stringify([row.rule_id, row.target_key]));
    return successor ? [sql`(${row.id}::uuid, ${successor}::uuid)`] : [];
  });
  if (links.length) {
    await sql`update opportunities set superseded_by_id = link.successor, updated_at = ${now}::timestamptz
      from (values ${sql.join(links)}) as link(id, successor)
      where opportunities.id = link.id and opportunities.workspace_id = ${scope.workspaceId}`.execute(
      trx,
    );
  }
  const written = await latestSnapshot(trx, scope);
  return projectSnapshot(written!);
}

/**
 * Recompute a project's Opportunities from its latest usable sources and
 * return the snapshot that describes them. `skipIfCurrent` returns the latest
 * snapshot, without loading evidence, when it already describes these exact
 * sources and versions.
 */
export async function recomputeOpportunities(
  db: Database,
  scope: Scope,
  options: { skipIfCurrent?: boolean } = {},
) {
  const project = await new WorkspaceScope(scope.workspaceId)
    .selectFrom(db, 'projects')
    .select('id')
    .where('id', '=', scope.projectId)
    .executeTakeFirst();
  if (!project) throw notFound('Project');
  const at = new Date();
  const sources = await resolveSources(db, scope, at);
  const prior = await latestSnapshot(db, scope);
  if (options.skipIfCurrent && snapshotIsCurrent(prior, sources.identity))
    return projectSnapshot(prior!);
  const collected = await collectHits(db, scope, sources);
  const scored = scoreHits(collected.hits);
  return db.transaction().execute(async (trx) => {
    await acquireProjectLock(trx, scope.projectId);
    const current = await latestSnapshot(trx, scope);
    const latest = await resolveSources(trx, scope, at);
    // Writing a reading older than a source committed during the load would
    // supersede what that source says; the retry reads the newer state.
    if (!sameIdentity(latest.identity, sources.identity))
      throw new Error('Opportunity sources changed during the refresh; retry');
    // Gap datasets age out by design, so a snapshot that read them is superseded
    // when they do; an in-flight crawl alone never empties the live set.
    const readGaps = Boolean(record(record(current?.coverage).source_identity).search_gap_revision);
    const empty =
      collected.audit === null &&
      sources.crawl === null &&
      sources.demand === null &&
      sources.gaps === null &&
      !readGaps;
    if (current !== null && empty) return projectSnapshot(current);
    if (options.skipIfCurrent && snapshotIsCurrent(current, sources.identity))
      return projectSnapshot(current!);
    return writeRefresh(trx, scope, collected, sources, scored);
  });
}

/** `opportunity_refresh`: an automatic refresh that skips when already current. */
export const refreshOpportunities: Executor = async (task, { db, checkCancelled }) => {
  const scope = { workspaceId: task.workspace_id, projectId: await taskProject(db, task) };
  await checkCancelled('opportunity refresh');
  await recomputeOpportunities(db, scope, { skipIfCurrent: true });
};
