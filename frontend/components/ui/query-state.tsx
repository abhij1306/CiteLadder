import { useEffect, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

import { LOADING_INDICATOR_DELAY_MS } from '@/lib/config/operational';
import { cn } from '@/lib/utils';

import { cardClasses } from './card-variants';
import { ReadError } from './read-error';
import { Spinner } from './spinner';
import { textRole } from './typography';

/**
 * The three states a read can show before it has content, as one organism.
 *
 *   `loading` — the first load: a calm, centred spinner, held back for a beat
 *               so a fast read never flashes one.
 *   `error`   — the read failed: what happened, Retry for exactly that read,
 *               and the support reference.
 *   `empty`   — first use: nothing exists yet, and the one thing to do.
 *
 * All three render in ONE footprint: the same box (the card recipe: radius
 * 12, padding 16 on the box itself, the hairline edge) at the same reserved
 * height, so a read that goes loading → error → retry → empty never moves
 * the page around it. Before this the same failed read drew at 20, 32, 88,
 * 120 and 152px depending on which screen wrapped it. Inside a card the box
 * gives up its own surface and shares the card's, but keeps its footprint.
 *
 * Callers choose the state, never the geometry: there is no size, padding or
 * height prop.
 */
export type QueryStateProps =
  | Readonly<{
      kind: 'loading';
      /** What is loading, announced to assistive technology. */
      label?: string;
    }>
  | Readonly<{
      kind: 'error';
      error: unknown;
      /** The message when the error carries none of its own. */
      fallback: string;
      /** Retries exactly the read that failed. */
      onRetry: () => void;
      pending?: boolean;
    }>
  | Readonly<{
      kind: 'empty';
      icon: LucideIcon;
      heading: string;
      /** One sentence: what is missing and what to do about it. */
      description?: string;
      /** One primary control; a second only when both are equal choices. */
      action?: ReactNode;
      /** A route boundary that owns the page heading uses 1. */
      headingLevel?: 1 | 2 | 3;
    }>;

const HEADING_TAG = { 1: 'h1', 2: 'h2', 3: 'h3' } as const;

export function QueryState(props: QueryStateProps) {
  return (
    <div
      data-query-state={props.kind}
      className={cn(
        cardClasses(),
        'query-state grid min-h-[var(--query-state-height)] gap-[var(--compact-gap)] p-[var(--card-padding)]',
        props.kind === 'loading' ? 'place-items-center' : 'content-start justify-items-start',
      )}
    >
      <QueryStateBody {...props} />
    </div>
  );
}

function QueryStateBody(props: QueryStateProps) {
  switch (props.kind) {
    case 'loading':
      return <DelayedSpinner label={props.label ?? 'Loading…'} />;
    case 'error':
      return (
        <ReadError
          error={props.error}
          fallback={props.fallback}
          onRetry={props.onRetry}
          pending={props.pending ?? false}
        />
      );
    case 'empty': {
      const Heading = HEADING_TAG[props.headingLevel ?? 2];
      const Icon = props.icon;
      return (
        <>
          <div className="flex items-center gap-2">
            <Icon className="text-muted size-4 shrink-0" aria-hidden />
            <Heading className={textRole('sectionTitle')}>{props.heading}</Heading>
          </div>
          {props.description ? <p className="type-body max-w-[52ch]">{props.description}</p> : null}
          {props.action ? <div className="flex items-center gap-2">{props.action}</div> : null}
        </>
      );
    }
    default: {
      const exhaustive: never = props;
      return exhaustive;
    }
  }
}

/**
 * The spinner stays invisible for a beat (`loading-delayed`), and so does the
 * `status` announcement, so assistive technology never announces a loading
 * state nothing on screen shows yet. The box itself is there from the first
 * frame: the content that lands into it lands in a box that already existed.
 */
function DelayedSpinner({ label }: Readonly<{ label: string }>) {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setRevealed(true), LOADING_INDICATOR_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <span className="loading-delayed">
      <Spinner size="lg" label={revealed ? label : undefined} className="text-muted" />
    </span>
  );
}
