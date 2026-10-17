/** Audit schedule commands for the browser and the public API. */
import type { z } from 'zod';

import { requireCapability, type Actor } from '../auth/actor.ts';
import type { scheduleCreate, scheduleUpdate } from '../audits/schedule-inputs.ts';
import * as schedules from '../audits/schedules.ts';
import type { Database } from '../db/database.ts';

const SCOPE = 'schedules:write';

function scopeOf(actor: Actor, projectId: string): schedules.ScheduleScope {
  requireCapability(actor, 'write', SCOPE);
  return { workspaceId: actor.workspaceId, projectId };
}

export function createSchedule(
  db: Database,
  actor: Actor,
  projectId: string,
  input: z.output<typeof scheduleCreate>,
) {
  return schedules.createSchedule(db, scopeOf(actor, projectId), input);
}

export function updateSchedule(
  db: Database,
  actor: Actor,
  projectId: string,
  scheduleId: string,
  input: z.output<typeof scheduleUpdate>,
) {
  return schedules.updateSchedule(db, scopeOf(actor, projectId), scheduleId, input);
}

export function deleteSchedule(db: Database, actor: Actor, projectId: string, scheduleId: string) {
  return schedules.deleteSchedule(db, scopeOf(actor, projectId), scheduleId);
}
