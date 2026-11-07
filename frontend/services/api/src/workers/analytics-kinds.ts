/**
 * The analytics kind registry: the one list of `analytics_tasks` kinds the
 * analytics worker claims, recovers and compensates. Each feature exports its
 * own kinds; a kind exists only here, never as a separate catalog entry.
 */
import { commerceKinds } from '../commerce/analytics-kinds.ts';
import { crawlLogKinds } from '../crawl-logs/analytics-kinds.ts';
import { demandKinds } from '../demand/analytics-kinds.ts';
import { opportunityKinds } from '../opportunities/analytics-kinds.ts';
import { perceptionKinds } from '../perception/analytics-kinds.ts';
import type { AnalyticsKind, AnalyticsKinds } from '../queue/executor.ts';
import { referralKinds } from '../referrals/analytics-kinds.ts';
import { searchIntelligenceKinds } from '../search-intelligence/analytics-kinds.ts';
import { internalLinkKinds } from '../site-health/analytics-kinds.ts';
import { sourcePageKinds } from '../source-pages/analytics-kinds.ts';
import { compareText } from '../text-order.ts';
import { trafficKinds } from '../traffic/analytics-kinds.ts';

export const ANALYTICS_KINDS: AnalyticsKinds = Object.freeze({
  ...crawlLogKinds,
  ...commerceKinds,
  ...searchIntelligenceKinds,
  ...sourcePageKinds,
  ...internalLinkKinds,
  ...referralKinds,
  ...trafficKinds,
  ...demandKinds,
  ...opportunityKinds,
  ...perceptionKinds,
});

/** Every registered kind, in stable text order. */
export const ANALYTICS_KIND_NAMES: readonly string[] =
  Object.keys(ANALYTICS_KINDS).sort(compareText);

const registered = Object.entries(ANALYTICS_KINDS);

/** Per-kind lease overrides, for work that holds an external resource longer. */
export const ANALYTICS_LEASE_TTL_SECONDS: Readonly<Record<string, number>> = Object.fromEntries(
  registered.flatMap(([kind, { leaseTtlSeconds }]) =>
    leaseTtlSeconds === undefined ? [] : [[kind, leaseTtlSeconds] as const],
  ),
);

/** Durable terminal compensation, keyed by the kinds that owe one. */
export const ANALYTICS_COMPENSATORS: Readonly<
  Record<string, NonNullable<AnalyticsKind['compensate']>>
> = Object.fromEntries(
  registered.flatMap(([kind, { compensate }]) =>
    compensate === undefined ? [] : [[kind, compensate] as const],
  ),
);
