import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { BRAND_LOGO_SIZES, LogoMark } from './logo-mark';

describe('LogoMark', () => {
  it('sizes the lockup from the variant ladder and keeps the asset aspect ratio', () => {
    const { container } = render(<LogoMark variant="compact" />);

    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('height')).toBe(String(BRAND_LOGO_SIZES.compact));
    expect(svg?.getAttribute('width')).toBe('106');
  });

  it('lets an explicit size override the variant', () => {
    const { container } = render(<LogoMark size={40} />);

    expect(container.querySelector('svg')?.getAttribute('height')).toBe('40');
  });

  it('draws the square mark alone when the wordmark is off', () => {
    const { container } = render(<LogoMark variant="mini" wordmark={false} />);

    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 98 100');
    expect(svg?.getAttribute('width')).toBe(String(BRAND_LOGO_SIZES.mini));
  });

  it('is hidden from assistive technology unless it is named', () => {
    const { rerender } = render(<LogoMark />);
    expect(screen.queryByRole('img')).toBeNull();

    rerender(<LogoMark alt="CiteLadder" />);
    expect(screen.getByRole('img', { name: 'CiteLadder' })).toBeInTheDocument();
  });
});
