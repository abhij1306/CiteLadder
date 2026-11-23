import type { ReactNode } from 'react';

import { PageFrame, type PageFrameSlots } from './page-frame';

export function SettingsPage({
  children,
  rail,
  ...slots
}: Omit<PageFrameSlots, 'filters' | 'trail' | 'crumb' | 'tabs'> &
  Readonly<{
    rail?: ReactNode;
    children: ReactNode;
  }>) {
  const sections = (
    <div data-settings-sections="" className="min-w-0">
      {children}
    </div>
  );
  return (
    <PageFrame {...slots}>
      {rail ? <RailColumns rail={rail}>{sections}</RailColumns> : sections}
    </PageFrame>
  );
}

export function RailColumns({
  rail,
  children,
}: Readonly<{ rail: ReactNode; children: ReactNode }>) {
  return (
    <div
      data-section-rail=""
      className="desktop:flex-row flex min-w-0 flex-col gap-[var(--page-top-gap)]"
    >
      <div className="desktop:sticky desktop:top-[calc(var(--masthead-block-size,var(--masthead-height))+var(--page-pad-block))] desktop:w-48 desktop:self-start shrink-0">
        {rail}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
