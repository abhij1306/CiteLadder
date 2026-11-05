import { fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { brandInitials } from '@/lib/brand/initials';

import { BrandMark } from './brand-mark';

describe('BrandMark', () => {
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

  it('renders the cached logo URL and falls back to the first letter after an image error', () => {
    const { container } = render(
      <BrandMark name="Acme Corporation" logoUrl="/api/v1/projects/acme/logo" />,
    );
    const image = container.querySelector('img');
    expect(image?.getAttribute('src')).toMatch(/\/api\/v1\/projects\/acme\/logo$/);

    fireEvent.error(image!);

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('A');
  });

  it('renders the letter immediately when no cache entry exists', () => {
    const { container } = render(<BrandMark name="Globex" logoUrl={null} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('G');
  });

  it('keeps a whole code point as the letter', () => {
    const { container } = render(<BrandMark name={'\u{1D54F} Corp'} />);
    expect(container.textContent).toBe('\u{1D54F}');
  });

  describe('with a Logo.dev token configured', () => {
    // The module reads the token at import time, so set it before importing.
    async function renderWithToken(ui: (mod: typeof import('./brand-mark')) => React.ReactElement) {
      process.env.NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE = 'pk_test';
      vi.resetModules();
      const mod = await import('./brand-mark');
      return render(ui(mod));
    }

    afterEach(() => {
      delete process.env.NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE;
      vi.resetModules();
    });

    it('falls back to the CDN when the cached asset fails, then to the letter', async () => {
      const { container } = await renderWithToken(({ BrandMark: Mark }) => (
        <Mark
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

      // 3. the first letter
      expect(container.querySelector('img')).toBeNull();
      expect(container.textContent).toBe('A');
    });

    it('uses the CDN directly when there is no cached asset', async () => {
      const { container } = await renderWithToken(({ BrandMark: Mark }) => (
        <Mark name="Acme" logoUrl={null} websiteUrl="https://www.acme-outdoor.example" />
      ));
      expect(container.querySelector('img')?.getAttribute('src')).toContain(
        'https://img.logo.dev/www.acme-outdoor.example?',
      );
    });

    it('shows the letter when the website URL cannot yield a domain', async () => {
      const { container } = await renderWithToken(({ BrandMark: Mark }) => (
        <Mark name="No Site" logoUrl={null} websiteUrl="not a url" />
      ));
      expect(container.querySelector('img')).toBeNull();
      expect(container.textContent).toBe('N');
    });
  });
});
