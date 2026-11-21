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

export function changeFieldLabel(field: string): string {
  const known = CHANGE_FIELD_LABELS[field];
  if (known) return known;
  const words = field.replaceAll('_', ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
