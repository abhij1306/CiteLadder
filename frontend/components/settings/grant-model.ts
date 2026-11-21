import { BarChart3, Globe, Search, type IconGlyph } from '@/lib/icons';
import type { IntegrationConnection, IntegrationProvider } from '@/lib/api/integrations';

export type GrantFamily = 'google' | 'microsoft';

export type GrantModel = {
  grantId: string;
  family: GrantFamily;
  status: IntegrationConnection['grant_status'];
  scopes: string[];
  connections: [IntegrationConnection, ...IntegrationConnection[]];
};

export const GRANT_FAMILY: Record<IntegrationProvider, GrantFamily> = {
  gsc: 'google',
  ga4: 'google',
  bing: 'microsoft',
};

export const PROVIDER_META: Record<
  IntegrationProvider,
  { label: string; noun: string; console: string; Icon: IconGlyph }
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

export function isGrantGone(status: IntegrationConnection['grant_status']): boolean {
  return status === 'revoked' || status === 'pending_revocation';
}

export const FAMILY_META: Record<
  GrantFamily,
  {
    title: string;
    connectProvider: IntegrationProvider;
  }
> = {
  google: {
    title: 'Google',
    connectProvider: 'gsc',
  },
  microsoft: {
    title: 'Bing',
    connectProvider: 'bing',
  },
};
