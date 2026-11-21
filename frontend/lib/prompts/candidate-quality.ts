import type { PromptCandidate } from '@citeladder/contracts';

export function qualityStatusLabel(candidate: PromptCandidate): string | null {
  switch (candidate.quality_status) {
    case 'judged':
      return candidate.quality_flags.length ? 'Needs your review' : null;
    case 'off':
      return 'Quality checking was off for this batch';
    case 'unavailable':
      return 'Quality check unavailable. Review carefully.';
    case 'not_judged':
      return 'Not quality checked';
  }
}

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
