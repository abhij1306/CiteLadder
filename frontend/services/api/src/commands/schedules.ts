import type { z } from 'zod';

import type { scheduleCreate, scheduleUpdate } from '../audits/schedule-inputs.ts';
import * as schedules from '../audits/schedules.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { ApiError } from '../errors.ts';
import { permission, type Authorized } from './permission.ts';

export const SCHEDULES_WRITE = permission({ capability: 'write', scope: 'schedules:write' });
type Writer = Authorized<typeof SCHEDULES_WRITE>;

const scopeOf = (actor: Writer, projectId: string): schedules.ScheduleScope => ({
  workspaceId: actor.workspaceId,
  projectId,
});

export function createSchedule(
  db: Database,
  actor: Writer,
  projectId: string,
  input: z.output<typeof scheduleCreate>,
) {
  return schedules.createSchedule(db, scopeOf(actor, projectId), input);
}

export async function updateSchedule(
  db: Database,
  actor: Writer,
  projectId: string,
  scheduleId: string,
  input: z.output<typeof scheduleUpdate>,
) {
  const scope = scopeOf(actor, projectId);
  const current = await schedules.readSchedule(db, scope, scheduleId);
  if (
    current.audit_scope === policy.probes.audit_scope &&
    Object.keys(input).some((key) => key !== 'enabled')
  )
    throw new ApiError(409, 'Set the market probe schedule from Perception');
  return schedules.updateSchedule(db, scope, scheduleId, input);
}

export function deleteSchedule(db: Database, actor: Writer, projectId: string, scheduleId: string) {
  return schedules.deleteSchedule(db, scopeOf(actor, projectId), scheduleId);
}
