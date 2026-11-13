/**
 * The Opportunity refresh: read persisted evidence, detect,
 * score, and supersede the project's live set with one immutable snapshot.
 *
 * A missing source is not an error. With a prior snapshot and no resolvable
 * audit, crawl or demand snapshot, the prior snapshot is returned unchanged,
 * so an in-flight crawl never empties the live set; zero hits WITH a source
 * still supersedes, and so does a snapshot whose aging sources (keyword or
 * content gaps) have aged out. A refresh whose source identity the latest snapshot
 * already describes loads no evidence. Evidence loads outside the project
 * lock; under it the identity is resolved again, and a refresh whose sources
 * moved meanwhile writes nothing and fails for a retry over the newer state.
 * No provider or network I/O happens anywhere in the refresh. Each evidence
 * family is one entry in `refresh-families.ts`.
 */
import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import { record } from '../db/json.ts';
import type { Database } from '../db/database.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import { notFound } from '../errors.ts';
import { acquireProjectLock } from '../prompts/locks.ts';
import { taskProject, type Executor } from '../queue/executor.ts';
import { syncActions } from './action-sync.ts';
import {
  buildSnapshot,
  newOpportunity,
  projectSnapshot,
  sameIdentity,
  scoreHits,
  snapshotIsCurrent,
  type SourceIdentity,
  type NewOpportunity,
  type Scored,
} from './refresh-compute.ts';
import {
  collectFamilies,
  readAgingSource,
  resolveSources,
  sourceIdentity,
  type Sources,
} from './refresh-families.ts';
import { latestSnapshot, type Scope } from './sources.ts';
import { firstOf } from '../lists.ts';

type Collected = Awaited<ReturnType<typeof collectFamilies>>;
type Resolved = Sources & { identity: SourceIdentity };

const INSERT_BATCH = 500;

/** The shared sources and every family's identity over them. */
async function resolve(db: Database, scope: Scope, at: Date): Promise<Resolved> {
  const sources = await resolveSources(db, scope, at);
  return { ...sources, identity: await sourceIdentity(db, scope, sources) };
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
  {
    collected,
    sources,
    scored,
  }: {
    collected: Collected;
    sources: Resolved;
    scored: Scored[];
  },
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
      { auditId: collected.audit?.id ?? null, crawl, demand: sources.demand },
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
    rows.map((row, index) => ({ ...row, target: scored[index]![0].target })),
    snapshot.id,
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
  const sources = await resolve(db, scope, at);
  const prior = await latestSnapshot(db, scope);
  if (options.skipIfCurrent && snapshotIsCurrent(prior, sources.identity))
    return projectSnapshot(prior!);
  const collected = await collectFamilies(db, scope, sources, sources.identity);
  const scored = scoreHits(collected.hits);
  return db.transaction().execute(async (trx) => {
    await acquireProjectLock(trx, scope.projectId);
    const current = await latestSnapshot(trx, scope);
    const latest = await resolve(trx, scope, at);
    // Writing a reading older than a source committed during the load would
    // supersede what that source says; the retry reads the newer state.
    if (!sameIdentity(latest.identity, sources.identity))
      throw new Error('Opportunity sources changed during the refresh; retry');
    // Some sources age out by design, so a snapshot that read one is superseded
    // when it does; an in-flight crawl alone never empties the live set.
    const empty =
      !collected.present && !readAgingSource(record(record(current?.coverage).source_identity));
    if (current !== null && empty) return projectSnapshot(current);
    if (options.skipIfCurrent && snapshotIsCurrent(current, sources.identity))
      return projectSnapshot(current!);
    return writeRefresh(trx, scope, { collected, sources, scored });
  });
}

/** `opportunity_refresh`: an automatic refresh that skips when already current. */
export const refreshOpportunities: Executor = async (task, { db, checkCancelled }) => {
  const scope = { workspaceId: task.workspace_id, projectId: await taskProject(db, task) };
  await checkCancelled('opportunity refresh');
  await recomputeOpportunities(db, scope, { skipIfCurrent: true });
};
