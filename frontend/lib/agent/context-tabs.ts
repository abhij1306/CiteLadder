export const CONTEXT_TABS = [
  { value: 'facts', label: 'Company' },
  { value: 'themes', label: 'Themes' },
  { value: 'map', label: 'Business map' },
  { value: 'competitors', label: 'Competitors' },
  { value: 'instructions', label: 'Instructions' },
  { value: 'brand-facts', label: 'Brand facts' },
] as const;

export type ContextTab = (typeof CONTEXT_TABS)[number]['value'];
