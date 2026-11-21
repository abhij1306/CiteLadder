import { absent, type Absent } from '@/lib/format';

export function noObservations(state: string | null | undefined): Absent | null {
  return state === 'no_observations' ? absent() : null;
}

export const DOMAIN_TYPES: readonly { token: string; label: string }[] = [
  { token: 'brand_owned', label: 'You' },
  { token: 'competitor_owned', label: 'Competitor' },
  { token: 'review_marketplace', label: 'Reviews' },
  { token: 'editorial_third_party', label: 'Editorial' },
  { token: 'institutional', label: 'Institutional' },
  { token: 'community', label: 'UGC' },
  { token: 'social', label: 'Social' },
  { token: 'video', label: 'Video' },
  { token: 'other_third_party', label: 'Other' },
] as const;

const DOMAIN_TYPE_LABELS = new Map(DOMAIN_TYPES.map((type) => [type.token, type.label]));

export function domainTypeLabel(token: string | null | undefined): string | null {
  return (token && DOMAIN_TYPE_LABELS.get(token)) || null;
}

export const URL_TYPES: readonly { token: string; label: string }[] = [
  { token: 'comparison', label: 'Comparison' },
  { token: 'alternative', label: 'Alternative' },
  { token: 'listicle', label: 'Listicle' },
  { token: 'review', label: 'Review' },
  { token: 'how_to', label: 'How-To Guide' },
  { token: 'article', label: 'Article' },
  { token: 'discussion', label: 'Discussion' },
  { token: 'profile', label: 'Profile' },
  { token: 'directory', label: 'Directory' },
  { token: 'product', label: 'Product Page' },
  { token: 'category', label: 'Category Page' },
  { token: 'homepage', label: 'Homepage' },
  { token: 'reference', label: 'Reference' },
  { token: 'video', label: 'Video' },
  { token: 'unresolved', label: 'Other' },
] as const;

const URL_TYPE_LABELS = new Map(URL_TYPES.map((type) => [type.token, type.label]));

export function urlTypeLabel(token: string | null | undefined): string | null {
  return (token && URL_TYPE_LABELS.get(token)) || null;
}

export function pageFormatBasis(method: string | null | undefined): string | null {
  if (method === 'structured_data') return 'From the page’s own structured data';
  if (method === 'heading_evidence') return 'From the page’s headings';
  if (method === 'url_pattern') return 'From the page’s address';
  return null;
}
