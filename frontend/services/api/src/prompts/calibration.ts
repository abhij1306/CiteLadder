import { sql } from 'kysely';
import { z } from 'zod';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import { applyQualityPolicy, probability } from './generation-quality.ts';
import { groundedSql } from './observed-queries.ts';

type Row = {
  decision: Record<string, unknown>;
  disposition: string;
  category: string;
  /** The candidate's phrasing was informed by the project's own searches. */
  grounded: boolean;
};
const rate = (numerator: number, denominator: number) =>
  denominator ? numerator / denominator : null;
const tally = (values: string[]) =>
  Object.fromEntries(
    [...Map.groupBy(values, (value) => value)].map(([key, items]) => [key, items.length]),
  );

export function calibrationReport(rows: Row[]) {
  const Q = policy.models.quality;
  const current = rows.filter(
    (row) => row.decision.question_schema_version === Q.question_schema_version,
  );
  const accepted = current.filter((row) => row.disposition === 'accepted'),
    rejected = current.filter((row) => row.disposition === 'rejected');
  const reviewed = [...accepted, ...rejected];
  const thresholds = applyQualityPolicy({}).thresholds;
  const verdict = (row: Row) => applyQualityPolicy(row.decision).verdict;
  const values = (rows: Row[], question: string) =>
    rows.flatMap((row) => probability(record(row.decision.answers)[question]) ?? []);
  return {
    question_schema_version: Q.question_schema_version,
    thresholds,
    other_schema_decisions: rows.length - current.length,
    recorded_policy_versions: tally(current.map((row) => String(row.decision.policy_version))),
    gate_rejected: current.filter((row) => row.disposition === 'gate_rejected').length,
    accepted: accepted.length,
    rejected: rejected.length,
    verdict_by_outcome: tally(reviewed.map((row) => `${verdict(row)}/${row.disposition}`)),
    false_reject_rate: rate(
      accepted.filter((row) => verdict(row) === 'fail').length,
      accepted.length,
    ),
    false_accept_rate: rate(
      rejected.filter((row) => verdict(row) === 'pass').length,
      rejected.length,
    ),
    questions: Object.fromEntries(
      Object.keys(Q.noul_questions).map((question) => {
        const a = values(accepted, question),
          r = values(rejected, question);
        const below = (values: number[], threshold: number) =>
          values.filter((value) => value < threshold).length;
        const failed = below(r, thresholds.fail_below),
          falseFails = below(a, thresholds.fail_below);
        return [
          question,
          {
            answered_accepted: a.length,
            answered_rejected: r.length,
            false_flag_rate: rate(below(a, thresholds.flag_below), a.length),
            false_reject_rate: rate(falseFails, a.length),
            rejected_caught_by_flag: rate(below(r, thresholds.flag_below), r.length),
            rejected_caught_by_fail: rate(failed, r.length),
            fail_precision: rate(failed, failed + falseFails),
          },
        ];
      }),
    ),
    fail_below_sweep: Q.calibration_sweep.map((threshold) => {
      const fails = (row: Row) =>
        Object.keys(Q.noul_questions).some((key) =>
          values([row], key).some((value) => value < threshold),
        );
      return {
        fail_below: threshold,
        false_reject_rate: rate(accepted.filter(fails).length, accepted.length),
        rejected_caught: rate(rejected.filter(fails).length, rejected.length),
      };
    }),
    // Grounded versus ungrounded review outcomes; counts only, never query text.
    by_grounding: Object.fromEntries(
      (['grounded', 'ungrounded'] as const).map((key) => {
        const counts = tally(
          current.filter((row) => row.grounded === (key === 'grounded')).map((r) => r.disposition),
        );
        const accepted = counts.accepted ?? 0,
          rejected = counts.rejected ?? 0;
        return [
          key,
          {
            gate_rejected: counts.gate_rejected ?? 0,
            accepted,
            rejected,
            accept_rate: rate(accepted, accepted + rejected),
          },
        ];
      }),
    ),
    by_category: Object.fromEntries(
      [...Map.groupBy(reviewed, (row) => row.category || '(no category)')].map(
        ([category, members]) => [
          category,
          {
            reviewed: members.length,
            agreement: rate(
              members.filter(
                (row) => (verdict(row) === 'pass') === (row.disposition === 'accepted'),
              ).length,
              members.length,
            ),
          },
        ],
      ),
    ),
  };
}

/** Explicit administrative, read-only operation; never selects prompt text. */
export async function loadCalibration(db: Database, actor: string, since?: Date) {
  const uuid = z.uuid().safeParse(actor);
  const admin = await db
    .selectFrom('users')
    .select('id')
    .where(
      uuid.success ? 'id' : 'email',
      '=',
      uuid.success ? uuid.data : actor.trim().toLowerCase(),
    )
    .where('is_active', '=', true)
    .where('role', '=', 'admin')
    .executeTakeFirst();
  if (!admin) throw new Error('active_admin_required');
  let query = db
    .selectFrom('prompt_candidates as candidate')
    .innerJoin('prompt_generation_runs as run', 'run.id', 'candidate.run_id')
    .leftJoin('brand_profiles as profile', (join) =>
      join
        .onRef('profile.project_id', '=', 'run.project_id')
        .onRef('profile.workspace_id', '=', 'run.workspace_id'),
    )
    .select([
      'candidate.jev_decision',
      'candidate.disposition',
      sql<string>`profile.business_context->>'category'`.as('category'),
      groundedSql(sql.ref('candidate.evidence_refs')).as('grounded'),
    ])
    .where('candidate.jev_decision', 'is not', null)
    .where('candidate.disposition', 'in', ['accepted', ...policy.prompts.candidate.outcomes]);
  if (since) query = query.where('candidate.created_at', '>=', since);
  const rows = await query.execute();
  return calibrationReport(
    rows.map((row) => ({
      decision: record(row.jev_decision),
      disposition: row.disposition,
      category: row.category ?? '',
      grounded: row.grounded,
    })),
  );
}
