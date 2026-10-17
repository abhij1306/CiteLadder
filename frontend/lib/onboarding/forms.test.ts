import { describe, expect, it } from 'vite-plus/test';

import { ApiError } from '@/lib/api/errors';

import {
  brandStepSchema,
  deriveDomain,
  normalizeWebsiteUrl,
  onboardingErrorMessage,
  type BrandStepValues,
} from './forms';

const brand: BrandStepValues = {
  brand_name: '  Acme  ',
  website_url: 'acme.com',
  primary_market: 'US',
  language_code: 'en',
  industry: 'Analytics',
  subindustry: '',
};

describe('normalizeWebsiteUrl', () => {
  it('adds a scheme to a bare host', () => {
    expect(normalizeWebsiteUrl('acme.com')).toBe('https://acme.com');
  });

  it('leaves an explicit scheme alone, including http', () => {
    expect(normalizeWebsiteUrl('https://acme.com')).toBe('https://acme.com');
    expect(normalizeWebsiteUrl('http://acme.com')).toBe('http://acme.com');
  });

  it('is empty for empty input rather than producing "https://"', () => {
    expect(normalizeWebsiteUrl('   ')).toBe('');
  });
});

describe('deriveDomain', () => {
  it('strips scheme, www and path', () => {
    expect(deriveDomain('https://www.acme.com/pricing')).toBe('acme.com');
    expect(deriveDomain('acme.co.uk')).toBe('acme.co.uk');
  });

  it('returns empty for input that cannot parse', () => {
    expect(deriveDomain('')).toBe('');
    expect(deriveDomain('   ')).toBe('');
    expect(deriveDomain('ftp://acme.com')).toBe('');
  });
});

describe('brandStepSchema', () => {
  it('accepts a bare host and a full URL', () => {
    expect(brandStepSchema.safeParse({ ...brand, website_url: 'acme.com' }).success).toBe(true);
    expect(brandStepSchema.safeParse({ ...brand, website_url: 'https://acme.com' }).success).toBe(
      true,
    );
  });

  it('rejects a website with no dot', () => {
    expect(brandStepSchema.safeParse({ ...brand, website_url: 'acme' }).success).toBe(false);
  });

  it('rejects non-HTTP website schemes', () => {
    expect(brandStepSchema.safeParse({ ...brand, website_url: 'ftp://acme.com' }).success).toBe(
      false,
    );
    expect(brandStepSchema.safeParse({ ...brand, website_url: 'file://acme.com' }).success).toBe(
      false,
    );
  });

  it('requires a brand name', () => {
    expect(brandStepSchema.safeParse({ ...brand, brand_name: '   ' }).success).toBe(false);
  });
});

describe('onboardingErrorMessage', () => {
  it('does not expose technical backend detail', () => {
    expect(
      onboardingErrorMessage(
        new Error('At least 3 evidence-supported topics are required, but 0 were found'),
      ),
    ).toBe('We couldn’t finish this setup step just now. Please try again.');
  });

  it('falls back for non-errors', () => {
    expect(onboardingErrorMessage(null)).toMatch(/finish this setup step/i);
  });

  it('treats a client timeout as still working, not as a failure', () => {
    // Requests are bounded at 30s; the work behind them is not. Telling the
    // user their setup failed while the server was still creating the project
    // is what made them click Create a second time.
    const timeout = new ApiError('Request timed out', 0, '', undefined, {
      code: 'request_timeout',
      retryable: true,
    });
    expect(onboardingErrorMessage(timeout)).toMatch(/still working/i);
    expect(onboardingErrorMessage(timeout)).not.toMatch(/couldn’t finish/i);
  });
});
