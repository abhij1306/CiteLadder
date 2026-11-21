import type { VisibilityTrendEvent } from '@citeladder/contracts/visibility-trends';
import { sql } from 'kysely';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { storedInstant, utcTextOf, wireUtc } from '../db/timestamps.ts';
import type { RunScope, TrendSource } from './runs.ts';
import type { TrendPoint } from './trend-folding.ts';

type Pair = readonly [previous: TrendSource, next: TrendSource];

function modelsOf(source: TrendSource): Map<string, string> {
  const models = new Map<string, string>();
  for (const item of source.modelProvenance) {
    if (source.logicalEngine !== null && item.logical_engine !== source.logicalEngine) continue;
    if (!models.has(item.logical_engine)) models.set(item.logical_engine, item.transport_model);
  }
  return models;
}

function modelChanges([previous, next]: Pair): VisibilityTrendEvent[] {
  const before = modelsOf(previous);
  return [...modelsOf(next)].flatMap(([engine, model]) => {
    const was = before.get(engine);
    return was === undefined || was === model
      ? []
      : [{ kind: 'model_change', logical_engine: engine, from_model: was, to_model: model }];
  });
}

async function panelChanges(
  db: Database,
  scope: RunScope,
  pairs: readonly Pair[],
): Promise<Map<string, VisibilityTrendEvent>> {
  const changed = pairs.filter(([previous, next]) => previous.panelHash !== next.panelHash);
  const events = new Map<string, VisibilityTrendEvent>();
  if (changed.length === 0) return events;
  const snapshots = await db
    .selectFrom('audit_prompt_snapshots')
    .select(['audit_id', 'prompt_id', 'text'])
    .where('workspace_id', '=', scope.workspaceId)
    .where('audit_id', 'in', [...new Set(changed.flat().map((source) => source.auditId))])
    .execute();
  const panels = new Map<string, Set<string>>();
  for (const row of snapshots) {
    const panel = panels.get(row.audit_id) ?? new Set<string>();
    panel.add(row.prompt_id ?? `text:${row.text}`);
    panels.set(row.audit_id, panel);
  }
  const diffs = changed.map(([previous, next]) => {
    const before = panels.get(previous.auditId) ?? new Set<string>();
    const after = panels.get(next.auditId) ?? new Set<string>();
    return {
      auditId: next.auditId,
      added: [...after].filter((key) => !before.has(key)).length,
      dropped: [...before].filter((key) => !after.has(key)),
    };
  });
  const archived = await archivedPrompts(
    db,
    scope,
    diffs.flatMap((diff) => diff.dropped),
  );
  for (const { auditId, added, dropped } of diffs) {
    const archivedCount = dropped.filter((key) => archived.has(key)).length;
    if (added === 0 && dropped.length === 0) continue;
    events.set(auditId, {
      kind: 'prompt_panel',
      added,
      archived: archivedCount,
      removed: dropped.length - archivedCount,
    });
  }
  return events;
}

async function archivedPrompts(
  db: Database,
  scope: RunScope,
  keys: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(keys.filter((key) => !key.startsWith('text:')))];
  if (ids.length === 0) return new Set();
  const rows = await db
    .selectFrom('prompts')
    .select('id')
    .where('workspace_id', '=', scope.workspaceId)
    .where('id', 'in', ids)
    .where('status', '=', 'archived')
    .execute();
  return new Set(rows.map((row) => row.id));
}

async function actionsLive(
  db: Database,
  scope: RunScope,
  sources: readonly TrendSource[],
): Promise<Map<string, VisibilityTrendEvent[]>> {
  const events = new Map<string, VisibilityTrendEvent[]>();
  const [first] = sources;
  const last = sources.at(-1);
  if (first === undefined || last === undefined) return events;
  const rows = await db
    .selectFrom('opportunity_implementation_events as ie')
    .innerJoin('actions', 'actions.id', 'ie.action_id')
    .select([
      'ie.action_id',
      'actions.target_label',
      utcTextOf(sql.ref('ie.declared_implemented_at')).as('implemented_at'),
    ])
    .where('ie.workspace_id', '=', scope.workspaceId)
    .where('ie.project_id', '=', scope.projectId)
    .where('actions.workspace_id', '=', scope.workspaceId)
    .where('actions.project_id', '=', scope.projectId)
    .where('ie.declared_implemented_at', '>', storedInstant(first.completedAt))
    .where('ie.declared_implemented_at', '<=', storedInstant(last.completedAt))
    .orderBy('ie.declared_implemented_at', 'desc')
    .orderBy('ie.id', 'desc')
    .limit(policy.visibility.trend_max_points)
    .execute();
  for (const row of rows.reverse()) {
    const run = sources.find((source) => source.completedAt >= row.implemented_at);
    if (run === undefined) continue;
    const list = events.get(run.auditId) ?? [];
    list.push({
      kind: 'action_live',
      action_id: row.action_id,
      title: row.target_label,
      implemented_at: wireUtc(row.implemented_at),
    });
    events.set(run.auditId, list);
  }
  return events;
}

export async function withTrendEvents(
  db: Database,
  scope: RunScope,
  sources: readonly TrendSource[],
  points: readonly TrendPoint[],
): Promise<TrendPoint[]> {
  const plotted = new Set(points.flatMap((point) => point.source_audit_ids ?? []));
  const kept = sources.filter((source) => plotted.has(source.auditId));
  const pairs = kept.slice(1).map((next, index): Pair => [kept[index]!, next]);
  const wholeSets = kept.filter((source) => source.wholeSet);
  const panelPairs = wholeSets.slice(1).map((next, index): Pair => [wholeSets[index]!, next]);
  const [panels, actions] = await Promise.all([
    panelChanges(db, scope, panelPairs),
    actionsLive(db, scope, kept),
  ]);
  const byRun = new Map<string, VisibilityTrendEvent[]>();
  for (const pair of pairs) {
    const panel = panels.get(pair[1].auditId);
    byRun.set(pair[1].auditId, [...(panel ? [panel] : []), ...modelChanges(pair)]);
  }
  return points.map((point) => ({
    ...point,
    events: (point.source_audit_ids ?? []).flatMap((auditId) => [
      ...(byRun.get(auditId) ?? []),
      ...(actions.get(auditId) ?? []),
    ]),
  }));
}
