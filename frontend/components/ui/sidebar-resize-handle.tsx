import { useId, useState } from 'react';

import {
  SIDEBAR_DEFAULT_WIDTH,
  sidebarWidthBounds,
  useSidebarWidthControl,
} from '@/lib/sidebar-width';
import { usePaneResizeInteraction } from '@/lib/use-pane-resize-interaction';

function currentBounds() {
  return sidebarWidthBounds(typeof window === 'undefined' ? 0 : window.innerWidth);
}

/**
 * The sidebar's inner edge, where the reader sizes it (from `shell:` only; the
 * rail and the drawer keep their widths). A WAI-ARIA window splitter: drag it,
 * or focus it and use ← / → (16px, Shift 48px); Home and a double-click
 * restore the default, which is also the minimum; End takes the maximum
 * (480px, never more than 40% of the window). At rest the sidebar's own rule
 * shows; the handle's hairline strengthens it on hover and takes the focus
 * colour while focused or dragging. The
 * shared interaction stops text selection mid-drag.
 */
export function SidebarResizeHandle({ sidebarId }: Readonly<{ sidebarId: string }>) {
  const helpId = useId();
  const { width, preview, commit } = useSidebarWidthControl();
  const [max, setMax] = useState(() => currentBounds().max);
  const resize = usePaneResizeInteraction({
    width,
    bounds: currentBounds,
    onResize: preview,
    onCommit: commit,
    defaultWidth: SIDEBAR_DEFAULT_WIDTH,
    onBoundsChange: (bounds) => setMax(bounds.max),
  });
  return (
    <div // NOSONAR -- a focusable WAI-ARIA window splitter: pointer and arrow-key handlers resize it
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Native hr cannot expose a value or take keyboard focus for resizing.
      role="separator"
      tabIndex={0} // NOSONAR -- a focusable separator is interactive per the WAI-ARIA window splitter pattern
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-controls={sidebarId}
      aria-valuemin={SIDEBAR_DEFAULT_WIDTH}
      aria-valuemax={max}
      aria-valuenow={width}
      aria-describedby={helpId}
      data-dragging={resize.dragging || undefined}
      onPointerDown={resize.onPointerDown}
      onPointerMove={resize.onPointerMove}
      onPointerUp={resize.onPointerUp}
      onPointerCancel={resize.onPointerCancel}
      onLostPointerCapture={resize.onLostPointerCapture}
      onDoubleClick={resize.onDoubleClick}
      onKeyDown={resize.onKeyDown}
      className="focus-ring group shell:flex absolute inset-y-0 end-0 hidden w-2 translate-x-1/2 cursor-col-resize touch-none justify-center"
    >
      <span
        aria-hidden
        className="group-hover:bg-line-strong group-focus-visible:bg-ink group-data-[dragging]:bg-ink w-px bg-transparent transition-colors motion-reduce:transition-none"
      />
      <span id={helpId} className="sr-only">
        Use the left and right arrow keys to resize. Hold Shift for larger steps. Home or a
        double-click restores the default width.
      </span>
    </div>
  );
}
