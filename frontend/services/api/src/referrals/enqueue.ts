/**
 * The referral chain's successor enqueues. The integration completion owner
 * starts the chain; the queue owner (`queue/enqueue.ts`) keys and inserts them.
 */
import type { Database } from '../db/database.ts';
import { enqueueTask } from '../queue/enqueue.ts';

const KIND_CLASSIFY = 'classify_referrals';
const KIND_SNAPSHOT_REFRESH = 'ai_referrals_snapshot_refresh';

/** Classification of the events one artifact ingested. */
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

/**
 * An AI Referrals snapshot rebuild for one sync window. The key carries the
 * data revision, so a re-sync of a projected window re-fires the refresh
 * while a same-revision duplicate still dedupes.
 */
export function enqueueAiReferralsSnapshotRefresh(
  db: Database,
  options: {
    workspaceId: string;
    projectId: string;
    windowStart: string;
    windowEnd: string;
    resyncSeq: number;
    sourceRevision: string;
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
    keyParts: [
      options.projectId,
      options.windowStart,
      options.windowEnd,
      options.resyncSeq,
      options.sourceRevision,
    ],
    maxAttempts: options.maxAttempts,
  });
}
