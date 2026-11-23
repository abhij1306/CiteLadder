import type { ReactNode } from 'react';

import { POP_FACE } from '@/components/ui/slip';
import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

export function SelectionDock({
  label,
  summary,
  children,
}: Readonly<{
  label: string;
  summary: string | null;
  children: ReactNode;
}>) {
  return (
    <DockLayer>
      {summary === null ? null : (
        <DockBar label={label} slidesIn>
          <span className={textRole('body', 'px-2 whitespace-nowrap tabular-nums')}>{summary}</span>
          {children}
        </DockBar>
      )}
    </DockLayer>
  );
}

export const DOCK_SLOT = {
  decision: 'min-w-28',
  wide: 'rail:w-44',
  primary: 'min-w-0 shrink rail:w-64',
  primaryLabel: 'min-w-0 truncate',
} as const;

export function PageDock({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <DockLayer>
      <DockBar label={label}>{children}</DockBar>
    </DockLayer>
  );
}

function DockLayer({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="pointer-events-none sticky bottom-5 z-10 h-0">{children}</div>;
}

function DockBar({
  label,
  slidesIn,
  children,
}: Readonly<{ label: string; slidesIn?: boolean; children: ReactNode }>) {
  return (
    <div
      role="toolbar"
      aria-label={label}
      data-selection-dock={slidesIn ? '' : undefined}
      className={cn(
        POP_FACE,
        'pointer-events-auto absolute bottom-0 left-1/2 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-1 p-2',
      )}
    >
      {children}
    </div>
  );
}
