'use client';

import { ArrowDown, ArrowUp, Maximize2, Minimize2, X } from 'lucide-react';
import type { ReactNode } from 'react';

import type { OverviewWidget } from '@citeladder/contracts/overview';
import { IconButton } from '@/components/ui/button';
import { FloatingToolbar } from '@/components/ui/floating-toolbar';
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
    <FloatingToolbar>
      <IconButton
        icon={ArrowUp}
        label={`Move ${title} earlier`}
        disabled={pending || first}
        onClick={() => onMove(index - 1)}
      />
      <IconButton
        icon={ArrowDown}
        label={`Move ${title} later`}
        disabled={pending || last}
        onClick={() => onMove(index + 1)}
      />
      <IconButton
        icon={wide ? Minimize2 : Maximize2}
        label={wide ? `Make ${title} half width` : `Make ${title} full width`}
        disabled={pending}
        onClick={onResize}
      />
      <IconButton
        icon={X}
        label={`Remove ${title}`}
        disabled={pending || only}
        onClick={onRemove}
      />
    </FloatingToolbar>
  );
}
