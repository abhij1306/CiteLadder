/** Traffic refresh and display-only range projection. No provider I/O. */
import { randomUUID } from 'node:crypto';

import { blake2b } from '@noble/hashes/blake2.js';
import { sql } from 'kysely';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { isoDateText } from '../db/timestamps.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import { enqueueImplementationVerification } from '../opportunities/enqueue.ts';
import { enqueueTask } from '../referrals/enqueue.ts';
import { addDays } from '../referrals/projection.ts';
import type { QueueTask } from '../queue/task-queue.ts';
import { payloadWindow, requireProject, taskProject, type Executor } from '../workers/executor.ts';
import type { MetricRow } from './accumulators.ts';
import { hash } from './normalization.ts';
import { windowDays } from './performance.ts';
import { record } from '../db/json.ts';
import { TrafficProjectionBuilder, type Projection } from './projection.ts';
import { textSpan } from '../text-order.ts';
import { isNonEmpty, type NonEmpty } from '../lists.ts';
import {
  selectedPartition,
  partitionQuality,
  partitionEpoch,
  searchConsoleAnchor,
} from '../integrations/partitions.ts';
import { subjectXactLock } from '../db/advisory-lock.ts';
import { projectHosts } from '../integrations/host-scope.ts';

const p = policy.traffic;
type Target = {
  start: string;
  end: string;
  grain: string;
  preset: number | null;
  verifies: boolean;
  builder: TrafficProjectionBuilder;
};

/**
 * The Demand handoff revision: an order-independent digest (XOR of BLAKE2b-128
 * row-ID hashes) of the selected rows in the Demand window, so an unchanged
 * window dedupes however the refresh was triggered.
 */
class DemandRevision {
  private count = 0;
  private digest = 0n;
  private readonly start: string;
  private readonly end: string;
  constructor(start: string, end: string) {
    this.start = start;
    this.end = end;
  }
  add(row: Pick<MetricRow, 'id' | 'date'>) {
    if (row.date < this.start || row.date > this.end) return;
    this.count += 1;
    this.digest ^= BigInt(
      `0x${Buffer.from(blake2b(new TextEncoder().encode(row.id), { dkLen: 16 })).toString('hex')}`,
    );
  }
  revision() {
    return hash(
      JSON.stringify({
        metric_row_count: this.count,
        metric_row_digest: this.digest.toString(16).padStart(32, '0'),
        window: [this.start, this.end],
      }),
    ).slice(0, 24);
  }
}

async function persist(
  db: Database,
  task: QueueTask,
  target: Target,
  coverage: Record<string, unknown>,
  preserve: boolean,
): Promise<string | null> {
  const projection = target.builder.build();
  const content = {
    metrics: JSON.stringify(projection.metrics),
    dimension_counts: JSON.stringify(projection.dimension_counts),
    coverage: JSON.stringify(coverage),
    preset_window_days: target.preset,
    source_metric_row_ids: JSON.stringify(projection.source_metric_row_ids),
    source_artifact_ids: JSON.stringify(projection.source_artifact_ids),
    formula_version: p.TRAFFIC_FORMULA_VERSION,
    normalization_version: p.TRAFFIC_NORMALIZATION_VERSION,
    created_at: new Date(),
  };
  const row = await db
    .insertInto('traffic_snapshots')
    .values({
      id: randomUUID(),
      workspace_id: task.workspace_id,
      project_id: requireProject(task),
      window_start: target.start,
      window_end: target.end,
      granularity: target.grain,
      ...content,
    })
    .onConflict((conflict) => {
      const key = conflict.columns(['project_id', 'window_start', 'window_end', 'granularity']);
      return preserve
        ? key.doNothing()
        : key.doUpdateSet(content).where('traffic_snapshots.workspace_id', '=', task.workspace_id);
    })
    .returning('id')
    .executeTakeFirst();
  if (!row) return null;
  await replaceStats(db, task, row.id, projection);
  return row.id;
}

async function replaceStats(
  db: Database,
  task: QueueTask,
  snapshotId: string,
  projection: Projection,
) {
  const projectId = requireProject(task);
  const base = () => ({
    id: randomUUID(),
    workspace_id: task.workspace_id,
    project_id: projectId,
    snapshot_id: snapshotId,
    created_at: new Date(),
  });
  const data = (
    row:
      | Projection['pages'][number]
      | Projection['queries'][number]
      | Projection['dimensions'][number],
  ) => ({
    metrics: JSON.stringify(row.metrics),
    source_metric_row_ids: JSON.stringify(row.source_metric_row_ids),
    source_artifact_ids: JSON.stringify(row.source_artifact_ids),
  });
  for (const table of [
    'traffic_page_stats',
    'traffic_query_stats',
    'performance_dimension_stats',
  ] as const)
    await db
      .deleteFrom(table)
      .where('workspace_id', '=', task.workspace_id)
      .where('project_id', '=', projectId)
      .where('snapshot_id', '=', snapshotId)
      .execute();
  // Bound lookup and insert parameter counts as well as evidence reads.
  const size = p.TRAFFIC_METRIC_ROW_BATCH_SIZE;
  const ids = new Map<string, string>();
  for (let i = 0; i < projection.pages.length; i += size)
    for (const r of await new WorkspaceScope(task.workspace_id)
      .selectFrom(db, 'site_urls')
      .select(['id', 'url_hash'])
      .where('project_id', '=', projectId)
      .where(
        'url_hash',
        'in',
        projection.pages.slice(i, i + size).map((r) => r.url_hash),
      )
      .execute())
      ids.set(r.url_hash, r.id);
  for (let i = 0; i < projection.pages.length; i += size)
    await db
      .insertInto('traffic_page_stats')
      .values(
        projection.pages.slice(i, i + size).map((r) => ({
          ...base(),
          ...data(r),
          canonical_url: r.canonical_url,
          site_url_id: ids.get(r.url_hash) ?? null,
        })),
      )
      .execute();
  for (let i = 0; i < projection.queries.length; i += size)
    await db
      .insertInto('traffic_query_stats')
      .values(
        projection.queries
          .slice(i, i + size)
          .map((r) => ({ ...base(), ...data(r), normalized_query: r.normalized_query })),
      )
      .execute();
  for (let i = 0; i < projection.dimensions.length; i += size)
    await db
      .insertInto('performance_dimension_stats')
      .values(
        projection.dimensions.slice(i, i + size).map((r) => ({
          ...base(),
          ...data(r),
          dimension: r.dimension,
          dimension_key: r.dimension_key,
          display_value: r.display_value,
        })),
      )
      .execute();
}

async function scan(
  db: Database,
  task: QueueTask,
  targets: NonEmpty<Target>,
  demand: DemandRevision,
  checkCancelled: (boundary: string) => Promise<void>,
) {
  const columns = [
    'property_ref',
    'provider',
    'dataset',
    'date',
    'dimension_key',
    'resync_seq',
    'id',
  ] as const;
  const cursor = sql`(${sql.join(columns.map((c) => sql.ref(c)))})`;
  const { start, end } = textSpan(targets);
  let after: MetricRow | null = null;
  for (;;) {
    await checkCancelled('metric-row batch');
    let query = new WorkspaceScope(task.workspace_id)
      .selectFrom(db, 'integration_metric_rows')
      .selectAll()
      .select(isoDateText(sql.ref('date')).as('day'))
      .where('project_id', '=', requireProject(task))
      .where('dataset', 'in', p.TRAFFIC_PROJECTED_DATASETS)
      .where(selectedPartition())
      .where('date', '>=', sql<Date>`${start}::date`)
      .where('date', '<=', sql<Date>`${end}::date`)
      .limit(p.TRAFFIC_METRIC_ROW_BATCH_SIZE);
    for (const column of columns) query = query.orderBy(column);
    if (after)
      query = query.where(
        sql<boolean>`${cursor} > (${after.property_ref}, ${after.provider}, ${after.dataset}, ${after.date}::date, ${after.dimension_key}, ${after.resync_seq}, ${after.id}::uuid)`,
      );
    const rows = await query.execute();
    const inputs = rows.map((r) => ({ ...r, date: r.day, metrics: record(r.metrics) }));
    for (const target of targets) target.builder.addBatch(inputs, true);
    for (const row of inputs) demand.add(row);
    const last = inputs.at(-1);
    if (inputs.length < p.TRAFFIC_METRIC_ROW_BATCH_SIZE || !last) break;
    after = last;
  }
}

/**
 * The snapshots one refresh writes: the trigger window (display ranges only
 * where a granularity is missing), the presets ending at the Search Console
 * anchor, and the Demand policy window ending there too.
 */
function planTargets(input: {
  displayOnly: boolean;
  windowStart: string;
  windowEnd: string;
  anchor: string | null;
  existing: readonly string[];
  projectOrigin: string | undefined;
  allowedHosts: ReadonlySet<string>;
}) {
  const targets: Target[] = [];
  const add = (
    start: string,
    end: string,
    grain: string,
    preset: number | null,
    verifies: boolean,
  ) =>
    targets.push({
      start,
      end,
      grain,
      preset,
      verifies,
      builder: new TrafficProjectionBuilder({
        windowStart: start,
        windowEnd: end,
        granularity: grain,
        projectOrigin: input.projectOrigin,
        allowedHosts: input.allowedHosts,
      }),
    });
  for (const grain of p.TRAFFIC_SNAPSHOT_GRANULARITIES)
    if (!input.existing.includes(grain))
      add(
        input.windowStart,
        input.windowEnd,
        grain,
        null,
        !input.displayOnly && grain === p.TRAFFIC_DEFAULT_GRANULARITY,
      );
  if (!input.displayOnly && input.anchor)
    for (const days of p.PERFORMANCE_SNAPSHOT_WINDOW_DAYS)
      for (const grain of p.TRAFFIC_SNAPSHOT_GRANULARITIES)
        add(addDays(input.anchor, -(days - 1)), input.anchor, grain, days, false);
  // Demand always reads the policy window ending at the anchor; the trigger
  // window only decides whether that window's evidence changed.
  const demandEnd = input.anchor ?? input.windowEnd;
  const demandWindow = [
    addDays(demandEnd, -(policy.demand.DEMAND_WINDOW_DAYS - 1)),
    demandEnd,
  ] as const;
  const covered = targets.some(
    (target) =>
      target.start === demandWindow[0] &&
      target.end === demandWindow[1] &&
      target.grain === p.TRAFFIC_DEFAULT_GRANULARITY,
  );
  if (!input.displayOnly && !covered)
    add(...demandWindow, p.TRAFFIC_DEFAULT_GRANULARITY, null, false);
  return { targets, demandWindow };
}

function executor(displayOnly: boolean): Executor {
  return async (task, { db, checkCancelled, maxAttempts }) => {
    const projectId = await taskProject(db, task);
    const partitionScope = { workspaceId: task.workspace_id, projectId };
    const epoch = await partitionEpoch(db, partitionScope);
    const { windowStart, windowEnd } = payloadWindow(task);
    const scope = new WorkspaceScope(task.workspace_id);
    const origin = await scope
      .selectFrom(db, 'site_health_profiles')
      .select('root_url')
      .where('project_id', '=', projectId)
      .executeTakeFirst();
    const anchor = await searchConsoleAnchor(db, task.workspace_id, projectId);
    const existing = displayOnly
      ? await scope
          .selectFrom(db, 'traffic_snapshots')
          .select('granularity')
          .where('project_id', '=', projectId)
          .where('window_start', '=', sql<Date>`${windowStart}::date`)
          .where('window_end', '=', sql<Date>`${windowEnd}::date`)
          .execute()
      : [];
    const allowedHosts = await projectHosts(db, task.workspace_id, projectId);
    const { targets, demandWindow } = planTargets({
      displayOnly,
      windowStart,
      windowEnd,
      anchor,
      existing: existing.map((row) => row.granularity),
      projectOrigin: origin?.root_url,
      allowedHosts,
    });
    if (!isNonEmpty(targets)) return;
    const demand = new DemandRevision(...demandWindow);
    await scan(db, task, targets, demand, checkCancelled);
    const extent = await scope
      .selectFrom(db, 'integration_metric_rows')
      .select([isoDateText(sql`min(date)`).as('start'), isoDateText(sql`max(date)`).as('end')])
      .where('project_id', '=', projectId)
      .where('dataset', 'in', p.TRAFFIC_CONSUMED_DATASETS)
      .executeTakeFirstOrThrow();
    const coverage = {
      earliest_date: extent.start,
      latest_date: extent.end,
      covered_days: extent.start && extent.end ? windowDays(extent.start, extent.end) : 0,
    };
    await checkCancelled('snapshot write');
    await db.transaction().execute(async (trx) => {
      // One writer per project, like the Referrals and Demand refreshes.
      await subjectXactLock(trx, `traffic_snapshot:${projectId}`);
      const verifying: string[] = [];
      const allQuality: Record<string, Awaited<ReturnType<typeof partitionQuality>>> = {};
      const qualityScope = { workspaceId: task.workspace_id, projectId, ...textSpan(targets) };
      // Reads and writes share the snapshot transaction, so they run in order.
      for (const dataset of p.TRAFFIC_PROJECTED_DATASETS)
        allQuality[dataset] = await partitionQuality(trx, qualityScope, dataset); // NOSONAR
      if ((await partitionEpoch(trx, partitionScope)) !== epoch)
        throw new Error('Integration partitions changed during Traffic projection; retry');
      for (const target of targets) {
        const quality: Record<string, Awaited<ReturnType<typeof partitionQuality>>> = {};
        for (const dataset of p.TRAFFIC_PROJECTED_DATASETS) {
          quality[dataset] = allQuality[dataset]!.filter(
            (q) => q.day >= target.start && q.day <= target.end,
          );
          target.builder.partitionQuality(dataset, quality[dataset]!);
        }
        const evidence = { ...coverage, analytics_quality: quality };
        const snapshotId = await persist(trx, task, target, evidence, displayOnly); // NOSONAR
        if (snapshotId && target.verifies) verifying.push(snapshotId);
      }
      await Promise.all(
        verifying.map((snapshotId) =>
          enqueueImplementationVerification(trx, {
            workspaceId: task.workspace_id,
            projectId,
            triggerKind: 'traffic_snapshot',
            triggerId: snapshotId,
            revision: task.id,
            maxAttempts,
          }),
        ),
      );
      if (!displayOnly)
        await enqueueTask(trx, {
          workspaceId: task.workspace_id,
          projectId,
          kind: 'demand_snapshot_refresh',
          payload: {
            window_start: demandWindow[0],
            window_end: demandWindow[1],
            source_revision: demand.revision(),
            manual: false,
          },
          keyParts: [projectId, ...demandWindow, 0, demand.revision()],
          maxAttempts,
        });
    });
  };
}

export const refreshTrafficSnapshot = executor(false);
export const projectPerformanceRange = executor(true);
