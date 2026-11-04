import type { ComponentPropsWithoutRef, Ref } from 'react';

import { cn } from '@/lib/utils';

const textareaClasses =
  'focus-input min-h-[var(--textarea-min-height)] w-full resize-y rounded-[var(--radius-control)] border border-border-bold bg-input p-3 text-field text-foreground transition-[border-color,background-color] placeholder:text-muted enabled:hover:border-muted aria-invalid:border-danger aria-invalid:enabled:hover:border-danger disabled:cursor-not-allowed disabled:bg-disabled disabled:text-muted disabled:border-border-subtle';

/**
 * Inside a `ComposerFrame` the frame is the box: the field keeps its focus
 * focus but drops its edge, its fill, resize handle and resting height, and takes the
 * frame's tighter inset so its text lines up with the chips above it.
 */
const composerClasses =
  'min-h-0 resize-none border-transparent bg-transparent px-2 py-1 shadow-none hover:border-transparent hover:shadow-none';

export function Textarea({
  className,
  placement = 'field',
  ref,
  ...props
}: Readonly<
  ComponentPropsWithoutRef<'textarea'> & {
    /** `composer`: the message field inside a `ComposerFrame`. */
    placement?: 'field' | 'composer';
    ref?: Ref<HTMLTextAreaElement>;
  }
>) {
  return (
    <textarea
      ref={ref}
      className={cn(textareaClasses, placement === 'composer' && composerClasses, className)}
      {...props}
    />
  );
}
