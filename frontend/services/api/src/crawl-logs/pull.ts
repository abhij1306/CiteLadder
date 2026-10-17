/**
 * `crawl_log_pull`: drain one verified Google Cloud subscription.
 *
 * Each iteration pulls outside any transaction, admits the batch through
 * `ingest()` in its own transaction, and acknowledges only after that commit.
 * A lost acknowledgement only causes redelivery, which request-ID dedupe
 * absorbs. An empty pull records a drained heartbeat receipt; coverage reads
 * those receipts. A permission or missing-subscription refusal stalls the
 * source until the daily check passes again.
 */
import type { Selectable } from 'kysely';
import type { Database } from '../db/database.ts';
import type { CrawlLogSources } from '../generated/db-schema.ts';
import type { Executor } from '../workers/executor.ts';
import { crawlLogs } from '../config/crawl-logs.ts';
import { record } from '../db/json.ts';
import { ApiError } from '../errors.ts';
import {
  defaultPubSubReader,
  GcpError,
  type PubSubReader,
  type PulledMessage,
} from './gcp-client.ts';
import { gcpLogLine } from './gcp-entry.ts';
import { recordVerification, verifyPullSource } from './gcp-verify.ts';
import { ingest } from './ingest.ts';
import { crawlLogAvailability, findLivePullSource } from './sources.ts';
import { CHECK_HELD_STALLS } from './stall.ts';
import { enqueueTask } from '../referrals/enqueue.ts';

type Source = Selectable<CrawlLogSources>;
const settings = crawlLogs.gcp_pull;

async function touch(db: Database, source: Source, column: 'last_pull_at' | 'last_drained_at') {
  await db
    .updateTable('crawl_log_sources')
    .set({ [column]: new Date() })
    .where('workspace_id', '=', source.workspace_id)
    .where('project_id', '=', source.project_id)
    .where('id', '=', source.id)
    .execute();
}
const verificationDue = (source: Source, now: Date) =>
  !source.verification_checked_at ||
  source.verification_checked_at.getTime() <
    now.getTime() - settings.verification_interval_hours * 3600000;

/** False when admission is refused for now; the messages wait for a later pull. */
async function admitted(admit: Promise<unknown>) {
  try {
    await admit;
    return true;
  } catch (error) {
    // A paused or lapsed plan, the batch quota or the daily volume ceiling.
    if (error instanceof ApiError && [409, 429].includes(error.status)) return false;
    throw error;
  }
}
/** One pulled batch admitted and acknowledged; false when the drain must stop here. */
async function admitBatch(
  db: Database,
  source: Source,
  subscription: string,
  reader: PubSubReader,
  messages: readonly [PulledMessage, ...PulledMessage[]],
) {
  const lines: string[] = [];
  for (const message of messages) {
    const line = gcpLogLine(message.data);
    if (line) lines.push(line);
  }
  const last = messages.at(-1) ?? messages[0];
  const admit = ingest(db, source, Buffer.from(lines.join('\n')), {
    key: `pull:${source.id}:${messages[0].messageId}:${last.messageId}`,
    rejectedRecords: messages.length - lines.length,
  });
  if (!(await admitted(admit))) return false;
  try {
    await reader.acknowledge(
      subscription,
      messages.map((m) => m.ackId),
    );
  } catch (error) {
    if (error instanceof GcpError) return false;
    throw error;
  }
  return true;
}

/**
 * Queue a pull for each of the workspace's verified live pull sources that is
 * due: every `pull_interval_seconds`, or daily while a verification failure or
 * lapsed plan holds it. The key coalesces a source's pulls per interval.
 */
export async function enqueueDuePulls(
  db: Database,
  workspaceId: string,
  now: Date,
  canAdmit: () => boolean,
) {
  const interval = settings.pull_interval_seconds * 1000;
  const recent = new Date(now.getTime() - interval);
  const daily = new Date(now.getTime() - settings.verification_interval_hours * 3600000);
  const held = CHECK_HELD_STALLS;
  const due = await db
    .selectFrom('crawl_log_sources')
    .select(['id', 'project_id'])
    .where('workspace_id', '=', workspaceId)
    .where('kind', '=', 'pull')
    .where('status', '=', 'active')
    .where('verified_at', 'is not', null)
    .where((eb) =>
      eb.or([
        eb.and([
          eb.or([eb('stall_reason', 'is', null), eb('stall_reason', 'not in', held)]),
          eb.or([eb('last_pull_at', 'is', null), eb('last_pull_at', '<', recent)]),
        ]),
        eb.and([
          eb('stall_reason', 'in', held),
          eb.or([eb('last_pull_at', 'is', null), eb('last_pull_at', '<', daily)]),
        ]),
      ]),
    )
    .orderBy('id')
    .limit(crawlLogs.sweep_batch_size)
    .execute();
  for (const source of due) {
    if (!canAdmit()) return false;
    const task = {
      workspaceId,
      projectId: source.project_id,
      kind: 'crawl_log_pull',
      payload: { source_id: source.id },
      keyParts: [source.id, Math.floor(now.getTime() / interval)],
      maxAttempts: crawlLogs.task_max_attempts,
    };
    // One source at a time keeps each enqueue inside the tick's admission budget.
    await enqueueTask(db, task); // NOSONAR
  }
  return true;
}
export function crawlLogPull(readerFor: () => PubSubReader | null = defaultPubSubReader): Executor {
  return async (task, { db, checkCancelled }) => {
    const sourceId = record(task.payload).source_id;
    const reader = readerFor();
    if (!reader || !task.project_id || typeof sourceId !== 'string') return;
    const scope = { workspaceId: task.workspace_id, projectId: task.project_id };
    let source = await findLivePullSource(db, scope, sourceId);
    if (!source?.verified_at) return;
    // Committed before any Google call: the tick schedules the next attempt from this time.
    await touch(db, source, 'last_pull_at');
    if (crawlLogAvailability() !== 'available') return;
    if (verificationDue(source, new Date())) {
      await checkCancelled('crawl-log-verify');
      // An ownership check that could not run is not a pass: pull again once one does.
      const { failure } = await verifyPullSource(db, source, reader);
      if (failure === 'unavailable') return;
      source = await findLivePullSource(db, scope, sourceId);
    }
    const subscription = source?.subscription;
    if (!source || !subscription || CHECK_HELD_STALLS.includes(source.stall_reason ?? '')) return;
    await drain({
      db,
      reader,
      source,
      subscription,
      drainKey: `pull:${source.id}:drained:${task.id}:${task.attempt_count}`,
      checkCancelled,
    });
  };
}
/** Messages from one pull, or null when the refusal stalled the source. */
async function pullOnce(db: Database, reader: PubSubReader, source: Source, subscription: string) {
  try {
    return await reader.pull(subscription, settings.pull_max_messages);
  } catch (error) {
    if (
      error instanceof GcpError &&
      (error.failure === 'permission_denied' || error.failure === 'not_found')
    ) {
      await recordVerification(db, source, error.failure);
      return null;
    }
    throw error;
  }
}
/** Pull, admit and acknowledge until the subscription is empty or the iteration bound. */
async function drain(input: {
  db: Database;
  reader: PubSubReader;
  source: Source;
  subscription: string;
  drainKey: string;
  checkCancelled: (boundary: string) => Promise<void>;
}) {
  const { db, reader, source, subscription } = input;
  for (let iteration = 0; iteration < settings.pull_max_iterations; iteration += 1) {
    await input.checkCancelled('crawl-log-pull');
    const messages = await pullOnce(db, reader, source, subscription);
    if (!messages) return;
    const [head, ...rest] = messages;
    if (!head) {
      const empty = ingest(db, source, Buffer.alloc(0), { key: input.drainKey, drained: true });
      if (await admitted(empty)) await touch(db, source, 'last_drained_at');
      return;
    }
    if (!(await admitBatch(db, source, subscription, reader, [head, ...rest]))) return;
  }
}
