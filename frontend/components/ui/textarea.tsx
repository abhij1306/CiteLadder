import type { ComponentPropsWithoutRef, Ref } from 'react';

import { FIELD_EDGE } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Textarea — the multi-line field. It looks like Input: `surface` with the
 * soft xs ring, `radius-md`, 8/12px padding, 14/20 text, at least two
 * control heights tall, resizing vertically only. Focus and error come from
 * the shared `.focus-input` rule.
 */
const textareaClasses =
  'text-ink placeholder:text-ink-muted block w-full rounded-md border text-body-sm disabled:cursor-not-allowed disabled:opacity-45';

const fieldClasses = cn(
  'focus-input min-h-[calc(var(--control-md)*2)] resize-y px-3 py-2 transition-[border-color,box-shadow] duration-[var(--motion-fast)]',
  FIELD_EDGE,
);

/**
 * Inside the Agent composer the composer is the box and draws the one focus
 * boundary (its `focus-frame`): the field drops its edge, fill, resize
 * handle, resting height and focus treatment.
 */
const composerClasses = 'min-h-0 resize-none border-transparent bg-transparent px-2 py-1';

export function Textarea({
  className,
  placement = 'field',
  rows = 4,
  ref,
  ...props
}: Readonly<
  ComponentPropsWithoutRef<'textarea'> & {
    /** `composer`: the message field inside the Agent composer. */
    placement?: 'field' | 'composer';
    ref?: Ref<HTMLTextAreaElement>;
  }
>) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        textareaClasses,
        placement === 'composer' ? composerClasses : fieldClasses,
        className,
      )}
      {...props}
    />
  );
}
