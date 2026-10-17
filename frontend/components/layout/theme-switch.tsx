'use client';

import { Moon, Sun } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipProvider } from '@/components/ui/tooltip';
import { setTheme, useTheme } from '@/lib/theme/theme';

/**
 * One click flips the app between light and dark for this device. It carries
 * its own tooltip provider because onboarding renders it outside the shell.
 */
export function ThemeSwitch() {
  const theme = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  const label = `Switch to ${next} theme`;
  const Icon = theme === 'dark' ? Sun : Moon;
  return (
    <TooltipProvider>
      <Tooltip content={label} side="bottom">
        <Button variant="ghost" size="iconRound" aria-label={label} onClick={() => setTheme(next)}>
          <Icon className="size-4" aria-hidden />
        </Button>
      </Tooltip>
    </TooltipProvider>
  );
}
