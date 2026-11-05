import type { ReactNode } from 'react';

import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

/**
 * The top-bar rule and fill: a layer behind the header as wide as the main
 * column (its size container plus both gutters), so content scrolling under
 * the bar never shows beside it and the rule meets the sidebar's.
 */
const BAR_LAYER =
  'before:bg-paper before:border-line before:absolute before:inset-y-0 before:left-1/2 before:-z-10 before:w-[calc(100cqw+2*var(--content-gutter))] before:-translate-x-1/2 before:border-b';

/**
 * PageHeader — the top of every app page and its half of the app's sticky
 * top bar (decision D12): the page name in `display-sm` (24/32, decision
 * D11) and the page's actions on the right (secondary first, then the one
 * primary), on one `row-app` row with space-2 above and below and a 1px
 * `line` rule under it, level with the sidebar's project switcher. A detail
 * page leads the title with its way back.
 *
 * Only where the actions cannot fit beside the title (a phone) do they take
 * a second row. The title stays one line: a long name truncates, the full
 * name in its tooltip.
 */
export function PageHeader({
  title,
  lead,
  actions,
}: Readonly<{
  title: string;
  /** Before the title: a detail page's back button. */
  lead?: ReactNode;
  actions?: ReactNode;
}>) {
  return (
    <header
      data-page-header=""
      data-page-band="identity"
      className={cn(
        BAR_LAYER,
        'sticky top-0 z-20 isolate flex min-h-[var(--page-header-band)] min-w-0 flex-wrap items-center justify-between gap-x-[var(--card-padding)] gap-y-2 py-2',
      )}
    >
      <div className="flex min-h-[var(--row-app)] min-w-[min(100%,12rem)] flex-1 items-center gap-3">
        {lead}
        <h1 className={textRole('pageTitle', 'min-w-0 truncate')} title={title}>
          {title}
        </h1>
      </div>
      {actions ? (
        <div className="ms-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
