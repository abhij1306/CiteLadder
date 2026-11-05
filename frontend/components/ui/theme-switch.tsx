'use client';

import { useRef, type KeyboardEvent } from 'react';
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { Tooltip } from '@/components/ui/tooltip';
import { setThemePreference, useThemePreference, type ThemePreference } from '@/lib/theme/theme';
import { cn } from '@/lib/utils';

const THEMES: readonly { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

/**
 * ThemeSwitch — light, dark or system, on Tabs' track: `surface-sunken`,
 * `radius-md`, 28px with a 2px inset; square icon segments, the selected one
 * `surface` with the xs ring and an `ink` icon. A `radiogroup` of three
 * radios named Light, Dark and System; arrow keys move and apply. The choice
 * is the shared preference (lib/theme/theme.ts): one cookie for the app,
 * website and docs, `system` following the device live.
 */
export function ThemeSwitch({
  tooltipSide = 'bottom',
}: Readonly<{ tooltipSide?: 'top' | 'right' | 'bottom' | 'left' }>) {
  const preference = useThemePreference();
  const buttons = useRef<Partial<Record<ThemePreference, HTMLButtonElement | null>>>({});

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const index = THEMES.findIndex((theme) => theme.value === preference);
    const step = event.key === 'ArrowRight' ? 1 : THEMES.length - 1;
    const next = THEMES[(index + step) % THEMES.length];
    if (!next) return;
    setThemePreference(next.value);
    buttons.current[next.value]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      data-theme-switch=""
      // The group is a focus target only by script; the tab stop is the checked option.
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="bg-surface-sunken inline-flex h-[var(--control-sm)] shrink-0 items-center gap-0.5 rounded-md p-0.5"
    >
      {THEMES.map((theme) => {
        const selected = theme.value === preference;
        return (
          <Tooltip key={theme.value} content={theme.label} side={tooltipSide} describe={false}>
            <button
              ref={(node) => {
                buttons.current[theme.value] = node;
              }}
              type="button"
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- A button-based radio keeps roving focus and the segment face.
              role="radio"
              aria-checked={selected}
              aria-label={theme.label}
              tabIndex={selected ? 0 : -1}
              onClick={() => setThemePreference(theme.value)}
              className={cn(
                'focus-ring grid aspect-square h-full place-items-center rounded-xs transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none',
                selected ? 'bg-surface text-ink shadow-xs' : 'text-ink-secondary hover:text-ink',
              )}
            >
              <Icon icon={theme.icon} className="my-0" />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
