'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

type Bounds = { min: number; max: number };

const KEY_STEP = 16;
const KEY_STEP_LARGE = 48;

/**
 * Pointer and keyboard mechanics for `ResizableSplitPane`'s separator.
 *
 * Keys: ← / → move 16px (Shift: 48px), Home → minimum, End → maximum.
 * Double-click restores the default. A cancelled pointer restores the width
 * the drag started from.
 */
export function usePaneResizeInteraction({
  width,
  bounds,
  onResize,
  onCommit,
  defaultWidth,
  onBoundsChange,
}: {
  width: number;
  bounds: () => Bounds;
  onResize: (width: number) => void;
  onCommit: (width: number) => void;
  defaultWidth: number;
  onBoundsChange?: (bounds: Bounds) => void;
}) {
  const widthRef = useRef(width);
  useEffect(() => {
    widthRef.current = width;
  }, [width]);
  const dragRef = useRef<{ pointerId?: number; startX: number; startWidth: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const apply = (next: number) => {
    const limits = bounds();
    onBoundsChange?.(limits);
    const clamped = Math.min(limits.max, Math.max(limits.min, Math.round(next)));
    widthRef.current = clamped;
    onResize(clamped);
    return clamped;
  };

  const restoreDocument = () => {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  useEffect(() => restoreDocument, []);

  const beginDrag = (clientX: number, pointerId?: number) => {
    dragRef.current = { pointerId, startX: clientX, startWidth: widthRef.current };
    // The drag starts from the width on screen, whoever owned it until now.
    onResize(widthRef.current);
    setDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };
  const dragTo = (clientX: number, pointerId?: number) => {
    const drag = dragRef.current;
    if (!drag || (pointerId !== undefined && drag.pointerId !== pointerId)) return;
    apply(drag.startWidth + clientX - drag.startX);
  };
  const endDrag = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    onCommit(widthRef.current);
    restoreDocument();
  };
  const cancelDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    widthRef.current = drag.startWidth;
    onResize(drag.startWidth);
    setDragging(false);
    restoreDocument();
  };
  const commitAt = (next: number) => onCommit(apply(next));

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || dragRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    beginDrag(event.clientX, event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) =>
    dragTo(event.clientX, event.pointerId);
  const finishPointer = (event: PointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    const handle = event.currentTarget;
    endDrag();
    if (handle.hasPointerCapture?.(event.pointerId))
      handle.releasePointerCapture?.(event.pointerId);
  };
  const cancelPointer = (event: PointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    const handle = event.currentTarget;
    cancelDrag();
    if (handle.hasPointerCapture?.(event.pointerId))
      handle.releasePointerCapture?.(event.pointerId);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    if (event.key === 'ArrowLeft') commitAt(widthRef.current - step);
    else if (event.key === 'ArrowRight') commitAt(widthRef.current + step);
    else if (event.key === 'Home') commitAt(bounds().min);
    else if (event.key === 'End') commitAt(bounds().max);
    else return;
    event.preventDefault();
  };

  return {
    dragging,
    /** Re-clamp the current width to fresh bounds (the container resized). */
    refreshBounds: () => apply(widthRef.current),
    onPointerDown,
    onPointerMove,
    onPointerUp: finishPointer,
    onPointerCancel: cancelPointer,
    onLostPointerCapture: (event: PointerEvent<HTMLElement>) => {
      if (dragRef.current?.pointerId === event.pointerId) cancelDrag();
    },
    onDoubleClick: () => commitAt(defaultWidth),
    onKeyDown,
  };
}
