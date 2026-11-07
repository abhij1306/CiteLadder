import ipaddr from 'ipaddr.js';
import { crawlLogs } from '../config/crawl-logs.ts';
import type { CrawlerBot } from '../config/crawlers.ts';
import type { Selectable } from 'kysely';
import type { BotIpRangeSnapshots } from '../generated/db-schema.ts';
import { strings } from '../db/json.ts';

export function verifyBot(
  bot: CrawlerBot,
  ip: string | null,
  snapshot: Selectable<BotIpRangeSnapshots> | undefined,
  at: Date,
  now: Date,
) {
  const result = (
    verification: string,
    verification_reason: string | null,
    verification_basis: string | null = null,
  ) => ({
    verification,
    verification_reason,
    verification_basis,
    ip_range_snapshot_id: snapshot?.id ?? null,
  });
  if (!ip) return result('unverifiable', 'missing_ip');
  if (bot.verification.method === 'none') return result('unverifiable', 'no_published_ranges');
  if (snapshot?.status !== 'succeeded') return result('unverifiable', 'no_snapshot');
  if (now.getTime() - snapshot.fetched_at.getTime() > crawlLogs.ip_range_max_age_hours * 3600000)
    return result('unverifiable', 'stale_snapshot');
  if (
    at.getTime() - snapshot.fetched_at.getTime() >
    crawlLogs.ip_range_contemporaneous_hours * 3600000
  )
    return result('unverifiable', 'stale_snapshot');
  try {
    const address = ipaddr.process(ip);
    const matches = strings(snapshot.cidrs).some((cidr) => {
      const [network, prefix] = ipaddr.parseCIDR(cidr);
      return address.kind() === network.kind() && address.match(network, prefix);
    });
    const basis =
      Math.abs(snapshot.fetched_at.getTime() - at.getTime()) <=
      crawlLogs.ip_range_contemporaneous_hours * 3600000
        ? 'contemporaneous'
        : 'later_snapshot';
    // Ranges change over time: only a contemporaneous snapshot can fail a request.
    if (!matches)
      return basis === 'contemporaneous'
        ? result('failed_verification', 'ip_outside_ranges')
        : result('unverifiable', 'later_snapshot_mismatch');
    return result('verified', null, basis);
  } catch {
    return result('unverifiable', 'invalid_ip');
  }
}
