/**
 * Readable names for the fields Website Changes compares, keyed by the field
 * the change comparison persists (`services/api/src/config/site-health/change-intel.ts`)
 * and the keys of a content-change record. A key without a name here reads in
 * sentence case, so a new field never prints as a raw key.
 */
const CHANGE_FIELD_LABELS: Readonly<Record<string, string>> = {
  title: 'Title',
  meta_description: 'Meta description',
  h1: 'H1',
  canonical: 'Canonical URL',
  robots_noindex: 'Noindex',
  json_ld_present: 'Structured data',
  internal_link_count: 'Internal links',
  http_status: 'HTTP status',
  redirect_target: 'Redirect target',
  content_change: 'Page content',
  url_presence: 'Page presence',
};

/** `meta_description` → "Meta description"; an unknown `some_key` → "Some key". */
export function changeFieldLabel(field: string): string {
  const known = CHANGE_FIELD_LABELS[field];
  if (known) return known;
  const words = field.replaceAll('_', ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
