/**
 * Proof that a pull source's subscription belongs to the workspace that named
 * it. The reader service account is shared by every customer, so a workspace
 * could name another customer's subscription the reader can see; the label
 * `citeladder-source=<nonce>` only the owner can set closes that confused
 * deputy. Checked before the first pull and then daily; no pull runs while
 * the check fails.
 */
import type { Selectable } from 'kysely';
import type { z } from 'zod';
import type { crawlVerificationFailureSchema } from '@citeladder/contracts/ai-traffic';
import type { Database } from '../db/database.ts';
import type { CrawlLogSources } from '../generated/db-schema.ts';
import { crawlLogs } from '../config/crawl-logs.ts';
import { lockAuthorizedWorkspace } from '../workspaces/service.ts';
import { GcpError, type GcpSubscription, type PubSubReader } from './gcp-client.ts';
import { lockCrawlState } from './state.ts';

export type VerificationFailure = z.infer<typeof crawlVerificationFailureSchema>;
type PullSource = Pick<
  Selectable<CrawlLogSources>,
  'id' | 'workspace_id' | 'project_id' | 'subscription' | 'verification_nonce'
>;

/** The first ownership or delivery rule the subscription breaks, or null. */
function subscriptionFailure(
  subscription: GcpSubscription,
  nonce: string,
): VerificationFailure | null {
  if (subscription.labels[crawlLogs.gcp_pull.source_label] !== nonce) return 'label_mismatch';
  // A push, BigQuery or Cloud Storage subscription delivers elsewhere; it cannot be pulled.
  if (
    subscription.pushConfig.pushEndpoint ||
    subscription.bigqueryConfig?.table ||
    subscription.cloudStorageConfig?.bucket
  )
    return 'push_subscription';
  if (subscription.ackDeadlineSeconds < crawlLogs.gcp_pull.min_ack_deadline_seconds)
    return 'ack_deadline';
  return null;
}

/** One subscription GET outside any transaction; a Google outage is `unavailable`. */
async function checkSubscription(
  source: PullSource,
  reader: PubSubReader,
): Promise<VerificationFailure | null> {
  if (!source.subscription || !source.verification_nonce) return 'not_found';
  try {
    return subscriptionFailure(
      await reader.subscription(source.subscription),
      source.verification_nonce,
    );
  } catch (error) {
    if (!(error instanceof GcpError)) throw error;
    if (error.failure === 'permission_denied') return 'permission_denied';
    // A name Google refuses as malformed names no subscription the reader can use.
    if (error.failure === 'not_found' || error.failure === 'invalid') return 'not_found';
    return 'unavailable';
  }
}

/**
 * Check the subscription and persist the outcome. A pass records the time and
 * lifts a verification stall; a failure stalls the source with its reason. An
 * unavailable Google changes nothing: CiteLadder's outage is not the
 * customer's failure. With `actorId`, the actor's authority is rechecked when
 * the outcome is written.
 */
export async function verifyPullSource(
  db: Database,
  source: PullSource,
  reader: PubSubReader,
  options: { now?: Date; actorId?: string } = {},
) {
  const failure = await checkSubscription(source, reader);
  if (failure === 'unavailable') return { verified: false, failure } as const;
  await recordVerification(db, source, failure, options);
  return { verified: failure === null, failure };
}

/**
 * Persist a subscription check's outcome; a pull refused for permission or a
 * missing subscription records the same failure as a check would.
 */
export async function recordVerification(
  db: Database,
  source: Pick<PullSource, 'id' | 'workspace_id' | 'project_id'>,
  failure: Exclude<VerificationFailure, 'unavailable'> | null,
  options: { now?: Date; actorId?: string } = {},
) {
  const now = options.now ?? new Date();
  const scope = { workspaceId: source.workspace_id, projectId: source.project_id };
  await db.transaction().execute(async (trx) => {
    if (options.actorId)
      await lockAuthorizedWorkspace(trx, scope.workspaceId, options.actorId, 'manage_credentials');
    await lockCrawlState(trx, scope);
    const current = await trx
      .selectFrom('crawl_log_sources')
      .select(['verified_at', 'stall_reason', 'stalled_at'])
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('id', '=', source.id)
      .where('kind', '=', 'pull')
      .where('status', '=', 'active')
      .forUpdate()
      .executeTakeFirst();
    if (!current) return;
    const verificationStall = current.stall_reason === 'verification_failed';
    const outcome =
      failure === null
        ? {
            verified_at: current.verified_at ?? now,
            verification_failure: null,
            ...(verificationStall ? { stall_reason: null, stalled_at: null } : {}),
          }
        : {
            verification_failure: failure,
            stall_reason: 'verification_failed',
            // A continuing verification stall keeps the time it began.
            stalled_at: verificationStall ? current.stalled_at : now,
          };
    await trx
      .updateTable('crawl_log_sources')
      .set({ verification_checked_at: now, ...outcome })
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('id', '=', source.id)
      .execute();
  });
}
