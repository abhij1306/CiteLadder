import { fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { brandInitials } from '@/lib/brand/initials';

import { BrandLogo } from './brand-logo';

describe('BrandLogo', () => {
  it('derives stable one- and two-word initials', () => {
    expect(brandInitials('Acme')).toBe('AC');
    expect(brandInitials('Acme Corporation')).toBe('AC');
    expect(brandInitials('')).toBe('?');
    // Discovery hands back the long form in tow, and it is not part of the name.
    expect(brandInitials('EY (Ernst & Young)')).toBe('EY');
    expect(brandInitials('PwC (PricewaterhouseCoopers)')).toBe('PW');
    expect(brandInitials('(((')).toBe('?');
    // One code point, not half a surrogate pair.
    expect(brandInitials('\u{1D54F} Corp')).toBe('\u{1D54F}C');
  });

  it('renders the cached logo URL and falls back after an image error', () => {
    const { container } = render(
      <BrandLogo name="Acme Corporation" logoUrl="/api/v1/projects/acme/logo" />,
    );
    const image = container.querySelector('img');
    expect(image?.getAttribute('src')).toMatch(/\/api\/v1\/projects\/acme\/logo$/);

    fireEvent.error(image!);

    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent('AC');
  });

  it('renders initials immediately when no cache entry exists', () => {
    const { container } = render(<BrandLogo name="Globex" logoUrl={null} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent('GL');
  });

  describe('with a Logo.dev token configured', () => {
    // The module reads the token at import time, so set it before importing.
    async function renderWithToken(ui: (mod: typeof import('./brand-logo')) => React.ReactElement) {
      process.env.NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE = 'pk_test';
      vi.resetModules();
      const mod = await import('./brand-logo');
      const result = render(ui(mod));
      return result;
    }

    afterEach(() => {
      delete process.env.NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE;
      vi.resetModules();
    });

    it('falls back to the CDN when the cached asset fails, then to initials', async () => {
      const { container } = await renderWithToken(({ BrandLogo: Logo }) => (
        <Logo
          name="Acme Corporation"
          logoUrl="/api/v1/projects/acme/logo"
          websiteUrl="https://www.acme.com/store"
        />
      ));

      // 1. our own cached asset first — no third-party request for a working logo
      const cached = container.querySelector('img');
      expect(cached?.getAttribute('src')).toMatch(/\/api\/v1\/projects\/acme\/logo$/);

      fireEvent.error(cached!);

      // 2. Logo.dev, keyed by the site's host, asking for a 404 (not a monogram)
      const remote = container.querySelector('img');
      const src = remote?.getAttribute('src') ?? '';
      expect(src).toContain('https://img.logo.dev/www.acme.com?');
      expect(src).toContain('fallback=404');

      fireEvent.error(remote!);

      // 3. our own initials
      expect(container.querySelector('img')).toBeNull();
      expect(container).toHaveTextContent('AC');
    });

    it('uses the CDN directly when there is no cached asset', async () => {
      const { container } = await renderWithToken(({ BrandLogo: Logo }) => (
        <Logo name="Acme" logoUrl={null} websiteUrl="https://www.acme-outdoor.example" />
      ));
      expect(container.querySelector('img')?.getAttribute('src')).toContain(
        'https://img.logo.dev/www.acme-outdoor.example?',
      );
    });

    it('shows initials when the website URL cannot yield a domain', async () => {
      const { container } = await renderWithToken(({ BrandLogo: Logo }) => (
        <Logo name="No Site" logoUrl={null} websiteUrl="not a url" />
      ));
      expect(container.querySelector('img')).toBeNull();
      expect(container).toHaveTextContent('NS');
    });
  });
});
