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
 * data revision and the classified artifact, so a re-sync of a projected window
 * re-fires the refresh, each referral artifact of one run gets its own refresh
 * after its classification, and only a repeat for the same artifact dedupes.
 */
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
    // The run fixes the window and revision; the key stays within its column.
    keyParts: [options.projectId, options.sourceRevision, options.artifactId],
    maxAttempts: options.maxAttempts,
  });
}
