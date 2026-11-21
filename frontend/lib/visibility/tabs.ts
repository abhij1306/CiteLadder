export const VISIBILITY_TABS = [
  { id: 'domains', label: 'Domains' },
  { id: 'urls', label: 'URLs' },
  { id: 'read-not-cited', label: 'Read, not cited' },
  { id: 'query-fanout', label: 'Query fanouts' },
  { id: 'ads', label: 'Ads' },
] as const;

export type VisibilityTab = (typeof VISIBILITY_TABS)[number]['id'];
