'use client';

import { ArrowDown, ArrowUp, Maximize2, Minimize2, X } from 'lucide-react';
import type { ReactNode } from 'react';

import type { OverviewWidget } from '@citeladder/contracts/overview';
import { Button } from '@/components/ui/button';
import { splitPaneClasses } from '@/components/ui/workspace';
import { moveWidget, removeWidget, toggleWidth, WIDGET_TITLES } from '@/lib/overview/layout';
import { cn } from '@/lib/utils';

/**
 * The Overview's two-column grid. Half widgets share a row and its height;
 * full widgets span it. While editing, each widget carries its controls in an
 * overlay, so entering or leaving edit mode never moves a widget.
 */
export function OverviewGrid({
  widgets,
  editing,
  pending,
  onChange,
  render,
}: Readonly<{
  widgets: readonly OverviewWidget[];
  editing: boolean;
  pending: boolean;
  onChange: (widgets: OverviewWidget[]) => void;
  render: (widget: OverviewWidget) => ReactNode;
}>) {
  return (
    <div className={splitPaneClasses('peers', 'desktop:items-stretch')}>
      {widgets.map((widget, index) => (
        // The widget's own card names its region; this cell only places it.
        <div
          key={widget.key}
          data-widget={widget.key}
          className={cn('relative min-w-0', widget.size === 'full' && 'desktop:col-span-2')}
        >
          {render(widget)}
          {editing ? (
            <WidgetControls
              widget={widget}
              first={index === 0}
              last={index === widgets.length - 1}
              only={widgets.length === 1}
              pending={pending}
              onMove={(to) => onChange(moveWidget(widgets, index, to))}
              onResize={() => onChange(toggleWidth(widgets, index))}
              onRemove={() => onChange(removeWidget(widgets, index))}
              index={index}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function WidgetControls({
  widget,
  index,
  first,
  last,
  only,
  pending,
  onMove,
  onResize,
  onRemove,
}: Readonly<{
  widget: OverviewWidget;
  index: number;
  first: boolean;
  last: boolean;
  only: boolean;
  pending: boolean;
  onMove: (to: number) => void;
  onResize: () => void;
  onRemove: () => void;
}>) {
  const title = WIDGET_TITLES[widget.key];
  const wide = widget.size === 'full';
  return (
    // A floating cluster of 32px icon controls, not a box: it lifts off the
    // widget like a menu and hugs the controls with a 4px inset.
    <div className="bg-elevated shadow-overlay absolute end-3 top-3 z-10 flex gap-1 rounded-[var(--radius-card)] p-1">
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Move ${title} earlier`}
        disabled={pending || first}
        onClick={() => onMove(index - 1)}
      >
        <ArrowUp className="size-3.5" aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Move ${title} later`}
        disabled={pending || last}
        onClick={() => onMove(index + 1)}
      >
        <ArrowDown className="size-3.5" aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={wide ? `Make ${title} half width` : `Make ${title} full width`}
        disabled={pending}
        onClick={onResize}
      >
        {wide ? (
          <Minimize2 className="size-3.5" aria-hidden />
        ) : (
          <Maximize2 className="size-3.5" aria-hidden />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Remove ${title}`}
        disabled={pending || only}
        onClick={onRemove}
      >
        <X className="size-3.5" aria-hidden />
      </Button>
    </div>
  );
}
