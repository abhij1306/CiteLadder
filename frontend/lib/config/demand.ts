/**
 * Search Demand detector descriptions (frontend config owner).
 *
 * Each detector's rule, in the words its info hint shows. The thresholds are
 * the API's demand policy, sent with the snapshot (`detector_policy`), so a
 * retuned threshold changes the sentence with the detector. `tab` is the
 * signal filter that lists the detector's signals, where its status is shown;
 * a filter listing several detectors' signals shows their combined status.
 */
import type { DemandDetector, DemandDetectorPolicy } from '@citeladder/contracts';
import { formatCount, formatPercent } from '@/lib/format';
import type { FilterTab } from '@/lib/demand/signals';

/** A CTR gap in percentage points (0.02 is 2 points). */
const points = (fraction: number) => `${Math.round(fraction * 100)} points`;

export const DEMAND_DETECTORS: readonly {
  key: DemandDetector;
  tab: FilterTab;
  label: string;
  rule: (policy: DemandDetectorPolicy) => string;
}[] = [
  {
    key: 'striking_distance',
    tab: 'striking_distance',
    label: 'Striking distance',
    rule: ({ striking_distance: p }) =>
      `Non-branded queries averaging position ${p.min_position}–${p.max_position} with at least ${formatCount(p.min_impressions)} impressions.`,
  },
  {
    key: 'cannibalization',
    tab: 'cannibalization',
    label: 'Cannibalization',
    rule: ({ cannibalization: p }) =>
      `Non-branded queries where two or more of your pages each earn at least ${formatCount(p.min_page_impressions)} impressions and ${formatPercent(p.min_page_share)} of the query’s impressions.`,
  },
  {
    key: 'property_relative_ctr_gap',
    tab: 'ctr_gap',
    label: 'CTR gap',
    rule: ({ ctr_gap: p }) =>
      `Queries with at least ${formatCount(p.min_candidate_impressions)} impressions whose CTR is at least ${formatPercent(p.relative_threshold)}, and ${points(p.absolute_threshold)}, below the median at their position. A position needs ${formatCount(p.min_cohort_rows)} queries and ${formatCount(p.min_cohort_impressions)} impressions to set that median.`,
  },
  {
    key: 'high_impression_low_ctr',
    tab: 'ctr_gap',
    label: 'Low CTR',
    rule: ({ low_ctr: p }) =>
      `Non-branded queries and pages with at least ${formatCount(p.min_impressions)} impressions and a CTR of ${formatPercent(p.ctr_threshold)} or less; the ${formatCount(p.max_signals)} with the most impressions are listed.`,
  },
  {
    key: 'query_trends',
    tab: 'trends',
    label: 'Trends',
    rule: ({ trends: p }) =>
      `Queries whose impressions grew ${p.emerging_ratio}× or more, or fell to ${p.declining_ratio}× or less, between the last two ${p.window_days}-day windows. Needs ${p.required_days} days of continuous Search Console coverage.`,
  },
];
