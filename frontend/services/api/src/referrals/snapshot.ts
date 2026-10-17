/**
 * `ai_referrals_snapshot_refresh`: rebuild the AI Referrals snapshots of one
 * sync window, plus the preset family anchored on the latest evidence date.
 *
 * Read phase: every canonical `ga4_source_medium_daily` row in the scanned
 * span, left-joined to its optional event and classification, in keyset
 * batches with cooperative cancel at each boundary. Write phase: one
 * transaction upserts every snapshot on `(project_id, window_start,
 * window_end, granularity)`, so a refresh never leaves a half-written family
 * and a re-run rewrites the same rows.
 */
import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { isoDateText } from '../db/timestamps.ts';
import { payloadWindow, requireProject, type Executor } from '../workers/executor.ts';
import {
  addDays,
  bucketStart,
  buildAiReferralsProjection,
  type ReferralFact,
} from './projection.ts';
import { compareText, textSpan } from '../text-order.ts';
import { isNonEmpty } from '../lists.ts';
import { selectedPartition, partitionAnchor, partitionEpoch } from '../integrations/partitions.ts';
import { referralEvidence, referralExtras, replaceReferralLandings } from './landing.ts';
import { enqueueTrafficInsights } from '../crawl-logs/insights-enqueue.ts';

const { analytics, referrals } = policy;
const BATCH_SIZE = 1000;
const SOURCE_MEDIUM = referrals.datasets.source_medium_daily;

type RefreshWindow = { start: string; end: string; granularity: string; presetDays: number | null };

/**
 * The sync window, then the preset family, each at every granularity. The
 * family comes last so a window that is both keeps the preset marker a preset
 * read matches on.
 */
function refreshWindows(
  windowStart: string,
  windowEnd: string,
  anchor: string | null,
): RefreshWindow[] {
  const granularities = [...analytics.snapshot_granularities].sort(compareText);
  const windows: RefreshWindow[] = granularities.map((granularity) => ({
    start: windowStart,
    end: windowEnd,
    granularity,
    presetDays: null,
  }));
  if (anchor === null) return windows;
  for (const days of analytics.snapshot_window_days)
    for (const granularity of granularities)
      windows.push({
        start: addDays(anchor, -(days - 1)),
        end: anchor,
        granularity,
        presetDays: days,
      });
  return windows;
}

/** `metric_count`: an additive measure, 0 when missing or not numeric. */
function sessionCount(metrics: unknown): number {
  const value =
    metrics !== null && typeof metrics === 'object' && !Array.isArray(metrics)
      ? (metrics as Record<string, unknown>).sessions
      : undefined;
  if (typeof value === 'boolean') return Number(value);
  return typeof value === 'number' ? Math.trunc(value) : 0;
}

function factBatch(
  db: Database,
  scope: { workspaceId: string; projectId: string; start: string; end: string },
  afterId: string | null,
) {
  let query = db
    .selectFrom('integration_metric_rows as row')
    .leftJoin('referral_events as event', (join) =>
      join
        .onRef('event.source_metric_row_id', '=', 'row.id')
        .on('event.workspace_id', '=', scope.workspaceId)
        .on('event.project_id', '=', scope.projectId),
    )
    .leftJoin('referral_classifications as classification', (join) =>
      join
        .onRef('classification.referral_event_id', '=', 'event.id')
        .on('classification.workspace_id', '=', scope.workspaceId)
        .on('classification.project_id', '=', scope.projectId),
    )
    .select([
      'row.id',
      'row.property_ref',
      'row.provider',
      'row.dataset',
      'row.dimension_key',
      'row.metrics',
      'row.resync_seq',
      isoDateText(sql.ref('row.date')).as('date'),
      'classification.id as classification_id',
      'classification.is_ai_referral',
      'classification.ai_source',
    ])
    .where('row.workspace_id', '=', scope.workspaceId)
    .where('row.project_id', '=', scope.projectId)
    .where('row.date', '>=', sql<Date>`${scope.start}::date`)
    .where('row.date', '<=', sql<Date>`${scope.end}::date`)
    .where('row.dataset', '=', SOURCE_MEDIUM)
    .where(selectedPartition('row'))
    .orderBy('row.id', 'asc')
    .limit(BATCH_SIZE);
  if (afterId !== null) query = query.where('row.id', '>', afterId);
  return query.execute();
}

export const refreshAiReferralsSnapshot: Executor = async (task, { db, checkCancelled }) => {
  const projectId = requireProject(task);
  const { windowStart, windowEnd } = payloadWindow(task);
  await db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtextextended(${task.workspace_id + ':' + projectId + ':referrals'},0))`.execute(
      trx,
    );
    const anchor = await partitionAnchor(trx, task.workspace_id, projectId, SOURCE_MEDIUM);
    const epoch = await partitionEpoch(trx, { workspaceId: task.workspace_id, projectId });
    const windows = refreshWindows(windowStart, windowEnd, anchor);
    // The family is nested and ends at the anchor, so one scan covers them all.
    if (!isNonEmpty(windows)) throw new Error('Expected at least one referral refresh window');
    const scope = { workspaceId: task.workspace_id, projectId, ...textSpan(windows) };

    const facts: ReferralFact[] = [];
    let afterId: string | null = null;
    for (;;) {
      await checkCancelled('classification batch');
      const batch = await factBatch(trx, scope, afterId);
      for (const row of batch) {
        facts.push({
          classification_id: row.classification_id,
          is_ai_referral: row.classification_id === null ? null : Boolean(row.is_ai_referral),
          ai_source: row.ai_source ?? '',
          occurred_date: row.date,
          sessions: sessionCount(row.metrics),
          row_identity: [row.property_ref, row.provider, row.dataset, row.date, row.dimension_key],
          resync_seq: row.resync_seq,
        });
      }
      const last = batch.at(-1);
      if (batch.length < BATCH_SIZE || !last) break;
      afterId = last.id;
    }

    const evidence = await referralEvidence(trx, scope);
    if ((await partitionEpoch(trx, scope)) !== epoch)
      throw new Error('Integration partitions changed during Referrals projection; retry');
    await replaceReferralLandings(trx, scope, referralExtras(evidence, scope.start, scope.end));
    for (const window of windows) {
      const projection = buildAiReferralsProjection({
        facts,
        windowStart: window.start,
        windowEnd: window.end,
        granularity: window.granularity,
      });
      // A series point covers only its own calendar bucket inside the window.
      const inBucket = (day: string, point: string) =>
        day >= window.start &&
        day <= window.end &&
        bucketStart(day, window.granularity) === bucketStart(point, window.granularity);
      const pendingBuckets = new Set(
        facts
          .filter(
            (f) =>
              f.is_ai_referral === null &&
              f.occurred_date >= window.start &&
              f.occurred_date <= window.end,
          )
          .map((f) => bucketStart(f.occurred_date, window.granularity)),
      );
      const classificationPending = (point: string) =>
        pendingBuckets.has(bucketStart(point, window.granularity));
      const extras = referralExtras(evidence, window.start, window.end);
      const content = {
        preset_window_days: window.presetDays,
        metrics: JSON.stringify({
          ...projection.metrics,
          ...extras,
          landing: extras.landing.map(({ source_metric_row_ids, ...landing }) => ({
            ...landing,
            source_metric_row_count: source_metric_row_ids.length,
          })),
          ...Object.fromEntries(
            ['referral_volume', 'referral_share'].map((series) => [
              series,
              projection.metrics[series as 'referral_volume' | 'referral_share'].map((point) => {
                const days = evidence.quality[SOURCE_MEDIUM]!.filter((q) =>
                  inBucket(q.day, point.date),
                );
                const bad = days.some((q) => q.flags.length > 0 || q.revision === null);
                let value = point.value;
                if (bad && value === 0) value = null;
                else if (
                  series === 'referral_volume' &&
                  value === null &&
                  !bad &&
                  !classificationPending(point.date)
                )
                  value = 0;
                return {
                  ...point,
                  value,
                };
              }),
            ]),
          ),
        }),
        source_classification_ids: JSON.stringify(projection.source_classification_ids),
        analyzer_version: analytics.ai_referral_analyzer_version,
        formula_version: analytics.ai_referral_formula_version,
      };
      await trx
        .insertInto('ai_referrals_snapshots')
        .values({
          id: randomUUID(),
          workspace_id: task.workspace_id,
          project_id: projectId,
          window_start: window.start,
          window_end: window.end,
          granularity: window.granularity,
          created_at: new Date(),
          ...content,
        })
        .onConflict((conflict) =>
          conflict
            .columns(['project_id', 'window_start', 'window_end', 'granularity'])
            .doUpdateSet(content),
        )
        .execute();
    }
    await enqueueTrafficInsights(trx, { workspaceId: task.workspace_id, projectId });
  });
};
