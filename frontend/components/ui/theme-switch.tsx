import { IconButton } from '@/components/ui/button';
import { Moon, Sun } from '@/lib/icons';
import { setThemePreference, useTheme } from '@/lib/theme/theme';

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
