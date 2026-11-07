/** Audit schedule commands for the browser and the public API. */
import type { z } from 'zod';

import type { scheduleCreate, scheduleUpdate } from '../audits/schedule-inputs.ts';
import * as schedules from '../audits/schedules.ts';
import type { Database } from '../db/database.ts';
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

export function updateSchedule(
  db: Database,
  actor: Writer,
  projectId: string,
  scheduleId: string,
  input: z.output<typeof scheduleUpdate>,
) {
  return schedules.updateSchedule(db, scopeOf(actor, projectId), scheduleId, input);
}

export function deleteSchedule(db: Database, actor: Writer, projectId: string, scheduleId: string) {
  return schedules.deleteSchedule(db, scopeOf(actor, projectId), scheduleId);
}
