/**
 * Display helpers for ads in AI answers. Values are projected from the read,
 * never recomputed; a missing value stays `null` so the component draws the
 * shared missing mark rather than a zero.
 */
import type {
  AdApplicability,
  AdOwnership,
  AdPresence,
  VisibilityAdsResponse,
} from '@citeladder/contracts/visibility-ads';

import type { ClassificationValue } from '@/components/ui/badge-variants';
import { availabilityLabel } from '@/lib/format';
import { parseAbsoluteHttpUrl } from '@/lib/safe-http-url';

export const ADS_COVERAGE_NOTE =
  "Ads seen in ChatGPT sessions collected for this project's market. What your buyers see depends on their plan, account and country.";

export const AD_OWNERSHIP: Record<AdOwnership, { label: string; badge: ClassificationValue }> = {
  owned: { label: 'You', badge: 'owned' },
  competitor: { label: 'Competitor', badge: 'competitor' },
  other: { label: 'Other', badge: 'third-party' },
};

export const AD_APPLICABILITY: Record<AdApplicability, string> = {
  applicable: 'Ads read',
  unavailable: 'Ads unavailable',
  not_applicable: availabilityLabel('not_applicable'),
};

/** "N of M ChatGPT Search answers showed an ad". */
export function presenceLine(presence: AdPresence): string {
  return `${presence.answers_with_ads} of ${presence.answers} ChatGPT Search answers showed an ad`;
}

/** The landing page as host and path; the query string never reaches the read. */
export function landingLabel(url: string): string {
  const parsed = parseAbsoluteHttpUrl(url);
  if (!parsed) return url;
  const path = parsed.pathname === '/' ? '' : parsed.pathname;
  return `${parsed.host}${path}`;
}

/** The heading and sentence for a read that has no ads to show. */
export function adsStateCopy(state: Exclude<VisibilityAdsResponse['state'], 'value'> | 'no_runs'): {
  heading: string;
  description: string;
} {
  switch (state) {
    case 'not_applicable':
      return {
        heading: AD_APPLICABILITY.not_applicable,
        description:
          'Only ChatGPT Search shows ads. Choose ChatGPT Search or all surfaces to see them.',
      };
    case 'unavailable':
      return {
        heading: AD_APPLICABILITY.unavailable,
        description:
          'These ChatGPT Search answers were collected before ads were read. Ads appear from the next audit.',
      };
    case 'no_runs':
      return {
        heading: 'No runs in this period',
        description: 'Choose a period that includes a completed run to see ads.',
      };
    case 'no_answers':
      return {
        heading: 'No ChatGPT Search answers',
        description: 'Ads are read from ChatGPT Search answers. Add ChatGPT Search to an audit.',
      };
  }
}
