import type { z } from 'zod';

import { auditRuntime } from '../audits/config.ts';
import { createAudits } from '../audits/creation.ts';
import { estimateAudit } from '../audits/estimate.ts';
import { auditInput, auditLaunchInput } from '../audits/inputs.ts';
import { executeInteractiveAudit } from '../audits/interactive.ts';
import { cancelAudit as cancelOwnedAudit } from '../audits/maintenance.ts';
import { auditProjections } from '../audits/projections.ts';
import { readAudit, readAudits } from '../audits/reads.ts';
import type { ServiceConfig } from '../config.ts';
import type { Database } from '../db/database.ts';
import { ApiError } from '../errors.ts';
import { interactiveSlots } from '../http/interactive-slots.ts';
import { permission, type Authorized } from './permission.ts';

export const AUDITS_RUN = permission({ capability: 'run', scope: 'audits:run' });
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

export async function cancelAudit(
  db: Database,
  actor: Authorized<typeof AUDITS_CANCEL>,
  projectId: string | null,
  auditId: string,
) {
  const { finalize } = await cancelOwnedAudit(
    db,
    { workspaceId: actor.workspaceId, projectId },
    auditId,
  );
  if (finalize) await auditProjections(db).finalize(actor.workspaceId, auditId);
  return readAudit(db, actor.workspaceId, auditId);
}
