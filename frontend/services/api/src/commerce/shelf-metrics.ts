import { randomUUID } from 'node:crypto';
import { sql, type Selectable } from 'kysely';
import type { Database } from '../db/database.ts';
import type { Audits, CommerceRecommendationObservations } from '../generated/db-schema.ts';
import { policy } from '../config.ts';
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
  | 'surface_kind'
>;

const orderedRank = (row: Pick<Observation, 'order_observable' | 'rank'>) =>
  row.order_observable ? row.rank : null;

function outranks(row: Observation, other: Observation) {
  const rank = orderedRank(row),
    otherRank = orderedRank(other);
  if (rank === null) return false;
  if (otherRank === null) return true;
  const card = row.surface_kind === 'shopping_result',
    otherCard = other.surface_kind === 'shopping_result';
  return card === otherCard ? rank < otherRank : card;
}

function holderIdentity(
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

function shelfSlots(observations: Observation[]) {
  const held = new Map<string, Observation>();
  for (const row of observations) {
    const holder = holderIdentity(row);
    if (holder === null) continue;
    const key = JSON.stringify([row.task_id, row.classification, holder]);
    const kept = held.get(key);
    if (!kept || outranks(row, kept)) held.set(key, row);
  }
  return [...held.values()];
}

export function shelfMetrics(taskIds: string[], observations: Observation[]) {
  const recognized = shelfSlots(observations).filter(
    (row) => row.classification !== 'ai_observed_competitor',
  );
  const owned = recognized.filter((row) => row.classification === 'owned');
  const ownedTasks = new Set(owned.map((row) => row.task_id));
  const rankedOwned = owned.filter((row) => orderedRank(row) !== null);
  const ranked = taskIds
    .map((id) =>
      observations
        .filter((row) => row.task_id === id && orderedRank(row) !== null)
        .reduce<Observation | undefined>(
          (first, row) => (!first || outranks(row, first) ? row : first),
          undefined,
        ),
    )
    .filter((row) => row !== undefined);
  return {
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

function latestPasses(
  db: Database,
  audit: Pick<Selectable<Audits>, 'workspace_id' | 'project_id' | 'id'>,
) {
  return db
    .selectFrom('commerce_match_passes as p')
    .leftJoin('commerce_catalog_revisions as r', (join) =>
      join
        .onRef('r.id', '=', 'p.catalog_revision_id')
        .onRef('r.workspace_id', '=', 'p.workspace_id'),
    )
    .distinctOn('p.artifact_id')
    .select('p.id')
    .where('p.workspace_id', '=', audit.workspace_id)
    .where('p.project_id', '=', audit.project_id)
    .where('p.audit_id', '=', audit.id)
    .orderBy('p.artifact_id')
    .orderBy(sql`r.revision_number desc nulls last`)
    .orderBy('p.created_at', 'desc')
    .orderBy('p.id', 'desc');
}

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
  const targets = await db
    .selectFrom('commerce_prompt_targets')
    .select(['target_kind', 'target_id'])
    .distinct()
    .where('workspace_id', '=', audit.workspace_id)
    .where('project_id', '=', audit.project_id)
    .where('id', 'in', ids)
    .execute();
  for (const target of targets) {
    const exists = await db // NOSONAR
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
    const tasks = await db // NOSONAR
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
      .where('s.cohort', 'not in', policy.prompts.branded_cohorts)
      .execute();
    const taskIds = new Set(tasks.map((task) => task.id));
    const observations = await db // NOSONAR
      .selectFrom('commerce_recommendation_observations')
      .selectAll()
      .where('workspace_id', '=', audit.workspace_id)
      .where('project_id', '=', audit.project_id)
      .where('audit_id', '=', audit.id)
      .where('target_kind', '=', target.target_kind)
      .where('target_id', '=', target.target_id)
      .where(
        'pass_id',
        'in',
        latestPasses(db, audit)
          .where('p.parser_version', '=', versions.parser_version!)
          .where('p.matcher_version', '=', versions.matcher_version!),
      )
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    await db // NOSONAR
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
          [...taskIds],
          observations.filter((row) => taskIds.has(row.task_id)),
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
