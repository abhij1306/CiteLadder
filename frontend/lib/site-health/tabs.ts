export const SITE_HEALTH_TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'pages', label: 'Pages' },
  { value: 'architecture', label: 'Architecture' },
  { value: 'aeo-readiness', label: 'AEO readiness' },
  { value: 'internal-links', label: 'Internal links' },
  { value: 'changes', label: 'Changes' },
] as const;

export type SiteHealthTab = (typeof SITE_HEALTH_TABS)[number]['value'];
