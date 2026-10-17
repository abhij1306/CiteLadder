import type { CompetitorCandidate } from '@citeladder/contracts/commerce-suite';

import type { StatusValue } from '@/components/ui/badge-variants';

/**
 * Discovery status as a sentence, not a status string dropped into one.
 * Interpolating the raw value produced "Discovery for this category is
 * succeeded", and `unavailable` read as success to anyone skimming.
 */
const FAILURES: Record<string, (kind: string) => string> = {
  unusable_target: (kind) => `This ${kind} needs a clearer name before competitors can be found.`,
  provider_unavailable: () =>
    'Competitor discovery is unavailable: no search provider is configured.',
  provider_failed: () => 'The search provider did not respond. Try again later.',
  commerce_target_unavailable: (kind) => `This ${kind} is no longer in the catalog.`,
};

export function discoveryMessage(status: string, kind: string, errorCode: string): string {
  if (status === 'succeeded') return `Discovery finished for this ${kind}.`;
  if (status === 'cancelled') return `Discovery was cancelled for this ${kind}.`;
  if (status === 'failed')
    return FAILURES[errorCode]?.(kind) ?? `Discovery failed for this ${kind}. Try again later.`;
  return `Finding competitors for this ${kind}…`;
}

/** The candidate's domain — what a person recognises as "who is this?". */
export function competitorHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const COMPETITOR_STATES: Record<
  CompetitorCandidate['state'],
  { tone: StatusValue; label: string }
> = {
  approved: { tone: 'success', label: 'Approved' },
  rejected: { tone: 'danger', label: 'Rejected' },
  excluded: { tone: 'danger', label: 'Excluded' },
  pending: { tone: 'info', label: 'Needs review' },
};

export function competitorState(state: CompetitorCandidate['state']) {
  return COMPETITOR_STATES[state];
}
