import {
  useCallback,
  useLayoutEffect,
  useRef,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type Ref,
} from 'react';

import { FIELD_EDGE } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const textareaClasses =
  'text-ink placeholder:text-ink-3 type-body block w-full rounded-control border disabled:cursor-not-allowed';

const fieldClasses = cn(
  'focus-input disabled:bg-raised-2 disabled:text-ink-2 field-sizing-content min-h-[calc(var(--field-min-rows)*1lh+1rem+2px)] max-h-[calc(var(--field-max-rows)*1lh+1rem+2px)] resize-none px-3 py-2 transition-[background-color,border-color,outline-color] duration-[var(--motion-fast)]',
  FIELD_EDGE,
);

const composerClasses =
  'field-sizing-content min-h-[var(--control-md)] resize-none border-0 bg-transparent px-2 py-1 max-h-[calc(var(--field-max-rows)*1lh+0.5rem)]';

const sizesItself = () => globalThis.CSS?.supports('field-sizing', 'content') ?? false;

export function Textarea({
  className,
  placement = 'field',
  rows = 4,
  maxRows = 8,
  style,
  ref,
  ...props
}: Readonly<
  ComponentPropsWithoutRef<'textarea'> & {
    placement?: 'field' | 'composer';
    maxRows?: number;
    ref?: Ref<HTMLTextAreaElement>;
  }
>) {
  const grows = placement === 'composer';
  const own = useRef<HTMLTextAreaElement | null>(null);
  const setRef = useCallback(
    (node: HTMLTextAreaElement | null) => {
      own.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );
  const growStyle: CSSProperties & Record<'--field-max-rows' | '--field-min-rows', number> = {
    ...style,
    '--field-max-rows': maxRows,
    '--field-min-rows': rows,
  };
  const { value } = props;
  useLayoutEffect(() => {
    const field = own.current;
    if (!grows || !field || sizesItself()) return;
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`;
  }, [grows, value]);
  return (
    <textarea
      ref={setRef}
      rows={grows ? 1 : rows}
      style={growStyle}
      className={cn(textareaClasses, grows ? composerClasses : fieldClasses, className)}
      {...props}
    />
  );
}
