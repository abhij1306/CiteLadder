/** Perception's tabs in row order. Data only: the route manifest loads it in Node. */
export const PERCEPTION_TABS = [
  { value: 'brand', label: 'Brand' },
  { value: 'market', label: 'Market' },
  { value: 'objections', label: 'Objections' },
  { value: 'fact-checking', label: 'Fact-checking' },
] as const;

export const PUBLIC_PERCEPTION_TABS = PERCEPTION_TABS.filter(
  (item) => item.value !== 'fact-checking',
);

export type PerceptionTab = (typeof PERCEPTION_TABS)[number]['value'];
