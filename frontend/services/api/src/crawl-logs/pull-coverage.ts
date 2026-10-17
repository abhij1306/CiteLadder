/**
 * Coverage of one reporting day for a Google Cloud pull source, judged from
 * its persisted receipts. Drains (empty pulls) are the delivery evidence:
 * pulls run only while the subscription passes verification, so unbroken
 * drains also show it stayed verified.
 */
import type { Selectable } from 'kysely';
import type { CrawlLogBatches, CrawlLogSources } from '../generated/db-schema.ts';
import { crawlLogs } from '../config/crawl-logs.ts';

type Receipt = Pick<Selectable<CrawlLogBatches>, 'received_at' | 'drained' | 'catalog_version'>;
type Day = { start: Date; end: Date };

/** The longest wait between the times, in minutes, counting from midnight to midnight. */
export function gapMinutes(times: readonly Date[], day: Day) {
  const points = [
    day.start.getTime(),
    ...times.map((t) => t.getTime()).sort((a, b) => a - b),
    day.end.getTime(),
  ];
  return Math.max(...points.slice(1).map((t, i) => (t - points[i]!) / 60000));
}

function decision(source: Selectable<CrawlLogSources>, receipts: readonly Receipt[], day: Day) {
  const settings = crawlLogs.gcp_pull;
  const today = receipts.filter((r) => r.received_at >= day.start && r.received_at < day.end);
  const gap = gapMinutes(
    today.filter((r) => r.drained).map((r) => r.received_at),
    day,
  );
  if (!today.length) return { coverage: 'unknown', reason: 'no_data', gap } as const;
  const settledAfter = day.end.getTime() + settings.pull_settle_minutes * 60000;
  // A source first verified after midnight was not collecting the whole day.
  if (
    source.created_at > day.start ||
    !source.verified_at ||
    source.verified_at > day.start ||
    (source.revoked_at && source.revoked_at < day.end)
  )
    return { coverage: 'partial', reason: 'pull_not_live_all_day', gap } as const;
  if (Number(source.declared_sample_rate) !== 1)
    return { coverage: 'partial', reason: 'pull_sampled', gap } as const;
  if (
    (source.filter_confirmed_at && source.filter_confirmed_at > day.start) ||
    today.some((r) => r.catalog_version !== source.filter_catalog_version)
  )
    return { coverage: 'partial', reason: 'sink_filter_outdated', gap } as const;
  if (gap > settings.max_pull_gap_minutes)
    return { coverage: 'partial', reason: 'pull_drain_gap', gap } as const;
  if (!receipts.some((r) => r.drained && r.received_at.getTime() >= settledAfter))
    return { coverage: 'partial', reason: 'pull_awaiting_settle', gap } as const;
  return { coverage: 'complete', reason: 'drained_unsampled_current_filter', gap } as const;
}

/**
 * `complete` only when the source was live all day, the sink filter matched
 * the catalog in force all day, nothing was sampled, drains never paused for
 * longer than `max_pull_gap_minutes`, and a drain settled the day at least
 * `pull_settle_minutes` after it closed. Otherwise `partial` with the first
 * failing condition, or `unknown` without any receipt. Also returns the
 * day's longest wait between drains.
 */
export function pullCoverage(
  source: Selectable<CrawlLogSources>,
  receipts: readonly Receipt[],
  day: Day,
) {
  const { gap, ...judged } = decision(source, receipts, day);
  return { decision: judged, gap };
}
