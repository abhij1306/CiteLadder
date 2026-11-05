'use client';

import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

import { cn } from '@/lib/utils';

type TriggerProps = {
  onClick?: () => void;
  'aria-expanded'?: boolean;
  'aria-haspopup'?: 'dialog';
  'aria-controls'?: string;
};

/**
 * Popover — a small non-modal panel anchored to a button, for content that
 * needs more than a tooltip: a filter with Apply, a metric's definition with a
 * link. `surface`, `radius-lg`, `shadow-pop`, 16px padding and 12px between
 * blocks, 320px wide, 8px from the trigger. The trigger toggles it; Escape and
 * a press outside close it. It is not modal: focus stays where the person
 * puts it.
 */
export function Popover({
  trigger,
  title,
  label,
  children,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  side = 'bottom',
  align = 'start',
}: Readonly<{
  /** A Button or IconButton; it gets the toggle and `aria-expanded`. */
  trigger: ReactElement<TriggerProps>;
  /** The bold first line, and the panel's accessible name. */
  title?: string;
  /** The accessible name when there is no title. */
  label?: string;
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: 'bottom' | 'top';
  align?: 'start' | 'end';
}>) {
  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const open = controlledOpen ?? ownOpen;
  const root = useRef<HTMLSpanElement>(null);
  const id = useId();

  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setOwnOpen(next);
    onOpenChange?.(next);
  };
  const setOpenRef = useRef(setOpen);
  useEffect(() => {
    setOpenRef.current = setOpen;
  });

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        setOpenRef.current(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenRef.current(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const anchor = isValidElement(trigger)
    ? cloneElement(trigger, {
        onClick: () => {
          trigger.props.onClick?.();
          setOpen(!open);
        },
        'aria-expanded': open,
        'aria-haspopup': 'dialog',
        'aria-controls': open ? id : undefined,
      })
    : trigger;

  return (
    <span ref={root} className="relative inline-flex">
      {anchor}
      {open ? (
        // A non-modal <dialog open>: no focus trap and no top layer, so the
        // page stays usable around it.
        <dialog
          open
          id={id}
          aria-label={title ?? label}
          className={cn(
            'menu-panel bg-surface text-ink shadow-pop z-modal absolute m-0 flex w-80 flex-col gap-3 rounded-lg border-0 p-4 text-body-sm',
            side === 'top'
              ? 'top-auto bottom-[calc(100%+8px)]'
              : 'top-[calc(100%+8px)] bottom-auto',
            align === 'end' ? 'right-0 left-auto' : 'right-auto left-0',
          )}
        >
          {title ? <p className="text-body-sm text-ink font-medium">{title}</p> : null}
          {children}
        </dialog>
      ) : null}
    </span>
  );
}
