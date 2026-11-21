/**
 * The `answer_perception` analytics executor: one bounded
 * model call per answer that names the brand or a competitor.
 *
 * Reads are committed before the call and no transaction spans it; the
 * analytics claim already committed the attempt. The outcome is written in
 * the worker's lease-fenced terminal transaction and is idempotent on
 * `(analysis_id, extractor_version)`. Caps, a missing gateway, an unusable
 * output and a provider failure all end as a persisted outcome, so the audit
 * never fails because perception could not run.
 */
import { randomUUID } from 'node:crypto';

import { cohortNamesBrand, scoringConfig } from '../analysis/scoring.ts';
import { policy } from '../config.ts';
import { meterFor } from '../models/metering.ts';
import type { FactCheckPolicy, PerceptionPolicy } from '../config/perception.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import type { ModelGateway } from '../models/gateway.ts';
import { parseUuid } from '../http/uuid.ts';
import type { QueueTask } from '../queue/task-queue.ts';
import { scalarText } from '../text-order.ts';
import { payloadString, taskProject, type Executor } from '../queue/executor.ts';
import { enqueueTask } from '../queue/enqueue.ts';
import {
  checkedTopics,
  frozenFactCheck,
  frozenPerceptionVersions,
  type FrozenFactCheck,
} from './admission.ts';
import { claimsOutputSchema, perceptionOutputSchema, perceptionPrompt } from './model.ts';
import {
  callStructured,
  configuredGateway,
  outcomeColumns,
  overCap,
  type ModelCall,
} from './model-call.ts';
import { entityPassages, packageHash, type PerceptionPackage } from './passages.ts';
import { untrackedNames, type UntrackedName } from './untracked-names.ts';
import { listThemes } from '../projects/themes.ts';
import { trackedEntities } from '../analysis/entity-assessment.ts';
import { refreshNamedCandidates } from '../analysis/observed-names.ts';
import {
  validateClaims,
  validateOutput,
  type EntitySentiment,
  type VerifiedClaim,
} from './validate.ts';

const CALLED = ['classified', 'invalid_output', 'model_error'];

type Outcome =
  | {
      outcome: 'classified';
      entities: EntitySentiment[];
      claims: VerifiedClaim[];
      names: UntrackedName[];
      drops: Record<string, number>;
    }
  | { outcome: 'no_mentions' }
  | {
      outcome: 'unavailable';
      reason: 'platform_cap' | 'model_not_configured' | 'task_failed' | 'model_changed';
    }
  | { outcome: 'invalid_output' }
  | { outcome: 'model_error'; reason: string };

type Subject = Awaited<ReturnType<typeof loadSubject>>;

function loadSubject(db: Database, task: QueueTask, projectId: string) {
  const analysisId = parseUuid(payloadString(task, 'analysis_id'));
  if (analysisId === null) throw new Error('answer_perception payload missing analysis_id');
  return db
    .selectFrom('response_analyses as ra')
    .innerJoin('audits as audit', 'audit.id', 'ra.audit_id')
    .innerJoin('raw_response_artifacts as artifact', 'artifact.id', 'ra.artifact_id')
    .innerJoin('audit_tasks as execution', 'execution.id', 'ra.task_id')
    .innerJoin('audit_prompt_snapshots as snapshot', 'snapshot.id', 'execution.prompt_snapshot_id')
    .select([
      'ra.id as analysis_id',
      'ra.task_id',
      'ra.artifact_id',
      'audit.id as audit_id',
      'audit.configuration',
      'artifact.answer_text',
      'snapshot.text as prompt',
      'snapshot.cohort',
    ])
    .where('ra.id', '=', analysisId)
    .where('ra.workspace_id', '=', task.workspace_id)
    .where('audit.workspace_id', '=', task.workspace_id)
    .where('audit.project_id', '=', projectId)
    .executeTakeFirstOrThrow();
}

async function alreadyPerceived(db: Database, subject: Subject, extractorVersion: string) {
  const row = await db
    .selectFrom('answer_perceptions')
    .select('id')
    .where('analysis_id', '=', subject.analysis_id)
    .where('extractor_version', '=', extractorVersion)
    .executeTakeFirst();
  return row !== undefined;
}

function needsVerification(claims: readonly VerifiedClaim[], factCheck: FrozenFactCheck) {
  const topics = checkedTopics(factCheck);
  return claims.some((claim) => !claim.low_confidence && topics.has(claim.topic));
}

function persist(
  task: QueueTask,
  projectId: string,
  subject: Subject,
  versions: { extractor_version: string; template_version: string },
  outcome: Outcome,
  call: ModelCall | null,
  factCheck: FrozenFactCheck | null,
) {
  return async (db: Database) => {
    const id = randomUUID();
    const inserted = await db
      .insertInto('answer_perceptions')
      .values({
        id,
        workspace_id: task.workspace_id,
        project_id: projectId,
        audit_id: subject.audit_id,
        task_id: subject.task_id,
        analysis_id: subject.analysis_id,
        artifact_id: subject.artifact_id,
        extractor_version: versions.extractor_version,
        template_version: versions.template_version,
        ...outcomeColumns(outcome, outcome.outcome === 'classified' ? outcome.drops : {}, call),
      })
      .onConflict((conflict) => conflict.columns(['analysis_id', 'extractor_version']).doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!inserted || outcome.outcome !== 'classified') return;
    if (outcome.entities.length)
      await db
        .insertInto('entity_sentiments')
        .values(
          outcome.entities.map((entity) => ({
            id: randomUUID(),
            workspace_id: task.workspace_id,
            perception_id: id,
            entity_id: entity.entity_id,
            entity_name: entity.entity_name,
            entity_kind: entity.entity_kind,
            label: entity.label,
            confidence: entity.confidence,
            low_confidence: entity.low_confidence,
            model_omitted: entity.model_omitted,
            passage_spans: JSON.stringify(entity.passage_spans),
            aspects: JSON.stringify(entity.aspects),
          })),
        )
        .execute();
    if (outcome.names.length) {
      await db
        .insertInto('answer_untracked_names')
        .values(
          outcome.names.map((name) => ({
            id: randomUUID(),
            workspace_id: task.workspace_id,
            project_id: projectId,
            audit_id: subject.audit_id,
            perception_id: id,
            analysis_id: subject.analysis_id,
            name: name.name,
            name_key: name.name_key,
            created_at: new Date(),
          })),
        )
        .execute();
      await refreshNamedCandidates(db, {
        workspaceId: task.workspace_id,
        projectId,
        auditId: subject.audit_id,
      });
    }
    if (!outcome.claims.length) return;
    await db
      .insertInto('answer_claims')
      .values(
        outcome.claims.map((claim) => ({
          id: randomUUID(),
          workspace_id: task.workspace_id,
          perception_id: id,
          ordinal: claim.ordinal,
          topic: claim.topic,
          claim: claim.claim,
          quote: claim.quote,
          quote_start: claim.start,
          quote_end: claim.end,
          confidence: claim.confidence,
          low_confidence: claim.low_confidence,
        })),
      )
      .execute();
    if (factCheck && needsVerification(outcome.claims, factCheck))
      await enqueueTask(db, {
        workspaceId: task.workspace_id,
        projectId,
        kind: policy.perception.fact_check.verification_task_kind,
        payload: { perception_id: id },
        keyParts: [id, factCheck.verify_template_version],
        maxAttempts: policy.perception.fact_check.task_max_attempts,
      });
  };
}

function classify(
  gateway: ModelGateway,
  input: {
    pkg: PerceptionPackage;
    settings: PerceptionPolicy;
    claimsRequest: FactCheckPolicy | null;
    tracked: Parameters<typeof untrackedNames>[0]['tracked'];
  },
) {
  const { pkg, settings, claimsRequest, tracked } = input;
  const { system, user } = perceptionPrompt(pkg, settings, claimsRequest);
  const request = { system, user, inputHash: packageHash(pkg), maxAttempts: settings.max_attempts };
  const classified = (
    value: Parameters<typeof validateOutput>[1],
    claims: ReturnType<typeof validateClaims>,
  ): Outcome => {
    const validated = validateOutput(pkg, value, settings);
    const names = untrackedNames({
      pkg,
      names: value.untracked_businesses,
      tracked,
      policy: settings,
    });
    return {
      outcome: 'classified',
      entities: validated.entities,
      claims: claims.claims,
      names: names.names ?? [],
      drops: { ...validated.drops, ...claims.drops, ...names.drops },
    };
  };
  if (!claimsRequest)
    return callStructured(gateway, { ...request, schema: perceptionOutputSchema }, (value) =>
      classified(value, { claims: [], drops: {} }),
    );
  return callStructured(gateway, { ...request, schema: claimsOutputSchema }, (value) =>
    classified(value, validateClaims(pkg, value.claims, claimsRequest)),
  );
}

export function answerPerception(
  gatewayFactory: () => ModelGateway | null = configuredGateway,
  settings: PerceptionPolicy = policy.perception,
): Executor {
  return async (task, { db, checkCancelled }) => {
    const projectId = await taskProject(db, task);
    const subject = await loadSubject(db, task, projectId);
    const versions = frozenPerceptionVersions(subject.configuration);
    if (!versions || (await alreadyPerceived(db, subject, versions.extractor_version))) return;
    const factCheck = frozenFactCheck(subject.configuration);
    const settle = (outcome: Outcome, call: ModelCall | null = null) => ({
      error: null,
      persist: persist(task, projectId, subject, versions, outcome, call, factCheck),
    });
    const capped = await overCap(db, 'answer_perceptions', {
      workspaceId: task.workspace_id,
      auditId: subject.audit_id,
      called: CALLED,
      perAudit: settings.max_classifications_per_audit,
      perDay: settings.max_classifications_per_workspace_per_day,
    });
    if (capped) return settle({ outcome: 'unavailable', reason: 'platform_cap' });
    const raw = gatewayFactory();
    if (!raw) return settle({ outcome: 'unavailable', reason: 'model_not_configured' });
    if (raw.model !== versions.model)
      return settle({ outcome: 'unavailable', reason: 'model_changed' });
    // Included in the prompt run: recorded with its tokens, not charged.
    const gateway = meterFor(db, task.workspace_id).gateway(raw, 'answer_perception');
    const config = scoringConfig(subject.configuration);
    const languageCode = scalarText(record(subject.configuration).language_code);
    const pkg: PerceptionPackage = {
      extractor_version: versions.extractor_version,
      template_version: versions.template_version,
      language: languageCode,
      prompt: subject.prompt,
      themes: (await listThemes(db, { workspaceId: task.workspace_id, projectId })).map(
        ({ id, name }) => ({ id, name }),
      ),
      entities: entityPassages({
        answer: subject.answer_text,
        languageCode,
        config,
        policy: settings,
        promptNamesBrand: cohortNamesBrand(subject.cohort),
      }),
    };
    if (!pkg.entities.length) return settle({ outcome: 'no_mentions' });
    await checkCancelled('perception_model_call');
    const { call, outcome } = await classify(gateway, {
      pkg,
      settings,
      claimsRequest: factCheck ? settings.fact_check : null,
      tracked: trackedEntities(config),
    });
    return settle(outcome, call);
  };
}

export async function compensatePerception(db: Database, task: QueueTask) {
  const projectId = await taskProject(db, task);
  const subject = await loadSubject(db, task, projectId);
  const versions = frozenPerceptionVersions(subject.configuration);
  if (!versions) return;
  await persist(
    task,
    projectId,
    subject,
    versions,
    { outcome: 'unavailable', reason: 'task_failed' },
    null,
    null,
  )(db);
}
