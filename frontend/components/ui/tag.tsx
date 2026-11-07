'use client';

import { useId, useState, type ComponentPropsWithoutRef } from 'react';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * The tag face: 24px, the Geist label style (12px medium, normal tracking and
 * figures, set here so a tag inside a figure never inherits the figure's
 * tight tracking) in `ink` on `surface` with the xs ring, `radius-xs`. It is
 * never wider than its container.
 */
export const TAG_FACE =
  'bg-surface text-ink shadow-xs inline-flex h-6 max-w-full min-w-0 shrink-0 items-center gap-1 rounded-xs px-2 font-sans text-caption font-medium tracking-normal normal-nums whitespace-nowrap';

/**
 * Tag — a neutral chip for a topic, engine or active filter, optionally
 * removable (`onRemove` adds a remove button named "Remove …"). Status is a
 * `Badge`, never a Tag; tags are never coloured and never buttons.
 *
 * A tag never overflows its container: a text label is one line, cut with an
 * ellipsis, its full text in the tooltip. A tag whose children are not plain
 * text truncates its own label span (`min-w-0 truncate`).
 */
export function Tag({
  className,
  children,
  onRemove,
  removeLabel,
  ...props
}: Readonly<
  ComponentPropsWithoutRef<'span'> & {
    onRemove?: () => void;
    /** What the remove button removes, when the children are not plain text. */
    removeLabel?: string;
  }
>) {
  const text = typeof children === 'string' ? children : undefined;
  return (
    <span title={text} {...props} className={cn(TAG_FACE, onRemove && 'pe-0.5', className)}>
      {text === undefined ? children : <span className="min-w-0 truncate">{text}</span>}
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${removeLabel ?? (typeof children === 'string' ? children : 'tag')}`}
          onClick={onRemove}
          className="focus-ring text-ink-muted hover:bg-surface-sunken hover:text-ink grid size-5 place-items-center rounded-xs transition-colors"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </span>
  );
}

/**
 * InlineTag — a tag set inside a line of caption text (a table row's topic
 * before its classification): the caption face in `ink-secondary` with a
 * 1px `line-strong` inset ring, `radius-xs`, 4px across. The ring is drawn
 * inside the box without a border, so the tag adds no height to its line.
 */
export function InlineTag({ children }: Readonly<{ children: string }>) {
  return (
    <span className="text-ink-secondary ring-line-strong me-1 rounded-xs px-1 font-medium ring-1 ring-inset">
      {children}
    </span>
  );
}

/** Two tags and a "+n" control that expands the rest in place, for touch and keyboard. */
export function TagGroup({ labels }: Readonly<{ labels: readonly string[] }>) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const visible = expanded ? labels : labels.slice(0, 2);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <span id={id} className="contents">
        {visible.map((label, index) => (
          <Tag key={`${index}:${label}`}>{label}</Tag>
        ))}
      </span>
      {labels.length > 2 ? (
        <button
          type="button"
          className={cn(TAG_FACE, 'focus-ring hover:bg-surface-sunken')}
          aria-expanded={expanded}
          aria-controls={id}
          aria-label={expanded ? 'Show fewer tags' : `Show ${labels.length - 2} more tags`}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show less' : `+${labels.length - 2}`}
        </button>
      ) : null}
    </div>
  );
}
