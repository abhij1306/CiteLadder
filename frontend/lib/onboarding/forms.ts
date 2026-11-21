/**
 * Onboarding form contract.
 *
 * Onboarding replaces `/setup` entirely, so this
 * module owns what `lib/setup/forms.ts` used to: validating the create-a-project
 * input in the browser and mapping it to `ProjectInput`.
 *
 * It is deliberately much smaller than the setup schema was. Setup collected
 * aliases, owned domains, unintended domains, competitors, benchmark mode and
 * repetition defaults by hand across five steps. Onboarding *discovers* most of
 * that, so the only thing the user types is the brand and its site; everything
 * else arrives as an editable suggestion.
 */
import { z } from 'zod';

import { humanizeApiError } from '@/lib/api/errors';

export type ReviewCompetitor = {
  id: string;
  name: string;
  aliases: string[];
  domains: string[];
  selected: boolean;
};

export type ReviewDomain = {
  id: string;
  domain: string;
  selected: boolean;
};

export const brandStepSchema = z.object({
  brand_name: z.string().trim().min(1, 'Enter your brand name').max(255, 'Brand name is too long'),
  website_url: z
    .string()
    .trim()
    .min(1, 'Enter your website')
    .max(1024, 'Website is too long')
    .refine((value) => {
      try {
        const url = new URL(value.includes('://') ? value : `https://${value}`);
        return (
          (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.includes('.')
        );
      } catch {
        return false;
      }
    }, 'Enter a valid website'),
  primary_market: z
    .string()
    .trim()
    .refine((value) => value === 'GLOBAL' || value.length === 2, 'Pick a primary market'),
  language_code: z.string().trim().min(2, 'Pick a language'),
  industry: z.string().trim().min(1, 'Pick an industry').max(255, 'Industry is too long'),
  subindustry: z.string().trim().max(255, 'Subindustry is too long'),
});

export type BrandStepValues = z.infer<typeof brandStepSchema>;

export const emptyBrandStep: BrandStepValues = {
  brand_name: '',
  website_url: '',
  primary_market: 'US',
  language_code: 'en',
  industry: 'General',
  subindustry: '',
};

export function normalizeWebsiteUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.includes('://') ? trimmed : `https://${trimmed}`;
}

export function onboardingErrorMessage(error: unknown): string {
  const { status, code } = humanizeApiError(error);
  if (status === 403) {
    return 'The server refused to create the project. If you reach CiteLadder by a host name other than localhost, add it to ALLOWED_HOSTS.';
  }
  if (status === 422) {
    return 'Check the website and required details, then try again.';
  }
  if (code === 'request_timeout') {
    return 'This is taking longer than usual. We’re still working on it and checking again…';
  }
  return 'We couldn’t finish this setup step just now. Please try again.';
}
