import { cn } from '@/lib/utils';

/**
 * Passage — a quoted line lifted verbatim from a page or an answer we do not
 * own: the product's core evidence claim. A `surface-sunken` well
 * (`radius-md`, 16 inset, 12 at the foot) inside a Card, the quote in 14/24
 * `ink`; stack passages 12 apart. `highlight` marks the one phrase the
 * claim rests on with the highlighter; if the phrase is not in the text,
 * nothing is marked. Never paraphrase or trim mid-sentence.
 *
 * A `blockquote`: the text is somebody else's and the markup says so.
 */
export function Passage({
  children,
  highlight,
}: Readonly<{
  /** The verbatim text. */
  children: string;
  /** The phrase inside the text the claim rests on, marked once. */
  highlight?: string;
}>) {
  const at = highlight ? children.indexOf(highlight) : -1;
  return (
    <blockquote className="bg-surface-sunken rounded-md px-4 pt-4 pb-3">
      <p className="text-body-sm text-ink leading-6">
        “
        {highlight && at >= 0 ? (
          <>
            {children.slice(0, at)}
            <mark className="cl-mark">{highlight}</mark>
            {children.slice(at + highlight.length)}
          </>
        ) : (
          children
        )}
        ”
      </p>
    </blockquote>
  );
}

/**
 * Limitations — what a reader may NOT conclude from what they are looking at.
 *
 * One home, because the rule these carry is one rule: a finding is shown with
 * its caveats or it is not shown honestly.
 */
export function Limitations({
  items,
  className,
}: Readonly<{ items: readonly string[]; className?: string }>) {
  if (!items.length) return null;
  return (
    <div className={cn('grid gap-1', className)}>
      {items.map((item) => (
        <p key={item} className="text-caption text-ink-muted">
          {item}
        </p>
      ))}
    </div>
  );
}
