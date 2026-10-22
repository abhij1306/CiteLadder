'use client';

import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { splitPaneClasses, stickyPaneClasses } from '@/components/ui/workspace';
import { usePaneResizeInteraction } from '@/lib/use-pane-resize-interaction';
import { cn } from '@/lib/utils';

/**
 * ResizableSplitPane — the `list-detail` split with a list the reader sizes.
 *
 * The one resizable-pane recipe:
 *
 *   - `role="separator"`, focusable, `aria-orientation="vertical"`,
 *     `aria-valuenow/min/max` in pixels and `aria-controls` → the list.
 *   - Keys: ← / → move 16px (Shift: 48px), Home → minimum, End → maximum.
 *     Double-click restores the default. Pointer drag with capture; a
 *     cancelled pointer restores the width the drag started from.
 *   - The rule is a hairline that strengthens on hover and takes the focus
 *     colour while focused or dragging.
 *   - Below `lg` the panes stack and the separator is not rendered.
 *
 * The width is uncontrolled by default. A route that remembers it controls it:
 * `width` plus `onWidthCommit` (store the settled width) — Commerce stores it
 * per browser. Mid-drag the pane follows its own width, so only the pane
 * re-renders per pointer move and the route sees the settled width alone.
 */

export function ResizableSplitPane({
  list,
  children,
  listId,
  separatorLabel,
  defaultWidth,
  minWidth,
  maxWidth,
  minDetailWidth = 0,
  width: controlledWidth,
  onWidthCommit,
  stickyList = false,
  className,
}: Readonly<{
  /** The selectable list (left). */
  list: ReactNode;
  /** The selection's detail (right). */
  children: ReactNode;
  /** `id` of the list's container, for the separator's `aria-controls`. */
  listId: string;
  /** The separator's accessible name, e.g. "Resize the catalog pane". */
  separatorLabel: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  /** The detail never shrinks below this; the list's maximum yields first. */
  minDetailWidth?: number;
  /** Controlled width in px. */
  width?: number;
  /** The width a drag or key press settled on — the one worth storing. */
  onWidthCommit?: (width: number) => void;
  /** Keep the list in view while the detail scrolls. */
  stickyList?: boolean;
  className?: string;
}>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const helpId = useId();
  const [ownWidth, setOwnWidth] = useState(defaultWidth);
  const [effectiveMax, setEffectiveMax] = useState(maxWidth);
  const bounds = () => {
    const available = containerRef.current?.getBoundingClientRect().width ?? 0;
    const responsiveMax = available ? available - minDetailWidth : maxWidth;
    return { min: minWidth, max: Math.max(minWidth, Math.min(maxWidth, responsiveMax)) };
  };

  // A controlled width is the stored decision; the container may still be too
  // narrow for it, so it is shown clamped to the current maximum.
  const settledWidth = Math.min(effectiveMax, controlledWidth ?? ownWidth);
  const resize = usePaneResizeInteraction({
    width: settledWidth,
    bounds,
    onResize: setOwnWidth,
    onCommit: (next) => onWidthCommit?.(next),
    defaultWidth,
    onBoundsChange: ({ max }) => setEffectiveMax(max),
  });
  // Mid-drag the pane follows its own width; the owner hears the settled one.
  const width = resize.dragging ? ownWidth : settledWidth;

  // Re-clamp when the container narrows, so the detail keeps its minimum. A
  // resize that moves neither the clamped width nor the maximum is a no-op, so
  // the observer never echoes the current width back through `onResize`.
  const refreshOnResize = useEffectEvent(() => {
    const { min, max } = bounds();
    const clamped = Math.min(max, Math.max(min, width));
    if (clamped === width && max === effectiveMax) return;
    resize.refreshBounds();
  });
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => refreshOnResize());
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ '--split-pane-list-width': `${width}px` } as CSSProperties}
      className={splitPaneClasses(
        'list-detail-resizable',
        cn(resize.dragging && 'cursor-col-resize select-none', className),
      )}
    >
      <div id={listId} className={cn('min-w-0', stickyList && stickyPaneClasses)}>
        {list}
      </div>
      <div // NOSONAR -- a focusable WAI-ARIA window splitter: pointer and arrow-key handlers resize it
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Native hr cannot expose a value or take keyboard focus for resizing.
        role="separator"
        tabIndex={0} // NOSONAR -- a focusable separator is interactive per the WAI-ARIA window splitter pattern
        aria-orientation="vertical"
        aria-label={separatorLabel}
        aria-controls={listId}
        aria-valuemin={minWidth}
        aria-valuemax={effectiveMax}
        aria-valuenow={width}
        aria-describedby={helpId}
        title="Drag to resize. Double-click to reset."
        data-dragging={resize.dragging || undefined}
        onPointerDown={resize.onPointerDown}
        onPointerMove={resize.onPointerMove}
        onPointerUp={resize.onPointerUp}
        onPointerCancel={resize.onPointerCancel}
        onLostPointerCapture={resize.onLostPointerCapture}
        onDoubleClick={resize.onDoubleClick}
        onKeyDown={resize.onKeyDown}
        className="focus-ring group desktop:flex hidden w-4 cursor-col-resize touch-none justify-center self-stretch rounded-xs py-2"
      >
        <span
          aria-hidden
          className="bg-border group-hover:bg-border-strong group-focus-visible:bg-accent group-data-[dragging]:bg-accent w-px transition-colors motion-reduce:transition-none"
        />
        <span id={helpId} className="sr-only">
          Use the left and right arrow keys to resize. Hold Shift for larger steps.
        </span>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
