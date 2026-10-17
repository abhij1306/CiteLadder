/**
 * Top movers: the sources whose citation share changed most against the
 * previous comparable period, split into risers and fallers.
 *
 * Citation share is a source's citations over every citation in its period,
 * so the two periods are compared as shares, never as raw counts. A source
 * cited in only one period has share 0 in the other. Movement is reported
 * only when the two run sets are comparable.
 */
import type { visibilitySourceMoversSchema } from '@citeladder/contracts/visibility-evidence';
import { sql } from 'kysely';
import type { z } from 'zod';

import type { Database } from '../db/database.ts';
import { compareText } from '../text-order.ts';
import { runSetComparisonStatus } from './run-sets.ts';
import {
  authorizedSelection,
  authorizeRunSet,
  evidenceScope,
  type RunSelection,
} from './selection.ts';

type Movers = z.input<typeof visibilitySourceMoversSchema>;
type Mover = Movers['risers'][number];

export type MoverQuery = {
  dimension: 'domain' | 'url';
  baselineAuditIds: string[];
  limit: number;
};

/** Citations per source key over a scope of answers, and their total. */
async function shares(
  db: Database,
  selection: RunSelection,
  scope: ReturnType<typeof evidenceScope>,
  dimension: MoverQuery['dimension'],
): Promise<{ answers: number; byKey: Map<string, number> }> {
  const column = dimension === 'url' ? 'citation.url' : 'citation.domain';
  const answers = scope.select('ra.id as analysis_id').as('answers');
  const [counted, total] = await Promise.all([
    db
      .selectFrom('citations as citation')
      .innerJoin(answers, 'answers.analysis_id', 'citation.analysis_id')
      .where('citation.workspace_id', '=', selection.workspaceId)
      .select([
        sql<string>`${sql.ref(column)}`.as('key'),
        sql<number>`count(citation.id)::int`.as('citations'),
      ])
      .groupBy(column)
      .execute(),
    db
      .selectFrom(answers)
      .select(sql<number>`count(*)::int`.as('answers'))
      .executeTakeFirstOrThrow(),
  ]);
  const citations = counted.reduce((sum, row) => sum + row.citations, 0);
  return {
    answers: total.answers,
    byKey: new Map(counted.map((row) => [row.key, citations ? row.citations / citations : 0])),
  };
}

export async function getSourceMovers(
  db: Database,
  requested: RunSelection,
  query: MoverQuery,
): Promise<Movers> {
  const selection = await authorizedSelection(db, requested);
  await authorizeRunSet(db, selection, query.baselineAuditIds);
  const empty = (status: string): Movers => ({
    dimension: query.dimension,
    comparison_status: status,
    risers: [],
    fallers: [],
  });
  if (!query.baselineAuditIds.length) return empty('no_baseline');
  const current = await shares(db, selection, evidenceScope(db, selection), query.dimension);
  let currentIds: string[] = selection.auditId ? [selection.auditId] : [];
  if (selection.auditIds?.length) currentIds = selection.auditIds;
  const status = await runSetComparisonStatus(db, selection, {
    currentIds,
    baselineIds: query.baselineAuditIds,
    responses: current.answers,
    engine: selection.logicalEngine,
    cohort: selection.cohort,
  });
  if (status !== 'comparable') return empty(status);
  const baselineScope = evidenceScope(db, {
    ...selection,
    auditId: null,
    auditIds: null,
    fromAt: null,
    toAt: null,
  }).where('ra.audit_id', 'in', query.baselineAuditIds);
  const previous = await shares(db, selection, baselineScope, query.dimension);
  if (!previous.answers) return empty('no_observations');
  const movers: Mover[] = [...new Set([...current.byKey.keys(), ...previous.byKey.keys()])].map(
    (key) => {
      const now = current.byKey.get(key) ?? 0;
      const before = previous.byKey.get(key) ?? 0;
      return { key, current_share: now, previous_share: before, delta: (now - before) * 100 };
    },
  );
  const ranked = (sign: 1 | -1) =>
    movers
      .filter((mover) => mover.delta * sign > 0)
      .sort((left, right) => (right.delta - left.delta) * sign || compareText(left.key, right.key))
      .slice(0, query.limit);
  return { ...empty('comparable'), risers: ranked(1), fallers: ranked(-1) };
}
