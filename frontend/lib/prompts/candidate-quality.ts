import type { PromptCandidate } from '@/lib/api/types';

export function qualityStatusLabel(candidate: PromptCandidate): string {
  switch (candidate.quality_status) {
    case 'judged':
      return candidate.quality_flags.length ? 'Needs your review' : 'Quality checked';
    case 'off':
      return 'Quality checking was off for this batch';
    case 'unavailable':
      return 'Quality check unavailable — review carefully';
    case 'not_judged':
      return 'Not quality checked';
  }
}

/**
 * Review copy for the quality judge's flags on a generated candidate.
 * Flags are signals about the question asked, never a score for the business;
 * an unknown flag code falls back to a generic prompt to double-check.
 */
const QUALITY_FLAG_COPY: Record<string, string> = {
  decision_value: 'May be too generic to guide a buying decision',
  fits_business: 'May not fit your business',
  buyer_relevant: 'May not be a real buyer question',
  natural: 'May read unnaturally',
  standalone: 'May need missing context',
  sensible: 'May not make sense',
  duplicate_of: 'May repeat another prompt',
  incomplete: 'Not fully checked',
};

export function qualityFlagLabel(flag: string): string {
  return QUALITY_FLAG_COPY[flag] ?? 'Worth a second look';
}
