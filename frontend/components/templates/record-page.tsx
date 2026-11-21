import type { ReactNode } from 'react';

import { PageFrame, PageSections, type PageFrameSlots } from './page-frame';

const BAR_CLEARANCE = 'calc(var(--filter-bar-height) + 2 * var(--content-gutter))';

export function RecordPage({
  busy,
  identity,
  aside,
  actionBar,
  children,
  ...slots
}: PageFrameSlots &
  Readonly<{
    busy?: boolean;
    identity?: ReactNode;
    aside?: ReactNode;
    actionBar?: ReactNode;
    children: ReactNode;
  }>) {
  const hasBar = Boolean(actionBar);
  return (
    <PageFrame {...slots}>
      <div
        aria-busy={busy}
        className="flex min-w-0 flex-1 flex-col"
        style={hasBar ? { paddingBottom: BAR_CLEARANCE } : undefined}
      >
        <PageSections>
          {identity}
          {aside ? (
            <div className="column-split:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] grid min-w-0 items-start gap-[var(--workspace-gap)]">
              <PageSections>{children}</PageSections>
              <aside
                data-rhythm-gap="workspace"
                className="flex min-w-0 flex-col gap-[var(--workspace-gap)]"
              >
                {aside}
              </aside>
            </div>
          ) : (
            children
          )}
        </PageSections>
      </div>
      {actionBar ? (
        <div
          data-page-band="action-bar"
          className="bg-raised border-rule rounded-card shadow-pop z-sticky sticky bottom-[var(--content-gutter)] mt-[var(--workspace-gap)] flex min-h-[var(--filter-bar-height)] min-w-0 flex-nowrap items-center justify-end gap-2 border px-[var(--card-padding)] py-2"
        >
          {actionBar}
        </div>
      ) : null}
    </PageFrame>
  );
}
