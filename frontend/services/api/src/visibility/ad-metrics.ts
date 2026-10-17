/**
 * Deterministic ads metrics over a selection's answers: applicability,
 * presence rate, advertisers, creatives, prompts and ads beside organic
 * mentions. Pure; the reader supplies persisted answers and observations.
 */
import type {
  AdApplicability,
  AdOwnership,
  AdPresence,
  VisibilityAdsResponse,
} from '@citeladder/contracts/visibility-ads';

import { groupBy, type NonEmpty } from '../lists.ts';
import { compareText } from '../text-order.ts';

export type AdObservation = {
  rank_absolute: number;
  advertiser_name: string;
  advertiser_domain: string;
  ownership: AdOwnership;
  title: string;
  snippet: string;
  landing_url_canonical: string;
};

export type AdAnswer = {
  auditId: string;
  /** Wire UTC text; sorts chronologically. */
  observedAt: string;
  engine: string;
  prompt: string;
  topic: string;
  adsParserVersion: string | null;
  brandMentioned: boolean;
  /** The answer's ads at its own parser version. */
  ads: readonly AdObservation[];
};

type Sighting = AdObservation & { prompt: string; observedAt: string };
export type AdCreative = VisibilityAdsResponse['creatives']['items'][number] & { key: string };
export type AdsSummary = Omit<VisibilityAdsResponse, 'source_audit_ids' | 'creatives'> & {
  creatives: AdCreative[];
};

function adApplicability(
  answer: Pick<AdAnswer, 'engine' | 'adsParserVersion'>,
  adsEngine: string,
): AdApplicability {
  if (answer.engine !== adsEngine) return 'not_applicable';
  return answer.adsParserVersion ? 'applicable' : 'unavailable';
}

/** Applicable if any answer is, else unavailable if any is, else not applicable. */
function foldedApplicability(answers: readonly AdAnswer[], adsEngine: string): AdApplicability {
  const states = new Set(answers.map((answer) => adApplicability(answer, adsEngine)));
  if (states.has('applicable')) return 'applicable';
  return states.has('unavailable') ? 'unavailable' : 'not_applicable';
}

function adsState(
  answers: readonly AdAnswer[],
  options: { adsEngine: string; engineFilter: string | null },
): AdsSummary['state'] {
  if (options.engineFilter !== null && options.engineFilter !== options.adsEngine)
    return 'not_applicable';
  switch (foldedApplicability(answers, options.adsEngine)) {
    case 'applicable':
      return 'value';
    case 'unavailable':
      return 'unavailable';
    case 'not_applicable':
      return 'no_answers';
  }
}

function presence(answers: readonly AdAnswer[]): AdPresence {
  const withAds = answers.filter((answer) => answer.ads.length > 0).length;
  return {
    answers: answers.length,
    answers_with_ads: withAds,
    rate: answers.length ? withAds / answers.length : null,
  };
}

function sightings(answers: readonly AdAnswer[]): Sighting[] {
  return answers.flatMap((answer) =>
    answer.ads.map((ad) => ({ ...ad, prompt: answer.prompt, observedAt: answer.observedAt })),
  );
}

/** Appearance counts and the first/last sighting of one group; identity from the latest. */
function rollup(group: NonEmpty<Sighting>) {
  let first = group[0],
    latest = group[0];
  for (const row of group) {
    if (compareText(row.observedAt, first.observedAt) < 0) first = row;
    if (compareText(row.observedAt, latest.observedAt) >= 0) latest = row;
  }
  return {
    latest,
    appearances: group.length,
    prompts: new Set(group.map((row) => row.prompt)).size,
    first_seen_at: first.observedAt,
    last_seen_at: latest.observedAt,
  };
}

/** The most frequent name in a group, ties broken alphabetically. */
function commonName(group: readonly Sighting[]): string {
  const counts = new Map<string, number>();
  for (const row of group)
    counts.set(row.advertiser_name, (counts.get(row.advertiser_name) ?? 0) + 1);
  return (
    [...counts].sort(([a, left], [b, right]) => right - left || compareText(a, b))[0]?.[0] ?? ''
  );
}

function advertisers(seen: readonly Sighting[]) {
  return [...groupBy(seen, (row) => row.advertiser_domain)]
    .map(([domain, group]) => {
      const { latest, appearances, prompts, first_seen_at, last_seen_at } = rollup(group);
      return {
        name: commonName(group),
        domain,
        ownership: latest.ownership,
        appearances,
        prompts,
        share: appearances / seen.length,
        first_seen_at,
        last_seen_at,
      };
    })
    .sort((a, b) => b.appearances - a.appearances || compareText(a.domain, b.domain));
}

function creatives(seen: readonly Sighting[]): AdCreative[] {
  return [
    ...groupBy(seen, (row) =>
      JSON.stringify([row.advertiser_domain, row.title, row.snippet, row.landing_url_canonical]),
    ),
  ]
    .map(([key, group]) => {
      const { latest, appearances, prompts, first_seen_at, last_seen_at } = rollup(group);
      return {
        key,
        advertiser_name: latest.advertiser_name,
        advertiser_domain: latest.advertiser_domain,
        ownership: latest.ownership,
        title: latest.title,
        snippet: latest.snippet,
        landing_url: latest.landing_url_canonical,
        appearances,
        prompts,
        first_seen_at,
        last_seen_at,
      };
    })
    .sort(creativeOrder);
}

/** Most appearances first, then most recent, then a stable key. */
export function creativeOrder(
  a: Pick<AdCreative, 'appearances' | 'last_seen_at' | 'key'>,
  b: Pick<AdCreative, 'appearances' | 'last_seen_at' | 'key'>,
): number {
  return (
    b.appearances - a.appearances ||
    compareText(b.last_seen_at, a.last_seen_at) ||
    compareText(a.key, b.key)
  );
}

function prompts(applicable: readonly AdAnswer[]) {
  return [...groupBy(applicable, (answer) => answer.prompt)]
    .map(([prompt, answers]) => {
      const seen = sightings(answers);
      const top = advertisers(seen)[0];
      const competitorAds = answers.filter((answer) =>
        answer.ads.some((ad) => ad.ownership === 'competitor'),
      );
      return {
        prompt,
        topic: answers[0].topic,
        presence: presence(answers),
        ads_seen: seen.length,
        top_advertiser: top ? { name: top.name, domain: top.domain } : null,
        competitor_ad_answers: {
          brand_mentioned: competitorAds.filter((answer) => answer.brandMentioned).length,
          brand_not_mentioned: competitorAds.filter((answer) => !answer.brandMentioned).length,
        },
      };
    })
    .filter((row) => row.ads_seen > 0)
    .sort((a, b) => b.ads_seen - a.ads_seen || compareText(a.prompt, b.prompt));
}

function engines(answers: readonly AdAnswer[], adsEngine: string) {
  return [...groupBy(answers, (answer) => answer.engine)]
    .map(([engine, group]) => {
      const applicability = foldedApplicability(group, adsEngine);
      return {
        engine,
        applicability,
        answers: group.length,
        presence:
          applicability === 'applicable'
            ? presence(
                group.filter((answer) => adApplicability(answer, adsEngine) === 'applicable'),
              )
            : null,
      };
    })
    .sort((a, b) => compareText(a.engine, b.engine));
}

export function adsSummary(
  answers: readonly AdAnswer[],
  options: {
    adsEngine: string;
    engineFilter: string | null;
    metricsVersion: string;
    advertisersLimit: number;
  },
): AdsSummary {
  const applicable = answers.filter(
    (answer) => adApplicability(answer, options.adsEngine) === 'applicable',
  );
  const seen = sightings(applicable);
  const everyAdvertiser = advertisers(seen);
  const owned = seen.filter((row) => row.ownership === 'owned');
  return {
    state: adsState(answers, options),
    parser_versions: [
      ...new Set(applicable.flatMap((answer) => answer.adsParserVersion ?? [])),
    ].sort(compareText),
    metrics_version: options.metricsVersion,
    presence: presence(applicable),
    engines: engines(answers, options.adsEngine),
    brand: {
      appearances: owned.length,
      share: owned.length ? owned.length / seen.length : null,
      best_rank: owned.reduce<number | null>(
        (best, row) => (best === null ? row.rank_absolute : Math.min(best, row.rank_absolute)),
        null,
      ),
    },
    advertisers_seen: everyAdvertiser.length,
    advertisers: everyAdvertiser.slice(0, options.advertisersLimit),
    creatives: creatives(seen),
    prompts: prompts(applicable),
    topics: [...groupBy(applicable, (answer) => answer.topic)]
      .map(([topic, group]) => ({ key: topic, label: topic, presence: presence(group) }))
      .sort((a, b) => compareText(a.label, b.label)),
    runs: [...groupBy(applicable, (answer) => answer.auditId)]
      .map(([auditId, group]) => ({
        key: auditId,
        label: group[0].observedAt,
        presence: presence(group),
      }))
      .sort((a, b) => compareText(a.label, b.label) || compareText(a.key, b.key)),
  };
}
