/**
 * Audit commands. A launch creates one queued audit per selected market. The
 * browser may then drive each audit's first results in the request (`run`);
 * the public API launches in one call with an estimate guard and leaves
 * execution to the runner.
 */
import type { z } from 'zod';

import { auditRuntime } from '../audits/config.ts';
import { createAudits } from '../audits/creation.ts';
import { estimateAudit } from '../audits/estimate.ts';
import { auditInput, auditLaunchInput } from '../audits/inputs.ts';
import { executeInteractiveAudit } from '../audits/interactive.ts';
import { cancelAudit as cancelOwnedAudit } from '../audits/maintenance.ts';
import { readAudit, readAudits } from '../audits/reads.ts';
import type { ServiceConfig } from '../config.ts';
import type { Database } from '../db/database.ts';
import { ApiError } from '../errors.ts';
import { interactiveSlots } from '../http/interactive-slots.ts';
import { permission, type Authorized } from './permission.ts';

/** Launching and driving audits, which spends prompt runs. */
export const AUDITS_RUN = permission({ capability: 'run', scope: 'audits:run' });
/** Cancelling an audit. */
export const AUDITS_CANCEL = permission({ capability: 'write', scope: 'audits:run' });
type Runner = Authorized<typeof AUDITS_RUN>;

export async function createQueuedAudit(
  db: Database,
  config: ServiceConfig,
  actor: Runner,
  input: z.output<typeof auditInput>,
) {
  const ids = await createAudits(
    db,
    actor.workspaceId,
    auditInput.parse(input),
    {},
    auditRuntime(config.settings),
  );
  return readAudits(db, actor.workspaceId, ids);
}

/**
 * Drive a queued audit's first phases inside the request, in one of this
 * instance's interactive slots: a full instance answers 429 and the runner
 * keeps the queued audit.
 */
export async function runAudit(
  db: Database,
  config: ServiceConfig,
  actor: Runner,
  auditId: string,
) {
  await readAudit(db, actor.workspaceId, auditId);
  await interactiveSlots.run((stopping) =>
    executeInteractiveAudit(db, config, actor.workspaceId, auditId, stopping),
  );
  return readAudit(db, actor.workspaceId, auditId);
}

/**
 * Estimate, then create the queued audit only when the estimate's maximum
 * attempt count (every answer times its retry budget) is within the caller's
 * ceiling: 409 `estimate_exceeds_limit` otherwise.
 */
export async function launchAudit(
  db: Database,
  config: ServiceConfig,
  actor: Runner,
  projectId: string,
  input: z.output<typeof auditLaunchInput>,
) {
  const { max_attempts: ceiling, ...request } = input;
  const runtime = auditRuntime(config.settings);
  const estimate = await estimateAudit(
    db,
    actor.workspaceId,
    { ...request, project_id: projectId },
    runtime,
  );
  if (estimate.maximum_attempt_count > ceiling)
    throw new ApiError(409, 'The audit estimate exceeds max_attempts', {
      code: 'estimate_exceeds_limit',
      details: {
        maximum_attempt_count: estimate.maximum_attempt_count,
        max_attempts: ceiling,
      },
    });
  const ids = await createAudits(
    db,
    actor.workspaceId,
    auditInput.parse({ ...request, project_id: projectId }),
    {},
    runtime,
  );
  return readAudits(db, actor.workspaceId, ids);
}

/** An audit outside the caller's project (when it named one) is a 404. */
export async function cancelAudit(
  db: Database,
  actor: Authorized<typeof AUDITS_CANCEL>,
  projectId: string | null,
  auditId: string,
) {
  await cancelOwnedAudit(db, { workspaceId: actor.workspaceId, projectId }, auditId);
  return readAudit(db, actor.workspaceId, auditId);
}
