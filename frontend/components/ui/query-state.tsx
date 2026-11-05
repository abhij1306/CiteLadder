import { useEffect, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

import { LOADING_INDICATOR_DELAY_MS } from '@/lib/config/operational';
import { cn } from '@/lib/utils';

import { EmptyState } from './empty-state';
import { ReadError } from './read-error';
import { Skeleton } from './skeleton';

/**
 * The states a read shows instead of its content, in one footprint, so a read
 * that goes loading → error → retry → empty never moves the page:
 *
 *   `loading` — skeleton lines, held back for a beat so a fast read never
 *               flashes one; a wait handed from one owner's box to the next
 *               keeps the skeleton it already showed.
 *   `error`   — a negative Callout: what happened, Retry for exactly that
 *               read, and the support reference.
 *   `empty`   — the block EmptyState: nothing exists yet, and the one thing
 *               to do. `inline` is the EmptyState row inside a section that
 *               otherwise has content.
 *
 * Callers choose the state, never the geometry.
 */
type BlockEmpty = Readonly<{
  kind: 'empty';
  inline?: false;
  icon: LucideIcon;
  heading: string;
  /** One sentence: what is missing and what to do about it. */
  description?: string;
  /** One primary control; a second only when both are equal choices. */
  action?: ReactNode;
  /** A route boundary that owns the page heading uses 1. */
  headingLevel?: 1 | 2 | 3;
}>;

type InlineEmpty = Readonly<{
  kind: 'empty';
  inline: true;
  /** One short sentence: what is absent. */
  message: ReactNode;
  icon?: LucideIcon;
  /** One control (a `TextLink` or a `Button`). */
  action?: ReactNode;
}>;

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
  | BlockEmpty
  | InlineEmpty;

export function QueryState(props: QueryStateProps) {
  if (props.kind === 'empty' && props.inline) {
    return (
      <EmptyState variant="inline" icon={props.icon} title={props.message} primary={props.action} />
    );
  }
  return (
    <div
      data-query-state={props.kind}
      className={cn(
        'query-state grid min-h-[var(--query-state-height)] min-w-0',
        props.kind === 'empty' ? 'content-center' : 'content-start',
      )}
    >
      <BlockBody {...props} />
    </div>
  );
}

function BlockBody(props: Exclude<QueryStateProps, InlineEmpty>) {
  switch (props.kind) {
    case 'loading':
      return <DelayedSkeleton label={props.label ?? 'Loading…'} />;
    case 'error':
      return (
        <ReadError
          error={props.error}
          fallback={props.fallback}
          onRetry={props.onRetry}
          pending={props.pending ?? false}
        />
      );
    case 'empty':
      return (
        <EmptyState
          icon={props.icon}
          title={props.heading}
          description={props.description}
          primary={props.action}
          headingLevel={props.headingLevel ?? 2}
        />
      );
    default: {
      const exhaustive: never = props;
      return exhaustive;
    }
  }
}

/**
 * Loading placeholders on screen that have already been revealed.
 *
 * A cold load passes through several owners in turn — the shell's fallback,
 * the route's chunk, the page's first read — and each draws its own loading
 * box in the same place. Held back afresh every time, the placeholder went
 * visible → hidden → visible at each hand-over, so one wait read as three. A
 * loader that mounts while another is already showing is the same wait
 * continuing, so it starts revealed. React renders the replacement before it
 * removes the box it replaces, so the count still includes the outgoing one.
 */
let revealedLoaders = 0;

/**
 * The skeleton stays invisible for a beat (`loading-delayed`), and so does its
 * `status` announcement, so assistive technology never hears a loading state
 * nothing on screen shows yet. The box is there from the first frame.
 */
function DelayedSkeleton({ label }: Readonly<{ label: string }>) {
  const [continued] = useState(() => revealedLoaders > 0);
  const [revealed, setRevealed] = useState(continued);
  useEffect(() => {
    if (!revealed) {
      const timer = setTimeout(() => setRevealed(true), LOADING_INDICATOR_DELAY_MS);
      return () => clearTimeout(timer);
    }
    revealedLoaders += 1;
    return () => {
      revealedLoaders -= 1;
    };
  }, [revealed]);
  return (
    <span className={continued ? undefined : 'loading-delayed'}>
      {revealed ? (
        <Skeleton lines={3} label={label} />
      ) : (
        <span aria-hidden className="block h-16" />
      )}
    </span>
  );
}
