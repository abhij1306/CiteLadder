import type { ComponentPropsWithoutRef, Ref } from 'react';

import { cn } from '@/lib/utils';

const textareaClasses =
  'focus-input min-h-[var(--textarea-min-height)] w-full resize-y rounded-[var(--radius-control)] border border-border bg-input p-3 text-field text-foreground transition-[border-color,background-color] placeholder:text-muted enabled:hover:border-border-strong aria-invalid:border-danger aria-invalid:enabled:hover:border-danger disabled:cursor-not-allowed disabled:bg-disabled disabled:text-muted disabled:border-border-subtle';

/** Composer emphasis uses a stronger boundary, with no resting elevation. */
const raisedClasses = 'border border-border-strong enabled:hover:border-border-strong';

/**
 * Inside a `ComposerFrame` the frame is the box: the field keeps its focus
 * edge but drops its fill, resize handle and resting height, and takes the
 * frame's tighter inset so its text lines up with the chips above it.
 */
const composerClasses =
  'min-h-0 resize-none bg-transparent px-2 py-1 shadow-none hover:shadow-none';

export function Textarea({
  className,
  raised = false,
  placement = 'field',
  ref,
  ...props
}: Readonly<
  ComponentPropsWithoutRef<'textarea'> & {
    /** The composer treatment — for a field that is the point of its screen. */
    raised?: boolean;
    /** `composer`: the message field inside a `ComposerFrame`. */
    placement?: 'field' | 'composer';
    ref?: Ref<HTMLTextAreaElement>;
  }
>) {
  return (
    <textarea
      ref={ref}
      className={cn(
        textareaClasses,
        raised && raisedClasses,
        placement === 'composer' && composerClasses,
        className,
      )}
      {...props}
    />
  );
}
