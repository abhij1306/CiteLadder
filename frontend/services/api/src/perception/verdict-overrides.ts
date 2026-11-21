import { randomUUID } from 'node:crypto';

import {
  claimVerdictSchema,
  overrideVerdictSchema,
  type ClaimVerdict,
  type OverrideVerdict,
  type VerdictOverride,
} from '@citeladder/contracts/fact-checking';
import { verdictOverrideRequestSchema } from '@citeladder/contracts/project-requests';
import { z } from 'zod';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { chunked } from '../lists.ts';
import { requireFlag } from '../entitlements/access.ts';
import { ApiError, notFound } from '../errors.ts';
import type { ProjectScope } from '../projects/brand-profile.ts';

export const verdictOverrideRequest = verdictOverrideRequestSchema.extend({
  note: z
    .string()
    .trim()
    .max(policy.perception.fact_check.override_note_max_chars)
    .nullish()
    .transform((note) => note || null),
});

export type NewestOverride = { verdict: OverrideVerdict; note: string | null; at: Date };

export async function newestOverrides(
  db: Database,
  workspaceId: string,
  verdictIds: readonly string[],
): Promise<Map<string, NewestOverride>> {
  const rows = await chunked([...new Set(verdictIds)], (ids) =>
    db
      .selectFrom('claim_verdict_overrides')
      .distinctOn('claim_verdict_id')
      .select(['claim_verdict_id', 'to_verdict', 'note', 'created_at'])
      .where('workspace_id', '=', workspaceId)
      .where('claim_verdict_id', 'in', ids)
      .orderBy('claim_verdict_id')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .execute(),
  );
  return new Map(
    rows.map((row) => [
      row.claim_verdict_id,
      { verdict: overrideVerdictSchema.parse(row.to_verdict), note: row.note, at: row.created_at },
    ]),
  );
}

export function editedMark(
  model: { verdict: ClaimVerdict; low_confidence: boolean },
  override: NewestOverride | undefined,
) {
  if (!override || (override.verdict === model.verdict && !model.low_confidence)) return null;
  return { model_verdict: model.verdict, note: override.note, at: override.at.toISOString() };
}

/**
 * Append a person's verdict for one claim verdict of the project. The verdict
 * row is locked so concurrent changes append in order; a claim the checker
 * left out has no model verdict to change.
 */
export function overrideVerdict(
  db: Database,
  input: {
    scope: ProjectScope;
    userId: string;
    verdictId: string;
    change: z.output<typeof verdictOverrideRequest>;
  },
): Promise<VerdictOverride> {
  const { scope } = input;
  return db.transaction().execute(async (trx) => {
    await requireFlag(trx, scope.workspaceId, 'fact_checking');
    const row = await trx
      .selectFrom('claim_verdicts as cv')
      .innerJoin('fact_verifications as fv', (join) =>
        join
          .onRef('fv.id', '=', 'cv.verification_id')
          .onRef('fv.workspace_id', '=', 'cv.workspace_id'),
      )
      .innerJoin('audits', (join) =>
        join
          .onRef('audits.id', '=', 'fv.audit_id')
          .onRef('audits.workspace_id', '=', 'fv.workspace_id'),
      )
      .select(['cv.id', 'cv.verdict', 'cv.low_confidence', 'cv.model_omitted'])
      .where('cv.workspace_id', '=', scope.workspaceId)
      .where('audits.project_id', '=', scope.projectId)
      .where('cv.id', '=', input.verdictId)
      .forUpdate('cv')
      .executeTakeFirst();
    if (!row) throw notFound('Claim verdict');
    if (row.model_omitted)
      throw new ApiError(409, 'The checker left this claim out, so it has no verdict to change');
    const model = claimVerdictSchema.parse(row.verdict);
    const current = (await newestOverrides(trx, scope.workspaceId, [row.id])).get(row.id);
    const shown = current?.verdict ?? (row.low_confidence ? null : model);
    if (shown === input.change.verdict)
      throw new ApiError(409, 'The claim already has this verdict');
    const created = await trx
      .insertInto('claim_verdict_overrides')
      .values({
        id: randomUUID(),
        workspace_id: scope.workspaceId,
        claim_verdict_id: row.id,
        from_verdict: model,
        to_verdict: input.change.verdict,
        note: input.change.note,
        created_by_user_id: input.userId,
        // Strictly after the override it supersedes, even within one clock tick.
        created_at: new Date(Math.max(Date.now(), (current?.at.getTime() ?? 0) + 1)),
      })
      .returning(['to_verdict', 'note', 'created_at'])
      .executeTakeFirstOrThrow();
    return {
      verdict_id: row.id,
      model_verdict: model,
      verdict: overrideVerdictSchema.parse(created.to_verdict),
      note: created.note,
      at: created.created_at.toISOString(),
    };
  });
}
