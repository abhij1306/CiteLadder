'use client';

import { useId, useState, type ComponentPropsWithoutRef } from 'react';

import { tagClasses, type TagTone } from './filter-chip-variants';

/** Category labels share the existing chip owner; status remains Badge's job. */
export function Tag({
  tone = 'neutral',
  className,
  ...props
}: Readonly<ComponentPropsWithoutRef<'span'> & { tone?: TagTone }>) {
  return <span {...props} className={tagClasses(tone, className)} />;
}

/** Overflow expands in place so every label is available to touch and keyboard. */
export function TagGroup({
  labels,
  tone = 'neutral',
}: Readonly<{
  labels: readonly string[];
  tone?: TagTone;
}>) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const visible = expanded ? labels : labels.slice(0, 2);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <span id={id} className="contents">
        {visible.map((label, index) => (
          <Tag key={`${index}:${label}`} tone={tone} className="break-words whitespace-normal">
            {label}
          </Tag>
        ))}
      </span>
      {labels.length > 2 ? (
        <button
          type="button"
          className={tagClasses('neutral', 'control-raised focus-ring border-0 hover:bg-hover')}
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
