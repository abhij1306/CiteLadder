/**
 * The `fact_verification` analytics executor: one bounded
 * model call that checks an answer's brand claims against the confirmed fact
 * revisions its audit froze. Queued by the perception executor only when a
 * confident claim has a frozen fact on its topic.
 *
 * Mirrors perception: reads commit before the call and no transaction spans
 * it; caps, a missing gateway, an unusable output and a provider failure each
 * end as a persisted outcome, idempotent on
 * `(perception_id, verify_template_version)`.
 */
import { randomUUID } from 'node:crypto';

import { factTopicSchema } from '@citeladder/contracts/fact-checking';

import { policy } from '../config.ts';
import { meterFor } from '../models/metering.ts';
import type { FactCheckPolicy } from '../config/perception.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import { parseUuid } from '../http/uuid.ts';
import type { ModelGateway } from '../models/gateway.ts';
import type { QueueTask } from '../queue/task-queue.ts';
import { scalarText } from '../text-order.ts';
import { payloadString, taskProject, type Executor } from '../workers/executor.ts';
import { checkedTopics, factScope, frozenFactCheck, type FrozenFactCheck } from './admission.ts';
import {
  callStructured,
  configuredGateway,
  outcomeColumns,
  overCap,
  type ModelCall,
} from './model-call.ts';
import {
  validateVerdicts,
  verifyHash,
  verifyOutputSchema,
  verifyPackage,
  verifyPrompt,
  type VerifiedVerdict,
  type VerifyClaim,
} from './verify.ts';

/** Outcomes that spent a model call; caps count only these. */
const CALLED = ['verified', 'invalid_output', 'model_error'];

type Outcome =
  | { outcome: 'verified'; verdicts: VerifiedVerdict[]; drops: Record<string, number> }
  | { outcome: 'unavailable'; reason: 'platform_cap' | 'model_not_configured' | 'task_failed' }
  | { outcome: 'invalid_output' }
  | { outcome: 'model_error'; reason: string };

type Subject = Awaited<ReturnType<typeof loadSubject>>;

function loadSubject(db: Database, task: QueueTask, projectId: string) {
  const perceptionId = parseUuid(payloadString(task, 'perception_id'));
  if (perceptionId === null) throw new Error('fact_verification payload missing perception_id');
  return db
    .selectFrom('answer_perceptions as perception')
    .innerJoin('audits as audit', 'audit.id', 'perception.audit_id')
    .select([
      'perception.id as perception_id',
      'perception.task_id',
      'audit.id as audit_id',
      'audit.configuration',
    ])
    .where('perception.id', '=', perceptionId)
    .where('perception.workspace_id', '=', task.workspace_id)
    .where('audit.workspace_id', '=', task.workspace_id)
    .where('audit.project_id', '=', projectId)
    .executeTakeFirstOrThrow();
}

/** The confident claims with a frozen fact on their topic: the ones a model call checks. */
async function eligibleClaims(
  db: Database,
  workspaceId: string,
  subject: Subject,
  factCheck: FrozenFactCheck,
): Promise<VerifyClaim[]> {
  const topics = checkedTopics(factCheck);
  const rows = await db
    .selectFrom('answer_claims')
    .select(['id', 'topic', 'claim', 'quote', 'low_confidence'])
    .where('workspace_id', '=', workspaceId)
    .where('perception_id', '=', subject.perception_id)
    .orderBy('ordinal')
    .execute();
  return rows.flatMap((row) => {
    const topic = factTopicSchema.safeParse(row.topic);
    if (row.low_confidence || !topic.success || !topics.has(topic.data)) return [];
    return [{ claimId: row.id, topic: topic.data, claim: row.claim, quote: row.quote }];
  });
}

async function frozenFacts(db: Database, workspaceId: string, factCheck: FrozenFactCheck) {
  const ids = factCheck.facts.map((fact) => fact.revision_id);
  const rows = await db
    .selectFrom('brand_fact_revisions')
    .select(['id', 'statement'])
    .where('workspace_id', '=', workspaceId)
    .where('id', 'in', ids)
    .execute();
  const statements = new Map(rows.map((row) => [row.id, row.statement]));
  // A frozen revision is append-only; one that is gone (project deleted) is skipped.
  return factCheck.facts.flatMap((fact) => {
    const statement = statements.get(fact.revision_id);
    return statement === undefined
      ? []
      : [{ revisionId: fact.revision_id, topic: fact.topic, statement }];
  });
}

async function alreadyVerified(db: Database, subject: Subject, version: string) {
  const row = await db
    .selectFrom('fact_verifications')
    .select('id')
    .where('perception_id', '=', subject.perception_id)
    .where('verify_template_version', '=', version)
    .executeTakeFirst();
  return row !== undefined;
}

function persist(
  task: QueueTask,
  projectId: string,
  subject: Subject,
  version: string,
  outcome: Outcome,
  call: ModelCall | null,
) {
  return async (db: Database) => {
    const id = randomUUID();
    const inserted = await db
      .insertInto('fact_verifications')
      .values({
        id,
        workspace_id: task.workspace_id,
        project_id: projectId,
        audit_id: subject.audit_id,
        task_id: subject.task_id,
        perception_id: subject.perception_id,
        verify_template_version: version,
        ...outcomeColumns(outcome, outcome.outcome === 'verified' ? outcome.drops : {}, call),
      })
      .onConflict((conflict) =>
        conflict.columns(['perception_id', 'verify_template_version']).doNothing(),
      )
      .returning('id')
      .executeTakeFirst();
    if (!inserted || outcome.outcome !== 'verified' || !outcome.verdicts.length) return;
    await db
      .insertInto('claim_verdicts')
      .values(
        outcome.verdicts.map((verdict) => ({
          id: randomUUID(),
          workspace_id: task.workspace_id,
          verification_id: id,
          claim_id: verdict.claimId,
          verdict: verdict.verdict,
          model_verdict: verdict.modelVerdict,
          fact_revision_ids: JSON.stringify(verdict.factRevisionIds),
          confidence: verdict.confidence,
          low_confidence: verdict.lowConfidence,
        })),
      )
      .execute();
  };
}

/** One verification call over the package; code decides which verdicts stand. */
function verify(
  gateway: ModelGateway,
  built: ReturnType<typeof verifyPackage>,
  settings: FactCheckPolicy,
) {
  const { system, user } = verifyPrompt(built.pkg, settings);
  return callStructured(
    gateway,
    {
      system,
      user,
      schema: verifyOutputSchema,
      inputHash: verifyHash(built.pkg),
      maxAttempts: settings.max_attempts,
    },
    (value): Outcome => ({ outcome: 'verified', ...validateVerdicts(value, built, settings) }),
  );
}

export function factVerification(
  gatewayFactory: () => ModelGateway | null = configuredGateway,
  settings: FactCheckPolicy = policy.perception.fact_check,
): Executor {
  return async (task, { db, checkCancelled }) => {
    const projectId = await taskProject(db, task);
    const subject = await loadSubject(db, task, projectId);
    const factCheck = frozenFactCheck(subject.configuration);
    // An audit admitted outside the pilot is never verified.
    if (!factCheck) return;
    const version = factCheck.verify_template_version;
    const [verified, claims] = await Promise.all([
      alreadyVerified(db, subject, version),
      eligibleClaims(db, task.workspace_id, subject, factCheck),
    ]);
    if (verified || !claims.length) return;
    const settle = (outcome: Outcome, call: ModelCall | null = null) => ({
      error: null,
      persist: persist(task, projectId, subject, version, outcome, call),
    });
    const [capped, facts] = await Promise.all([
      overCap(db, 'fact_verifications', {
        workspaceId: task.workspace_id,
        auditId: subject.audit_id,
        called: CALLED,
        perAudit: settings.max_verifications_per_audit,
        perDay: settings.max_verifications_per_workspace_per_day,
      }),
      frozenFacts(db, task.workspace_id, factCheck),
    ]);
    if (capped) return settle({ outcome: 'unavailable', reason: 'platform_cap' });
    const raw = gatewayFactory();
    if (!raw) return settle({ outcome: 'unavailable', reason: 'model_not_configured' });
    // Included in the prompt run: recorded with its tokens, not charged.
    const gateway = meterFor(db, task.workspace_id).gateway(raw, 'fact_verification');
    const configuration = record(subject.configuration);
    const built = verifyPackage({
      version,
      brand: scalarText(configuration.brand_name),
      language: scalarText(configuration.language_code),
      facts,
      claims,
      scope: (topic) => factScope(factCheck, topic),
      maxFacts: settings.max_facts_per_verification,
    });
    await checkCancelled('fact_verification_model_call');
    const { call, outcome } = await verify(gateway, built, settings);
    return settle(outcome, call);
  };
}

/** A task that exhausted its attempts still leaves a persisted, explained outcome. */
export async function compensateFactVerification(db: Database, task: QueueTask) {
  const projectId = await taskProject(db, task);
  const subject = await loadSubject(db, task, projectId);
  const factCheck = frozenFactCheck(subject.configuration);
  if (!factCheck) return;
  await persist(
    task,
    projectId,
    subject,
    factCheck.verify_template_version,
    { outcome: 'unavailable', reason: 'task_failed' },
    null,
  )(db);
}
