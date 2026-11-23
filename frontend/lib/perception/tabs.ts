export const PERCEPTION_TABS = [
  { value: 'brand', label: 'Brand' },
  { value: 'fact-checking', label: 'Fact-checking' },
] as const;

export const PUBLIC_PERCEPTION_TABS = PERCEPTION_TABS.filter(
  (item) => item.value !== 'fact-checking',
);

export type PerceptionTab = (typeof PERCEPTION_TABS)[number]['value'];
