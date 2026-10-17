import { randomUUID } from 'node:crypto';
import type { Selectable } from 'kysely';
import type { Database } from '../db/database.ts';
import type { Audits, CommerceRecommendationObservations } from '../generated/db-schema.ts';
import { record } from '../db/json.ts';
import { auditPolicy } from '../audits/config.ts';
import { frozenShelfIds } from './shelf.ts';

type Observation = Pick<
  Selectable<CommerceRecommendationObservations>,
  | 'id'
  | 'task_id'
  | 'classification'
  | 'rank'
  | 'order_observable'
  | 'product_id'
  | 'competitor_candidate_id'
>;

/** A rank only an ordered answer supplies. */
export const orderedRank = (row: Pick<Observation, 'order_observable' | 'rank'>) =>
  row.order_observable ? row.rank : null;

/**
 * The product or competitor an observation recommends, or null when it names
 * neither: unresolved, or any classification the shelf does not recognize.
 */
export function holderIdentity(
  row: Pick<Observation, 'classification' | 'product_id' | 'competitor_candidate_id'>,
): string | null {
  if (row.classification === 'owned') return row.product_id;
  if (
    row.classification === 'approved_competitor' ||
    row.classification === 'ai_observed_competitor'
  )
    return row.competitor_candidate_id;
  return null;
}

/**
 * One slot per product or competitor per execution, at its best rank: an
 * answer that names the same product in three sentences recommends it once.
 */
function shelfSlots(observations: Observation[]) {
  const held = new Map<string, Observation>();
  for (const row of observations) {
    const holder = holderIdentity(row);
    if (holder === null) continue;
    const key = JSON.stringify([row.task_id, row.classification, holder]);
    const kept = held.get(key);
    const rank = orderedRank(row),
      keptRank = kept ? orderedRank(kept) : null;
    if (!kept || (rank !== null && (keptRank === null || rank < keptRank))) held.set(key, row);
  }
  return [...held.values()];
}

export function shelfMetrics(taskIds: string[], observations: Observation[]) {
  const recognized = shelfSlots(observations);
  const owned = recognized.filter((row) => row.classification === 'owned');
  const ownedTasks = new Set(owned.map((row) => row.task_id));
  const rankedOwned = owned.filter((row) => orderedRank(row) !== null);
  // The first-ranked observation of each execution that ranked any.
  const ranked = taskIds
    .map(
      (id) =>
        observations
          .filter((row) => row.task_id === id && row.order_observable && row.rank !== null)
          .sort((a, b) => a.rank! - b.rank!)[0],
    )
    .filter((row) => row !== undefined);
  return {
    // The column is not nullable: with no successful execution the read
    // reports visibility unavailable from `successful_execution_count`.
    product_visibility: taskIds.length
      ? taskIds.filter((id) => ownedTasks.has(id)).length / taskIds.length
      : 0,
    share_of_shelf: recognized.length ? owned.length / recognized.length : null,
    average_shelf_position: rankedOwned.length
      ? rankedOwned.reduce((sum, row) => sum + row.rank!, 0) / rankedOwned.length
      : null,
    first_position_win_rate: ranked.length
      ? ranked.filter((row) => row.rank === 1 && row.classification === 'owned').length /
        ranked.length
      : null,
    successful_execution_count: taskIds.length,
    recognized_slot_count: recognized.length,
    ranked_execution_count: ranked.length,
    source_observation_ids: JSON.stringify(observations.map((row) => row.id)),
  };
}

/** Caller holds the workspace-scoped audit lock. Historical snapshots never read the current catalog. */
export async function finalizeCommerceShelf(db: Database, audit: Selectable<Audits>) {
  if (audit.audit_scope !== 'commerce') return;
  const frozen = record(record(audit.configuration).commerce_measurement),
    ids = frozenShelfIds(frozen);
  if (!ids.length) return;
  const versions = Object.fromEntries(
    Object.entries(auditPolicy.commerce_versions).map(([key, value]) => [
      key,
      typeof frozen[key] === 'string' ? frozen[key] : value,
    ]),
  );
  // Several prompts share one target; each target gets one snapshot.
  const targets = await db
    .selectFrom('commerce_prompt_targets')
    .select(['target_kind', 'target_id'])
    .distinct()
    .where('workspace_id', '=', audit.workspace_id)
    .where('project_id', '=', audit.project_id)
    .where('id', 'in', ids)
    .execute();
  for (const target of targets) {
    const exists = await db
      .selectFrom('commerce_shelf_snapshots')
      .select('id')
      .where('workspace_id', '=', audit.workspace_id)
      .where('project_id', '=', audit.project_id)
      .where('audit_id', '=', audit.id)
      .where('target_kind', '=', target.target_kind)
      .where('target_id', '=', target.target_id)
      .where('formula_version', '=', versions.formula_version!)
      .executeTakeFirst();
    if (exists) continue;
    const tasks = await db
      .selectFrom('audit_tasks as t')
      .innerJoin('audit_prompt_snapshots as s', 's.id', 't.prompt_snapshot_id')
      .innerJoin('commerce_prompt_targets as c', 'c.prompt_id', 's.prompt_id')
      .select('t.id')
      .distinct()
      .where('t.workspace_id', '=', audit.workspace_id)
      .where('t.audit_id', '=', audit.id)
      .where('t.status', '=', 'succeeded')
      .where('s.audit_id', '=', audit.id)
      .where('c.workspace_id', '=', audit.workspace_id)
      .where('c.project_id', '=', audit.project_id)
      .where('c.id', 'in', ids)
      .where('c.target_kind', '=', target.target_kind)
      .where('c.target_id', '=', target.target_id)
      .execute();
    const observations = await db
      .selectFrom('commerce_recommendation_observations')
      .selectAll()
      .where('workspace_id', '=', audit.workspace_id)
      .where('project_id', '=', audit.project_id)
      .where('audit_id', '=', audit.id)
      .where('target_kind', '=', target.target_kind)
      .where('target_id', '=', target.target_id)
      .where('parser_version', '=', versions.parser_version!)
      .where('matcher_version', '=', versions.matcher_version!)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    await db
      .insertInto('commerce_shelf_snapshots')
      .values({
        id: randomUUID(),
        workspace_id: audit.workspace_id,
        project_id: audit.project_id,
        audit_id: audit.id,
        target_kind: target.target_kind,
        target_id: target.target_id,
        formula_version: versions.formula_version!,
        ...shelfMetrics(
          tasks.map((task) => task.id),
          observations,
        ),
        context_snapshot: JSON.stringify({
          target: { kind: target.target_kind, id: target.target_id },
          parser_version: versions.parser_version,
          matcher_version: versions.matcher_version,
        }),
        created_at: new Date(),
      })
      .execute();
  }
}
