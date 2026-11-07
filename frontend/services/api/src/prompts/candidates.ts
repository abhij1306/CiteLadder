/**
 * Generated-prompt candidates: the review list and accept/reject.
 *
 * Generation stages candidates (and purges expired ones) under the
 * project and prompt-set locks; review takes the same locks in the same
 * order, then the candidate rows (`FOR UPDATE`), then the account capacity
 * lock when it accepts. Only an accept creates a Prompt, carrying the run's
 * provenance as `generation_evidence`. A rejected candidate with a quality
 * judgment becomes a text-free outcome record for judge calibration; any
 * other rejected or redundant candidate is deleted.
 */
import { promptCohortSchema } from '@citeladder/contracts/project';
import { promptCandidateReviewRequestSchema } from '@citeladder/contracts/prompt-requests';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';

import { policy, resolveSettingSpec } from '../config.ts';
import type { Database } from '../db/database.ts';
import type { RecordScope } from '../db/workspace-scope.ts';
import { jsonObject, record } from '../db/json.ts';
import { ApiError } from '../errors.ts';
import type { DB } from '../generated/db-schema.ts';
import { compareText } from '../text-order.ts';
import { insertPrompts, type PromptDraft } from './insert.ts';
import { acquireProjectLock, acquirePromptSetLock } from './locks.ts';
import { scopedPromptSet } from './prompt-sets.ts';
import {
  candidateView,
  promptView,
  type CandidateRow,
  type CandidateView,
  type PromptView,
} from './views.ts';

const P = policy.prompts;
const C = P.candidate;
const HOUR_MS = 3_600_000;

/** The audience the generation plan wrote the prompt for, from its planned cell. */
function plannedPersona(refs: unknown[]): string {
  const cell = refs.map(record).find((ref) => ref.kind === 'business_map_cell');
  const audience = cell?.audience;
  return typeof audience === 'string' ? audience.trim().slice(0, P.persona_max_chars) : '';
}
const setting = (name: keyof typeof P.generation_settings) =>
  resolveSettingSpec(P.generation_settings[name]) as number;

export const candidateReview = promptCandidateReviewRequestSchema;

export type CandidateReview = {
  accepted: PromptView[];
  rejected_count: number;
  dropped_duplicates: number;
  unavailable_count: number;
};

/** Newest first; within one instant, judge-flagged rows last, then by rank score. */
function reviewOrder(left: CandidateRow, right: CandidateRow): number {
  const byTime = right.created_at.getTime() - left.created_at.getTime();
  if (byTime !== 0) return byTime;
  const [leftDecision, rightDecision] = [record(left.jev_decision), record(right.jev_decision)];
  const flagged = (decision: Record<string, unknown>) =>
    Array.isArray(decision.flags) && decision.flags.length > 0 ? 1 : 0;
  const byFlag = flagged(leftDecision) - flagged(rightDecision);
  if (byFlag !== 0) return byFlag;
  const score = (decision: Record<string, unknown>) =>
    typeof decision.rank_score === 'number' ? decision.rank_score : 0;
  const byScore = score(rightDecision) - score(leftDecision);
  return byScore === 0 ? compareText(left.text, right.text) : byScore;
}

/** Each run's recorded quality gate (null for runs from before the judge). */
async function runGates(
  db: Kysely<DB>,
  workspaceId: string,
  runIds: readonly string[],
): Promise<Map<string, string | null>> {
  if (runIds.length === 0) return new Map();
  const runs = await db
    .selectFrom('prompt_generation_runs')
    .select(['id', 'provenance'])
    .where('workspace_id', '=', workspaceId)
    .where('id', 'in', runIds)
    .execute();
  return new Map(
    runs.map((run) => {
      const gate = record(run.provenance).quality_gate;
      return [run.id, typeof gate === 'string' ? gate : null];
    }),
  );
}

export async function listCandidates(
  db: Database,
  workspaceId: string,
  promptSetId: string,
): Promise<CandidateView[]> {
  const set = await scopedPromptSet(db, workspaceId, promptSetId);
  const rows = await db
    .selectFrom('prompt_candidates')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('prompt_set_id', '=', set.id)
    .where('disposition', '=', C.pending)
    .where('expires_at', '>', new Date())
    .execute();
  rows.sort(reviewOrder);
  const gates = await runGates(db, workspaceId, [...new Set(rows.map((row) => row.run_id))]);
  return rows.map((row) => candidateView(row, gates.get(row.run_id) ?? null));
}

function validateIds(acceptIds: readonly string[], rejectIds: readonly string[]): void {
  if (acceptIds.length === 0 && rejectIds.length === 0) {
    throw new ApiError(422, 'Select at least one candidate to review');
  }
  const accepted = new Set(acceptIds);
  if (rejectIds.some((id) => accepted.has(id))) {
    throw new ApiError(422, 'A candidate cannot be accepted and rejected');
  }
  const limit = setting('review_max_ids');
  if (new Set([...acceptIds, ...rejectIds]).size > limit) {
    throw new ApiError(422, `Review at most ${limit} candidates at a time`);
  }
}

/** The prompts an accept inserts; the candidate's run provenance comes along. */
async function acceptedDrafts(
  db: Kysely<DB>,
  set: { id: string; project_id: string; workspaceId: string },
  candidates: readonly CandidateRow[],
) {
  const runIds = [...new Set(candidates.map((row) => row.run_id))];
  const topicIds = [...new Set(candidates.flatMap((row) => (row.topic_id ? [row.topic_id] : [])))];
  const [runs, topics] = await Promise.all([
    db
      .selectFrom('prompt_generation_runs')
      .select(['id', 'provenance'])
      .where('workspace_id', '=', set.workspaceId)
      .where('id', 'in', runIds)
      .execute(),
    topicIds.length === 0
      ? Promise.resolve([])
      : db
          .selectFrom('topics')
          .select(['id', 'name'])
          .where('project_id', '=', set.project_id)
          .where('id', 'in', topicIds)
          .execute(),
  ]);
  const provenance = new Map(
    runs.map((run) => [run.id, jsonObject(run.provenance, 'prompt_generation_runs.provenance')]),
  );
  const topicNames = new Map(topics.map((topic) => [topic.id, topic.name]));
  return candidates.map((candidate): PromptDraft => {
    const evidence: Record<string, unknown> = {
      ...provenance.get(candidate.run_id),
      generation_run_id: candidate.run_id,
      buyer_query_slot_id: candidate.slot_id,
      candidate_id: candidate.id,
      candidate_validation: record(candidate.validation),
      evidence_refs: Array.isArray(candidate.evidence_refs) ? candidate.evidence_refs : [],
    };
    if (candidate.jev_decision !== null) evidence.jev_decision = candidate.jev_decision;
    return {
      topic_id: candidate.topic_id,
      text: candidate.text,
      theme: candidate.topic_id === null ? '' : (topicNames.get(candidate.topic_id) ?? ''),
      intent: candidate.intent,
      buyer_stage: candidate.buyer_stage,
      prompt_intent: candidate.prompt_intent,
      persona: plannedPersona(
        Array.isArray(candidate.evidence_refs) ? candidate.evidence_refs : [],
      ),
      cohort: promptCohortSchema.parse(candidate.cohort),
      enabled: true,
      generation_evidence: evidence,
    };
  });
}

export function reviewCandidates(
  db: Database,
  scope: RecordScope,
  promptSetId: string,
  input: z.infer<typeof candidateReview>,
): Promise<CandidateReview> {
  validateIds(input.accept_ids, input.reject_ids);
  const { workspaceId } = scope;
  return db.transaction().execute(async (trx) => {
    const set = await scopedPromptSet(trx, workspaceId, promptSetId, scope.projectId);
    await acquireProjectLock(trx, set.project_id);
    await acquirePromptSetLock(trx, set.id);
    const now = new Date();
    await trx
      .deleteFrom('prompt_candidates')
      .where('workspace_id', '=', workspaceId)
      .where('prompt_set_id', '=', set.id)
      .where('disposition', 'in', [C.pending, ...C.outcomes])
      .where('expires_at', '<=', now)
      .execute();
    const requested = [...new Set([...input.accept_ids, ...input.reject_ids])];
    const found = await trx
      .selectFrom('prompt_candidates')
      .selectAll()
      .where('id', 'in', requested)
      .where('workspace_id', '=', workspaceId)
      .where('prompt_set_id', '=', set.id)
      .where('disposition', '=', C.pending)
      .where('expires_at', '>', now)
      .orderBy('created_at')
      .orderBy('id')
      .forUpdate()
      .execute();
    const acceptSet = new Set(input.accept_ids);
    const toAccept = found.filter((row) => acceptSet.has(row.id));
    const toReject = found.filter((row) => !acceptSet.has(row.id));

    // The first candidate per text hash that is not already a prompt inserts.
    const insertable = toAccept.filter((candidate) => candidate.normalized_text_hash !== '');
    const redundant = toAccept
      .filter((candidate) => candidate.normalized_text_hash === '')
      .map((candidate) => candidate.id);
    let accepted: PromptView[] = [];
    if (insertable.length > 0) {
      const inserted = await insertPrompts(
        trx,
        { ...set, workspace_id: workspaceId },
        await acceptedDrafts(trx, { ...set, workspaceId }, insertable),
        { origin: 'generated', onDuplicate: 'skip' },
      );
      accepted = inserted.flatMap((prompt, index) => {
        if (prompt !== null) return [promptView(prompt)];
        redundant.push(insertable[index]!.id);
        return [];
      });
      if (accepted.length > 0) {
        await trx
          .updateTable('prompt_candidates')
          .from('prompts')
          .set({
            disposition: C.accepted,
            prompt_id: sql.ref('prompts.id'),
            reviewed_at: now,
          })
          .where(
            'prompts.id',
            'in',
            accepted.map((prompt) => prompt.id),
          )
          .whereRef(
            sql`prompts.generation_evidence->>'candidate_id'`,
            '=',
            sql`prompt_candidates.id::text`,
          )
          .execute();
      }
    }
    const judged = toReject.filter((row) => Object.keys(record(row.jev_decision)).length > 0);
    const judgedIds = new Set(judged.map((row) => row.id));
    const retentionMs = setting('rejected_outcome_retention_days') * 24 * HOUR_MS;
    if (judged.length > 0) {
      await trx
        .updateTable('prompt_candidates')
        .set({
          disposition: C.rejected,
          text: '',
          normalized_text_hash: '',
          jev_decision: sql`case when jsonb_typeof(jev_decision->'duplicate_of') = 'object'
            then jsonb_set(jev_decision, '{duplicate_of,text}', 'null'::jsonb)
            else jev_decision end`,
          reviewed_at: now,
          expires_at: new Date(now.getTime() + retentionMs),
        })
        .where('id', 'in', [...judgedIds])
        .execute();
    }
    const unjudged = toReject.filter((row) => !judgedIds.has(row.id));
    const deleted = [...redundant, ...unjudged.map((row) => row.id)];
    if (deleted.length > 0) {
      await trx.deleteFrom('prompt_candidates').where('id', 'in', deleted).execute();
    }
    return {
      accepted,
      rejected_count: toReject.length,
      dropped_duplicates: redundant.length,
      unavailable_count: requested.length - found.length,
    };
  });
}
