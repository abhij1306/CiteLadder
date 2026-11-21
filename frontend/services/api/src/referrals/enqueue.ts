import type { Database } from '../db/database.ts';
import { enqueueTask } from '../queue/enqueue.ts';

const KIND_CLASSIFY = 'classify_referrals';
const KIND_SNAPSHOT_REFRESH = 'ai_referrals_snapshot_refresh';

export function enqueueClassifyReferrals(
  db: Database,
  options: { workspaceId: string; projectId: string; artifactId: string; maxAttempts: number },
): Promise<string | null> {
  return enqueueTask(db, {
    workspaceId: options.workspaceId,
    projectId: options.projectId,
    kind: KIND_CLASSIFY,
    payload: { import_artifact_id: options.artifactId },
    keyParts: [options.projectId, options.artifactId],
    maxAttempts: options.maxAttempts,
  });
}

export function enqueueAiReferralsSnapshotRefresh(
  db: Database,
  options: {
    workspaceId: string;
    projectId: string;
    windowStart: string;
    windowEnd: string;
    sourceRevision: string;
    artifactId: string;
    maxAttempts: number;
  },
): Promise<string | null> {
  return enqueueTask(db, {
    workspaceId: options.workspaceId,
    projectId: options.projectId,
    kind: KIND_SNAPSHOT_REFRESH,
    payload: {
      window_start: options.windowStart,
      window_end: options.windowEnd,
      source_revision: options.sourceRevision,
    },
    keyParts: [options.projectId, options.sourceRevision, options.artifactId],
    maxAttempts: options.maxAttempts,
  });
}
