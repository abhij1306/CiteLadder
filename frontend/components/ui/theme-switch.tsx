'use client';

import { Moon, Sun } from 'lucide-react';

import { IconButton } from '@/components/ui/button';
import { setThemePreference, useTheme } from '@/lib/theme/theme';

/**
 * ThemeSwitch — one ghost IconButton that flips light and dark. A visitor
 * starts on the device's theme (the shared preference's unshown `system`
 * default, lib/theme/theme.ts); a click stores the opposite of what the page
 * shows in the one cookie the app, website and docs share. The icon is the
 * theme a click turns on.
 */
export function ThemeSwitch({
  tooltipSide = 'bottom',
}: Readonly<{ tooltipSide?: 'top' | 'right' | 'bottom' | 'left' }>) {
  const next = useTheme() === 'dark' ? 'light' : 'dark';
  return (
    <IconButton
      icon={next === 'dark' ? Moon : Sun}
      label={next === 'dark' ? 'Switch to dark theme' : 'Switch to light theme'}
      tooltipSide={tooltipSide}
      onClick={() => setThemePreference(next)}
    />
  );
}
