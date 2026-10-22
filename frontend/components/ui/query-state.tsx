import { useEffect, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

import { LOADING_INDICATOR_DELAY_MS } from '@/lib/config/operational';
import { cn } from '@/lib/utils';

import { cardClasses } from './card-variants';
import { ReadError } from './read-error';
import { Spinner } from './spinner';
import { textRole } from './typography';

/**
 * The states a read can show instead of its content, as one organism.
 *
 *   `loading` — the first load: a calm, centred spinner, held back for a beat
 *               so a fast read never flashes one.
 *   `error`   — the read failed: what happened, Retry for exactly that read,
 *               and the support reference.
 *   `empty`   — nothing exists yet, and the one thing to do.
 *
 * Two presentations, one footprint each:
 *
 *   block  — the region's whole purpose is the state (a route, a section, a
 *            table body). The box recipe (radius 12, padding 16 on the box,
 *            the hairline edge) at the one reserved height, so a read that
 *            goes loading → error → retry → empty never moves the page. Inside
 *            a card, panel, dialog or table the box gives up its own surface
 *            and shares the container's, but keeps its footprint.
 *   inline — `inline` on an empty state: the one-line "No …" inside a section
 *            that otherwise has content ("No orphaned pages."). One 32px row:
 *            an optional icon, the sentence in muted body ink, one action.
 *
 * This replaced `EmptyState` (page and compact variants), `InlineEmpty` and
 * the router's `screen-states`, which drew the same absence at 20, 32, 88, 120
 * and 152px. Callers choose the state, never the geometry: there is no size,
 * padding or height prop.
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

const HEADING_TAG = { 1: 'h1', 2: 'h2', 3: 'h3' } as const;

export function QueryState(props: QueryStateProps) {
  if (props.kind === 'empty' && props.inline) return <InlineState {...props} />;
  return (
    <div
      data-query-state={props.kind}
      className={cn(
        cardClasses(),
        'query-state grid min-h-[var(--query-state-height)] gap-[var(--compact-gap)]',
        props.kind === 'loading' ? 'place-items-center' : 'content-start justify-items-start',
      )}
    >
      <BlockBody {...props} />
    </div>
  );
}

function InlineState({ message, icon: Icon, action }: InlineEmpty) {
  return (
    <div
      data-query-state="empty"
      data-query-state-inline=""
      className="flex min-h-[var(--control-height-md)] min-w-0 flex-wrap items-center gap-x-2"
    >
      {Icon ? <Icon className="text-muted size-4 shrink-0" aria-hidden /> : null}
      <p className={textRole('body', 'text-muted min-w-0')}>{message}</p>
      {action}
    </div>
  );
}

function BlockBody(props: Exclude<QueryStateProps, InlineEmpty>) {
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
      <Spinner label={revealed ? label : undefined} className="text-muted" />
    </span>
  );
}
