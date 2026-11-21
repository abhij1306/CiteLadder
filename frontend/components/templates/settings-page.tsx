import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { PageFrame, type PageFrameSlots } from './page-frame';

export function SettingsPage({
  children,
  rail,
  wide = false,
  ...slots
}: Omit<PageFrameSlots, 'filters' | 'trail' | 'crumb' | 'tabs'> &
  Readonly<{
    rail?: ReactNode;
    wide?: boolean;
    children: ReactNode;
  }>) {
  const sections = (
    <div data-settings-sections="" className="min-w-0">
      {children}
    </div>
  );
  return (
    <PageFrame {...slots}>
      {rail ? (
        <RailColumns rail={rail} wide={wide}>
          {sections}
        </RailColumns>
      ) : (
        sections
      )}
    </PageFrame>
  );
}

export function RailColumns({
  rail,
  wide = false,
  children,
}: Readonly<{ rail: ReactNode; wide?: boolean; children: ReactNode }>) {
  return (
    <div
      data-section-rail=""
      className="desktop:flex-row flex min-w-0 flex-col gap-[var(--page-top-gap)]"
    >
      <div className="desktop:sticky desktop:top-[calc(var(--masthead-block-size,var(--masthead-height))+var(--page-pad-block))] desktop:w-48 desktop:self-start shrink-0">
        {rail}
      </div>
      <div className={cn('min-w-0 flex-1', !wide && 'max-w-[var(--container-prose)]')}>
        {children}
      </div>
    </div>
  );
}
