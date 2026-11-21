import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

import { isTextCut, Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const cutWatchers = new WeakMap<Element, () => void>();
let cutObserver: ResizeObserver | null = null;

function watchCut(node: Element, onChange: () => void) {
  if (typeof ResizeObserver === 'undefined') return () => undefined;
  cutObserver ??= new ResizeObserver((entries) => {
    for (const entry of entries) cutWatchers.get(entry.target)?.();
  });
  cutWatchers.set(node, onChange);
  cutObserver.observe(node);
  return () => {
    cutWatchers.delete(node);
    cutObserver?.unobserve(node);
  };
}

const INTERACTIVE = 'a[href], button, [role="button"], [role="link"], [role="tab"], label';

export function useCut(
  ref: RefObject<HTMLElement | null>,
  measure: (node: HTMLElement) => boolean = isTextCut,
) {
  const [cut, setCut] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (node.parentElement?.closest(INTERACTIVE) || node.querySelector(INTERACTIVE)) return;
    const update = () => setCut(measure(node));
    update();
    return watchCut(node, update);
  }, [ref, measure]);
  return cut;
}

export function ClampText({
  children,
  lines = 1,
  tooltip,
  className,
  rowTitle = false,
}: Readonly<{
  children: ReactNode;
  lines?: 1 | 2;
  tooltip?: ReactNode;
  className?: string;
  rowTitle?: boolean;
}>) {
  const ref = useRef<HTMLSpanElement>(null);
  const cut = useCut(ref);
  const [fullText, setFullText] = useState('');
  const openWhenCut = (node: HTMLElement) => {
    if (!isTextCut(node)) return false;
    setFullText(node.textContent ?? '');
    return true;
  };
  return (
    <Tooltip content={tooltip ?? fullText} shouldOpen={openWhenCut}>
      <span
        ref={ref}
        data-truncated={cut || undefined}
        data-row-title={rowTitle || undefined}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a cut value is a tab stop so its full text (the tooltip) is reachable by keyboard.
        tabIndex={cut ? 0 : undefined}
        className={cn(
          'block min-w-0',
          lines === 1 ? 'truncate' : 'line-clamp-2',
          cut && 'rounded-mark',
          className,
        )}
      >
        {children}
      </span>
    </Tooltip>
  );
}

export function UrlCutParts({ text }: Readonly<{ text: string }>) {
  const { head, tail } = splitUrlTail(text);
  return (
    <>
      {head ? <span className="min-w-0 truncate">{head}</span> : null}
      <span className={cn('max-w-full min-w-0 truncate', head && 'shrink-0')}>{tail}</span>
    </>
  );
}

function splitUrlTail(text: string): { head: string; tail: string } {
  const cut = text.replace(/\/$/u, '').lastIndexOf('/');
  if (cut <= 0) return { head: '', tail: text };
  const tail = text.slice(cut);
  if (tail.length > URL_TAIL_MAX) return { head: '', tail: text };
  return { head: text.slice(0, cut), tail };
}

const URL_TAIL_MAX = 32;
