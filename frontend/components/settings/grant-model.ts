import { BarChart3, Globe, Search, type LucideIcon } from 'lucide-react';

import type { IntegrationConnection, IntegrationProvider } from '@/lib/api/integrations';

/**
 * The OAuth-grant presentation model shared by the Integrations panel and the
 * per-grant card.
 *
 * A data module rather than constants inside `integration-card.tsx`: the panel
 * groups the flat connection list with `GRANT_FAMILY` before any card renders,
 * and a component file that also exports plain values costs Fast Refresh the
 * ability to preserve state on edit.
 */

/** OAuth grant family — gsc/ga4 share ONE Google grant; bing rides a Microsoft grant. */
export type GrantFamily = 'google' | 'microsoft';

/** Presentation model for one OAuth grant (connections grouped by `grant_id`). */
export type GrantModel = {
  grantId: string;
  family: GrantFamily;
  status: IntegrationConnection['grant_status'];
  scopes: string[];
  /** A grant exists only through its connections, so there is always one. */
  connections: [IntegrationConnection, ...IntegrationConnection[]];
};

export const GRANT_FAMILY: Record<IntegrationProvider, GrantFamily> = {
  gsc: 'google',
  ga4: 'google',
  bing: 'microsoft',
};

/** Per-provider presentation, shared by Settings and the in-place setup. */
export const PROVIDER_META: Record<
  IntegrationProvider,
  { label: string; noun: string; console: string; Icon: LucideIcon }
> = {
  gsc: {
    label: 'Google Search Console',
    noun: 'Search Console property',
    console: 'Search Console',
    Icon: Search,
  },
  ga4: {
    label: 'Google Analytics 4',
    noun: 'Analytics property',
    console: 'Google Analytics',
    Icon: BarChart3,
  },
  bing: {
    label: 'Bing Webmaster Tools',
    noun: 'Bing site',
    console: 'Bing Webmaster Tools',
    Icon: Globe,
  },
};

export function isIntegrationProvider(value: string | null): value is IntegrationProvider {
  return value !== null && Object.hasOwn(PROVIDER_META, value);
}

export function joinProviderLabels(providers: readonly IntegrationProvider[]): string {
  return providers.map((provider) => PROVIDER_META[provider].label).join(' and ');
}

/** A disconnected grant: it can only be connected again, not reconnected. */
export function isGrantGone(status: IntegrationConnection['grant_status']): boolean {
  return status === 'revoked' || status === 'pending_revocation';
}

export const FAMILY_META: Record<
  GrantFamily,
  { title: string; connectProvider: IntegrationProvider; blurb: string }
> = {
  google: {
    title: 'Google',
    connectProvider: 'gsc',
    blurb:
      'One consent links Search Console and Analytics 4 on a shared grant. Signed in with Google? The account is pre-selected.',
  },
  // Titled for the product the user is actually connecting, not the identity
  // provider behind it: a Google grant cannot authorize Bing, and saying
  // "Microsoft" invites the assumption that it can.
  microsoft: {
    title: 'Bing',
    connectProvider: 'bing',
    blurb:
      'Bing Webmaster Tools needs its own consent — a Google grant cannot authorize it. The Bing account itself can still be one created with a Google ID.',
  },
};
