/** Visibility presentation choices; calculations stay in the analysis domain. */
export const VISIBILITY_METRICS = [
  { value: 'brand_mention_rate', label: 'Visibility' },
  { value: 'sov', label: 'Share of voice' },
  { value: 'owned_citation_rate', label: 'Owned citation rate' },
] as const;

export const ANSWER_OUTCOMES = [
  { value: 'all', label: 'All answers' },
  { value: 'brand_absent', label: 'Brand absent' },
  { value: 'uncited', label: 'Brand mentioned without owned citation' },
] as const;
