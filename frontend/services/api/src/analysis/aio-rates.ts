/**
 * Published rates for the observed Google AI Overview surface.
 *
 * Two rules run through every rate: failed and pending observations are excluded from every
 * denominator, and an empty denominator is UNAVAILABLE (`value: null`),
 * never 0%. A rate always travels with the denominator it divided by.
 */
import { policy } from '../config.ts';

const DENOMINATOR_SUCCESSFUL_OBSERVATIONS = 'successful_observations';
const DENOMINATOR_OBSERVATIONS_WITH_AIO = 'observations_with_ai_overview';

const OVERVIEW_PRESENT = policy.visibility.overview_present_outcome;
const SUCCESSFUL = new Set<string>(policy.visibility.successful_outcomes);

export type AioRate = {
  numerator: number;
  denominator: number;
  denominator_kind: string;
  value: number | null;
};

export type AioObservationCounts = {
  successful: number;
  with_overview: number;
  brand_mentioned: number;
  owned_citation: number;
  excluded: number;
};

/** One scoped observation: its outcome, overview flag and the answer's signals. */
export type AioObservationRow = [
  outcome: string,
  aioPresent: boolean | null,
  namedBrand: boolean,
  citedOwned: boolean,
];

function rate(numerator: number, denominator: number, kind: string): AioRate {
  return {
    numerator,
    denominator,
    denominator_kind: kind,
    value: denominator ? numerator / denominator : null,
  };
}

/**
 * Fold the scoped observation rows once, so the rates cannot drift apart.
 * An overview-present row whose flag disagrees is a persistence bug, and a
 * rate derived from it would publish data known to be wrong: it throws.
 */
export function countObservations(rows: readonly AioObservationRow[]): AioObservationCounts {
  const counts = {
    successful: 0,
    with_overview: 0,
    brand_mentioned: 0,
    owned_citation: 0,
    excluded: 0,
  };
  for (const [outcome, aioPresent, namedBrand, citedOwned] of rows) {
    if (!SUCCESSFUL.has(outcome)) {
      counts.excluded += 1;
      continue;
    }
    counts.successful += 1;
    if (outcome !== OVERVIEW_PRESENT) continue;
    if (aioPresent !== true) {
      throw new Error(
        `${OVERVIEW_PRESENT} observation has aio_present=${aioPresent === null ? 'None' : 'False'}`,
      );
    }
    counts.with_overview += 1;
    if (namedBrand) counts.brand_mentioned += 1;
    if (citedOwned) counts.owned_citation += 1;
  }
  return counts;
}

/** How often an overview appears at all: a property of the queries, not the brand. */
export function triggerRate(counts: AioObservationCounts): AioRate {
  return rate(counts.with_overview, counts.successful, DENOMINATOR_SUCCESSFUL_OBSERVATIONS);
}

/** Of the overviews shown, how many named the brand (conditional). */
export function brandMentionRateWhenPresent(counts: AioObservationCounts): AioRate {
  return rate(counts.brand_mentioned, counts.with_overview, DENOMINATOR_OBSERVATIONS_WITH_AIO);
}

/** Of every successful observation, how many named the brand (unconditional). */
export function overallBrandVisibility(counts: AioObservationCounts): AioRate {
  return rate(counts.brand_mentioned, counts.successful, DENOMINATOR_SUCCESSFUL_OBSERVATIONS);
}

/** Of the overviews shown, how many cited an owned domain (conditional). */
export function ownedCitationRateWhenPresent(counts: AioObservationCounts): AioRate {
  return rate(counts.owned_citation, counts.with_overview, DENOMINATOR_OBSERVATIONS_WITH_AIO);
}

/** One competitor over the overviews shown, comparable with the brand's rate. */
export function competitorMentionRate(counts: AioObservationCounts, mentions: number): AioRate {
  return rate(mentions, counts.with_overview, DENOMINATOR_OBSERVATIONS_WITH_AIO);
}
