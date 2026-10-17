import ipaddr from 'ipaddr.js';
import { crawlLogs } from '../config/crawl-logs.ts';
import { crawlers, type CrawlerBot } from '../config/crawlers.ts';
import { canonicalPage, hash } from '../traffic/normalization.ts';
import type { Selectable } from 'kysely';
import type { BotIpRangeSnapshots } from '../generated/db-schema.ts';
import { strings } from '../db/json.ts';

export function pathIdentity(path: string, origin: string) {
  const withoutQuery = path.split(/[?#]/u)[0]!;
  const canonical = canonicalPage(withoutQuery, origin);
  if (!canonical) return null;
  // Inspect decoded segments to catch encoded secrets without changing exact identity.
  let display = new URL(canonical).pathname;
  try {
    display = decodeURIComponent(display);
  } catch {
    return null;
  }
  let redacted = false;
  for (const pattern of crawlLogs.secret_path_patterns) {
    display = display.replace(new RegExp(pattern, 'giu'), () => {
      redacted = true;
      return '[redacted]';
    });
  }
  if (display.length > 2048) return null;
  const folder =
    '/' + display.split('/').filter(Boolean).slice(0, crawlLogs.folder_depth).join('/');
  const lower = display.toLowerCase();
  const resource = crawlers.resource_rules.find(
    (rule) =>
      rule.paths.some((value) => lower === value.toLowerCase()) ||
      rule.extensions.some((value) => lower.endsWith(value.toLowerCase())),
  );
  return {
    display_path: display,
    canonical_url: redacted ? null : canonical,
    identity: redacted ? 'non_joinable' : 'exact',
    identity_reason: redacted ? 'redacted_secret' : null,
    url_hash: redacted ? null : hash(canonical),
    folder,
    resource_class: resource?.resource_class ?? 'page',
  };
}
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
