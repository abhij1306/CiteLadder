import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import { themeCookieDomain } from '@/lib/theme/theme';

import { ThemeSwitch } from './theme-switch';

function themeCookie(): string | undefined {
  return document.cookie
    .split('; ')
    .find((part) => part.startsWith('citeladder_theme='))
    ?.slice('citeladder_theme='.length);
}

describe('ThemeSwitch', () => {
  afterEach(() => {
    document.cookie = 'citeladder_theme=; Max-Age=0; Path=/';
    delete document.documentElement.dataset.theme;
  });

  it('starts on System and remembers an explicit pick in the shared cookie', async () => {
    const user = userEvent.setup();
    render(<ThemeSwitch />);

    expect(screen.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');

    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(themeCookie()).toBe('dark');
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');

    await user.click(screen.getByRole('radio', { name: 'System' }));
    expect(themeCookie()).toBeUndefined();
  });

  it('moves and applies the choice with the arrow keys from one tab stop', async () => {
    const user = userEvent.setup();
    render(<ThemeSwitch />);

    await user.tab();
    expect(screen.getByRole('radio', { name: 'System' })).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveFocus();
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(themeCookie()).toBe('light');

    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'System' })).toHaveFocus();
  });
});

describe('themeCookieDomain', () => {
  it('shares the choice across the app, docs and website hosts', () => {
    expect(themeCookieDomain('app.citeladder.com')).toBe('citeladder.com');
    expect(themeCookieDomain('docs.citeladder.com')).toBe('citeladder.com');
    expect(themeCookieDomain('citeladder.com')).toBe('citeladder.com');
  });

  it('keeps the cookie host-only where a Domain attribute is rejected', () => {
    expect(themeCookieDomain('localhost')).toBeNull();
    expect(themeCookieDomain('127.0.0.1')).toBeNull();
  });
});
