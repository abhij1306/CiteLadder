import { useId, useState, type CSSProperties, type ReactNode } from 'react';

import { IconButton } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { SidebarResizeHandle } from '@/components/ui/sidebar-resize-handle';
import { Menu } from '@/lib/icons';
import { useSidebarCollapsed, useSidebarWidth } from '@/lib/sidebar-width';

const FRAME =
  'bg-ground text-ink grid h-dvh overflow-hidden grid-cols-[minmax(0,1fr)] rail:grid-cols-[var(--sidebar-width-compact)_minmax(0,1fr)] shell:grid-cols-[var(--sidebar-width)_minmax(0,1fr)] data-[sidebar-state=collapsed]:rail:grid-cols-[var(--sidebar-rail-width)_minmax(0,1fr)] transition-[grid-template-columns] duration-[var(--motion-open)] ease-[var(--ease-resize)] motion-reduce:transition-none has-[[data-dragging]]:transition-none';
const SIDEBAR_COLUMN = 'rail:block z-sticky relative hidden min-h-0 min-w-0';
const PANEL =
  '@container/main bg-panel rail:ms-0 rail:rounded-card rail:ring-1 ring-rule m-[var(--panel-inset)] flex min-h-0 min-w-0 flex-col overflow-y-auto overscroll-contain px-[var(--page-pad-inline)]';
const PAGE = 'flex w-full min-w-0 flex-1 flex-col';

function useFrameState(): { style: CSSProperties | undefined; state: 'collapsed' | 'expanded' } {
  const width = useSidebarWidth();
  const collapsed = useSidebarCollapsed();
  const style =
    width === null
      ? undefined
      : ({
          '--sidebar-width': `${width}px`,
          '--sidebar-width-compact': `${width}px`,
        } as CSSProperties);
  return { style, state: collapsed ? 'collapsed' : 'expanded' };
}

export function AppShellFrame({
  sidebar,
  children,
}: Readonly<{ sidebar: ReactNode; children: ReactNode }>) {
  const sidebarId = useId();
  const { style, state } = useFrameState();
  const [shownState, setShownState] = useState(state);
  const [toggled, setToggled] = useState(false);
  if (shownState !== state) {
    setShownState(state);
    setToggled(true);
  }
  return (
    <div
      data-app-surface=""
      data-sidebar-state={state}
      data-sidebar-toggled={toggled || undefined}
      className={FRAME}
      style={style}
    >
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <aside id={sidebarId} aria-label="Sidebar" className={SIDEBAR_COLUMN}>
        {sidebar}
        {state === 'expanded' ? <SidebarResizeHandle sidebarId={sidebarId} /> : null}
      </aside>
      <main id="main" tabIndex={-1} data-main-column="" className={PANEL}>
        <div className={PAGE}>{children}</div>
      </main>
    </div>
  );
}

export function AppShellPlaceholder({
  busy,
  sidebar,
  children,
}: Readonly<{ busy: boolean; sidebar: ReactNode; children: ReactNode }>) {
  const { style, state } = useFrameState();
  return (
    <div
      data-app-surface=""
      data-sidebar-state={state}
      className={FRAME}
      style={style}
      aria-busy={busy || undefined}
    >
      <div className={SIDEBAR_COLUMN} inert>
        {sidebar}
      </div>
      <main id="main" tabIndex={-1} data-main-column="" className={PANEL}>
        <div className={PAGE}>{children}</div>
      </main>
    </div>
  );
}

export function NavMenuButton({
  expanded,
  onOpen,
}: Readonly<{ expanded: boolean; onOpen: () => void }>) {
  return (
    <IconButton
      icon={Menu}
      label="Open navigation"
      aria-haspopup="dialog"
      aria-expanded={expanded}
      onClick={onOpen}
      className="rail:hidden shrink-0"
    />
  );
}

export function NavDrawer({
  open,
  onOpenChange,
  children,
}: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }>) {
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      side="left"
      title="Navigation"
      hideHeader
      body="dock"
      closeLabel="Close navigation"
    >
      <div data-nav-drawer="" className="bg-chrome flex min-h-0 flex-1 flex-col">
        {children}
      </div>
    </Drawer>
  );
}
