import { sql, type Transaction } from 'kysely';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import type { DB } from '../generated/db-schema.ts';
import { enqueueCoalesced, enqueueTask } from '../queue/enqueue.ts';
import { MAX_WINDOW_DAYS } from './verification-decisions.ts';

const versions = policy.opportunity.opportunities;
type Trigger = {
  workspaceId: string;
  projectId: string;
  triggerKind: string;
  triggerId: string;
  maxAttempts?: number;
};

export function enqueueOpportunityRefresh(db: Database | Transaction<DB>, trigger: Trigger) {
  const { ANALYZER_VERSION, RULE_VERSION, FORMULA_VERSION } = versions;
  return enqueueTask(db, {
    workspaceId: trigger.workspaceId,
    projectId: trigger.projectId,
    kind: 'opportunity_refresh',
    payload: { trigger_kind: trigger.triggerKind, trigger_id: trigger.triggerId },
    keyParts: [],
    idempotencyKey: [
      'opportunity',
      trigger.triggerKind,
      trigger.triggerId,
      ANALYZER_VERSION,
      RULE_VERSION,
      FORMULA_VERSION,
    ].join(':'),
    maxAttempts: trigger.maxAttempts,
  });
}

export function enqueueDerivedOpportunityRefresh(db: Database, trigger: Trigger) {
  return enqueueCoalesced(db, {
    workspaceId: trigger.workspaceId,
    projectId: trigger.projectId,
    kind: 'opportunity_refresh',
    payload: { trigger_kind: trigger.triggerKind, trigger_id: trigger.triggerId },
    delaySeconds: 0,
    maxAttempts: trigger.maxAttempts,
  });
}

type ProjectScope = { workspaceId: string; projectId: string };

function measuredDeclarations(db: Database | Transaction<DB>, scope: ProjectScope, days: number) {
  return db
    .selectFrom('opportunity_implementation_events')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('declared_implemented_at', '>=', sql<Date>`now() - ${days} * interval '1 day'`);
}

export async function measuredTargetPages(db: Database | Transaction<DB>, scope: ProjectScope) {
  const rows = await measuredDeclarations(db, scope, versions.VERIFICATION_WINDOW_DAYS)
    .select(sql<string>`jsonb_array_elements_text(target_site_url_ids)`.as('id'))
    .execute();
  return rows.map((row) => row.id);
}

export async function enqueueImplementationVerification(
  db: Database | Transaction<DB>,
  trigger: Trigger & { revision?: string; payload?: Record<string, unknown> },
) {
  const measurable = await measuredDeclarations(db, trigger, MAX_WINDOW_DAYS)
    .select('id')
    .limit(1)
    .executeTakeFirst();
  if (!measurable) return null;
  return enqueueTask(db, {
    workspaceId: trigger.workspaceId,
    projectId: trigger.projectId,
    kind: 'opportunity_verification',
    payload: {
      ...trigger.payload,
      trigger_kind: trigger.triggerKind,
      trigger_id: trigger.triggerId,
    },
    keyParts: [],
    idempotencyKey: [
      'implementation-verification',
      trigger.triggerKind,
      trigger.triggerId,
      versions.IMPLEMENTATION_VERIFIER_VERSION,
      trigger.revision ?? 'terminal',
    ].join(':'),
    maxAttempts: trigger.maxAttempts,
  });
}
