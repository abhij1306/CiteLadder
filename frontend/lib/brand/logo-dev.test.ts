import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { logoDomain } from './logo-dev';

describe('logoDomain', () => {
  it('accepts bare hosts and full URLs alike', () => {
    expect(logoDomain('acme.com')).toBe('acme.com');
    expect(logoDomain('https://www.acme.com/store?x=1')).toBe('www.acme.com');
    expect(logoDomain('HTTP://Acme.COM')).toBe('acme.com');
    expect(logoDomain('acme.com.')).toBe('acme.com');
  });

  it('rejects anything that is not a usable public domain', () => {
    for (const value of ['', '   ', 'localhost', 'not a url', 'ftp://acme.com', null, undefined]) {
      expect(logoDomain(value)).toBeNull();
    }
  });

  it('rejects credentialed URLs', () => {
    expect(logoDomain('https://user:pw@acme.com')).toBeNull();
  });
});

describe('logoDevUrl', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE;
    vi.resetModules();
  });

  async function load() {
    vi.resetModules();
    return import('./logo-dev');
  }

  it('is disabled when no token is configured', async () => {
    delete process.env.NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE;
    const { logoDevUrl } = await load();
    expect(logoDevUrl('https://acme.com', 24)).toBeNull();
  });

  it('builds a 404-fallback CDN URL at 2x the rendered size', async () => {
    process.env.NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE = 'pk_test';
    const { logoDevUrl } = await load();
    const url = new URL(logoDevUrl('https://www.acme.com', 24)!);

    expect(url.origin).toBe('https://img.logo.dev');
    expect(url.pathname).toBe('/www.acme.com');
    expect(url.searchParams.get('token')).toBe('pk_test');
    expect(url.searchParams.get('size')).toBe('48');
    // A monogram at 200 OK would mask the failure and beat our own initials.
    expect(url.searchParams.get('fallback')).toBe('404');
  });

  it('clamps the size to the CDN maximum', async () => {
    process.env.NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE = 'pk_test';
    const { logoDevUrl } = await load();
    const url = new URL(logoDevUrl('acme.com', 600)!);
    expect(url.searchParams.get('size')).toBe('800');
  });
});
