import { useContext, useEffect, useState, type ReactNode } from 'react';
import { CircleDashed, type LucideIcon } from 'lucide-react';

import { LOADING_INDICATOR_DELAY_MS } from '@/lib/config/operational';
import { cn } from '@/lib/utils';

import { EmptyHeadingLevelContext, EmptyState } from './empty-state';
import { ReadError, readErrorProps, type RetryableRead } from './read-error';
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
 *   `not_measured` — the read succeeded and no measurement exists yet: the
 *               block EmptyState titled "Not measured yet", saying what
 *               fills it. Never a zero and never the empty state's
 *               "nothing here" (invariant 7).
 *   `empty`   — the block EmptyState: nothing exists yet, and the one thing
 *               to do. Its heading is an h2 on a page and an h3 inside a
 *               Card or DataTable, unless `headingLevel` says otherwise.
 *               `inline` is the EmptyState row inside a section that
 *               otherwise has content; `inline` with `compact` is one line
 *               with no box, for a small card that has nothing to list.
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
  /**
   * A route boundary that owns the page heading uses 1. Defaults to the
   * container's level: 3 inside a Card or DataTable, else 2.
   */
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
  /** One line with no box (EmptyState `compact`); a DataTable always draws it so. */
  compact?: boolean;
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
      /** Names what failed to load, above the error's message. */
      title?: string;
    }>
  | NotMeasured
  | BlockEmpty
  | InlineEmpty;

/** What a not-measured read says: what fills it, and the one step that does. */
type NotMeasuredCopy = Readonly<{
  /** One sentence: what measures this and when it appears. */
  description: string;
  icon?: LucideIcon;
  /** One primary control. */
  action?: ReactNode;
}>;

type NotMeasured = NotMeasuredCopy &
  Readonly<{
    kind: 'not_measured';
    /** As `empty`: defaults to the container's level. */
    headingLevel?: 1 | 2 | 3;
  }>;

/** The read a screen state is derived from: a TanStack query, or its shape. */
type ScreenRead<T> = RetryableRead &
  (
    | Readonly<{ status: 'pending' }>
    | Readonly<{ status: 'error' }>
    | Readonly<{ status: 'success'; data: T }>
  );

/** A read's measured content, or the `QueryState` it shows instead. */
type ScreenState<M> =
  | Readonly<{ kind: 'ready'; data: M }>
  | Readonly<{ kind: 'state'; state: QueryStateProps }>;

type Subject = Readonly<{
  /** What the read loads, in a sentence: "the business map" → "Couldn't load the business map". */
  subject: string;
}>;

type MeasuredOptions<T, M extends T> = Subject &
  Readonly<{
    /** True when the persisted answer holds a measurement; false is "Not measured yet". */
    measured: (data: T) => data is M;
    notMeasured: NotMeasuredCopy;
  }>;

/**
 * Maps one read to what its screen shows, keeping unknown apart from zero
 * (invariant 7): a pending read is loading, a failed one is "Couldn't load …"
 * with Retry for exactly that read, a successful one without a measurement is
 * "Not measured yet", and only a measured answer reaches the content. A read
 * whose refetch failed reports the failure rather than its stale answer.
 *
 * Pass only a read that has been asked: a query the caller disables stays
 * pending without fetching, so the caller renders why nothing was asked (no
 * source connected, nothing selected) before calling this.
 */
export function screenState<T>(read: ScreenRead<T>, options: Subject): ScreenState<T>;
export function screenState<T, M extends T>(
  read: ScreenRead<T>,
  options: MeasuredOptions<T, M>,
): ScreenState<M>;
export function screenState<T, M extends T>(
  read: ScreenRead<T>,
  options: Subject | MeasuredOptions<T, M>,
): ScreenState<T> {
  if (read.status === 'pending') {
    return { kind: 'state', state: { kind: 'loading', label: `Loading ${options.subject}…` } };
  }
  if (read.status === 'error') {
    return {
      kind: 'state',
      state: {
        kind: 'error',
        title: `Couldn't load ${options.subject}`,
        fallback: 'The request failed or timed out.',
        ...readErrorProps(read),
      },
    };
  }
  if (!('measured' in options) || options.measured(read.data)) {
    return { kind: 'ready', data: read.data };
  }
  return { kind: 'state', state: { kind: 'not_measured', ...options.notMeasured } };
}

export function QueryState(props: QueryStateProps) {
  if (props.kind === 'empty' && props.inline) {
    return (
      <EmptyState
        variant={props.compact ? 'compact' : 'inline'}
        icon={props.icon}
        title={props.message}
        primary={props.action}
      />
    );
  }
  return (
    <div
      data-query-state={props.kind}
      className={cn(
        'query-state grid min-h-[var(--query-state-height)] min-w-0',
        props.kind === 'empty' || props.kind === 'not_measured'
          ? 'content-center'
          : 'content-start',
      )}
    >
      <BlockBody {...props} />
    </div>
  );
}

function BlockBody(props: Exclude<QueryStateProps, InlineEmpty>) {
  const containerLevel = useContext(EmptyHeadingLevelContext);
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
          title={props.title}
        />
      );
    case 'not_measured':
      return (
        <EmptyState
          icon={props.icon ?? CircleDashed}
          title="Not measured yet"
          description={props.description}
          primary={props.action}
          headingLevel={props.headingLevel ?? containerLevel}
        />
      );
    case 'empty':
      return (
        <EmptyState
          icon={props.icon}
          title={props.heading}
          description={props.description}
          primary={props.action}
          headingLevel={props.headingLevel ?? containerLevel}
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
