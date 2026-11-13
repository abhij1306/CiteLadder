/**
 * The content-angle refresh's triggers: a finished audit (its citations are
 * committed) and a terminal crawl (content pages and owned matches depend on
 * it). One task per trigger and methodology version; the task itself decides
 * from its input keys whether anything changed.
 */
import type { Transaction } from 'kysely';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import type { DB } from '../generated/db-schema.ts';
import type { Scope } from '../opportunities/sources.ts';
import { enqueueTask } from '../queue/enqueue.ts';

export function enqueueContentAngles(
  db: Database | Transaction<DB>,
  scope: Scope,
  trigger: { kind: 'audit' | 'site_crawl'; id: string; maxAttempts?: number },
) {
  return enqueueTask(db, {
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    kind: 'content_angle_refresh',
    payload: { trigger_kind: trigger.kind, trigger_id: trigger.id },
    keyParts: [
      scope.projectId,
      trigger.kind,
      trigger.id,
      policy.content_optimization.methodology_version,
    ],
    maxAttempts: trigger.maxAttempts,
  });
}
