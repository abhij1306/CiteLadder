/**
 * Search Demand detector descriptions (frontend config owner).
 *
 * Each detector's rule, in the words its info hint shows. The thresholds
 * restate the API's demand policy (`services/api/src/config/demand.json`),
 * which the detectors read; change the two together. `tab` is the signal
 * filter that lists the detector's signals, where its status is shown.
 */
import type { FilterTab } from '@/lib/demand/signals';

export const DEMAND_DETECTORS: readonly {
  key: string;
  tab: FilterTab;
  label: string;
  rule: string;
}[] = [
  {
    key: 'striking_distance',
    tab: 'striking_distance',
    label: 'Striking distance',
    rule: 'Non-branded queries averaging position 4–15 with at least 50 impressions.',
  },
  {
    key: 'cannibalization',
    tab: 'cannibalization',
    label: 'Cannibalization',
    rule: 'Non-branded queries where two or more of your pages each earn at least 20 impressions and 10% of the query’s impressions.',
  },
  {
    key: 'property_relative_ctr_gap',
    tab: 'ctr_gap',
    label: 'CTR gap',
    rule: 'Queries with at least 100 impressions whose CTR is at least 25%, and 2 points, below the median at their position. A position needs 20 queries and 500 impressions to set that median.',
  },
  {
    key: 'query_trends',
    tab: 'trends',
    label: 'Trends',
    rule: 'Queries whose impressions grew 1.5× or more, or fell to 0.67× or less, between the last two 14-day windows. Needs 28 days of continuous Search Console coverage.',
  },
];
