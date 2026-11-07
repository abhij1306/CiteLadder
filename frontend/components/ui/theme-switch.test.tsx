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

  it('follows the device until clicked, then flips light and dark in the shared cookie', async () => {
    const user = userEvent.setup();
    render(<ThemeSwitch />);

    // No stored choice: the device's (light) theme shows and nothing is saved.
    expect(themeCookie()).toBeUndefined();
    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(themeCookie()).toBe('dark');

    await user.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(themeCookie()).toBe('light');
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
