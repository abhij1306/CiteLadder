import { useContext, useLayoutEffect, useRef, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { usePageEmptyOfferRegister } from '@/components/ui/masthead-actions';
import { Notice, readErrorProps, type RetryableRead } from '@/components/ui/notice';
import { ShapeBlocks, SkeletonFrame, type LoadingShape } from '@/components/ui/skeleton-block';
import { StateHeadingLevelContext, type HeadingLevel } from '@/components/ui/state-heading-level';
import { textRole } from '@/components/ui/typography';
import { CircleDashed, Inbox, type IconGlyph } from '@/lib/icons';
import { cn } from '@/lib/utils';

const HEADING_TAG = { 1: 'h1', 2: 'h2', 3: 'h3' } as const satisfies Record<HeadingLevel, string>;

type ActionNote = Readonly<{ id: string; text: string }>;

type BlockEmpty = Readonly<{
  kind: 'empty';
  inline?: false;
  icon?: IconGlyph;
  heading: string;
  description?: ReactNode;
  action?: ReactNode;
  actionNote?: ActionNote;
  headingLevel?: HeadingLevel;
}>;

type InlineEmpty = Readonly<{
  kind: 'empty';
  inline: true;
  message: ReactNode;
  icon?: IconGlyph;
  action?: ReactNode;
  compact?: boolean;
}>;

type FilteredEmpty = Readonly<{
  kind: 'filtered';
  heading?: string;
  onClear: () => void;
  headingLevel?: HeadingLevel;
}>;

type NotMeasuredCopy = Readonly<{
  description: string;
  action?: ReactNode;
}>;

type NotMeasured = NotMeasuredCopy &
  Readonly<{
    kind: 'not_measured';
    headingLevel?: HeadingLevel;
  }>;

export type StateBlockProps =
  | Readonly<{
      kind: 'loading';
      label?: string;
      shape?: LoadingShape;
    }>
  | Readonly<{
      kind: 'error';
      error: unknown;
      fallback: string;
      onRetry: () => void;
      pending?: boolean;
      title: string;
    }>
  | NotMeasured
  | BlockEmpty
  | FilteredEmpty
  | InlineEmpty;

type ScreenRead<T> = RetryableRead &
  (
    | Readonly<{ status: 'pending' }>
    | Readonly<{ status: 'error' }>
    | Readonly<{ status: 'success'; data: T }>
  );

type ScreenState<M> =
  | Readonly<{ kind: 'ready'; data: M }>
  | Readonly<{ kind: 'state'; state: StateBlockProps }>;

export const READ_FAILED = 'The request failed or timed out.';

type Subject = Readonly<{
  subject: string;
  shape: LoadingShape;
}>;

type MeasuredOptions<T, M extends T> = Subject &
  Readonly<{
    hasMeasurement: (data: T) => data is M;
    notMeasured: NotMeasuredCopy;
  }>;

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
    return {
      kind: 'state',
      state: { kind: 'loading', label: `Loading ${options.subject}…`, shape: options.shape },
    };
  }
  if (read.status === 'error') {
    return {
      kind: 'state',
      state: {
        kind: 'error',
        title: `Couldn't load ${options.subject}`,
        fallback: READ_FAILED,
        ...readErrorProps(read),
      },
    };
  }
  if (!('hasMeasurement' in options) || options.hasMeasurement(read.data)) {
    return { kind: 'ready', data: read.data };
  }
  return { kind: 'state', state: { kind: 'not_measured', ...options.notMeasured } };
}

export function StateBlock(props: StateBlockProps) {
  if (props.kind === 'empty' && props.inline) return <InlineEmptyView {...props} />;
  return <FramedState {...props} />;
}

function FramedState(props: Exclude<StateBlockProps, InlineEmpty>) {
  const ref = useRef<HTMLDivElement>(null);
  usePageOffer(ref, (props.kind === 'empty' || props.kind === 'not_measured') && !!props.action);
  const framed = props.kind !== 'error' && !(props.kind === 'loading' && isFigures(props.shape));
  return (
    <div
      ref={ref}
      data-state-block={props.kind}
      data-state-frame={framed ? '' : undefined}
      className="state-block min-w-0"
    >
      <BlockBody {...props} />
    </div>
  );
}

const STATE_CONTAINERS =
  ".surface-card, .surface-slip, .surface-well, [data-section='framed'], [role='dialog'], [data-data-table]";

function usePageOffer(ref: Readonly<{ current: HTMLElement | null }>, offers: boolean) {
  const register = usePageEmptyOfferRegister();
  useLayoutEffect(() => {
    const node = ref.current;
    if (!offers || !node || node.closest(STATE_CONTAINERS)) return;
    node.dataset.stateOffer = '';
    const release = register?.();
    return () => {
      delete node.dataset.stateOffer;
      release?.();
    };
  }, [ref, offers, register]);
}

const isFigures = (shape: LoadingShape | undefined) => shape?.kind === 'figures';

function InlineEmptyView({ message, icon: Glyph, action, compact = false }: InlineEmpty) {
  return (
    <div
      data-state-block="empty"
      data-state-block-inline=""
      className={cn(
        textRole('body', 'text-ink-2 flex min-w-0 items-center gap-2'),
        !compact && 'bg-well rounded-control px-3 py-2',
      )}
    >
      {Glyph ? <Glyph className="size-3.5 shrink-0" aria-hidden /> : null}
      <p className={cn('min-w-0 flex-1', compact && 'truncate')}>{message}</p>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

function FilteredBody({
  heading,
  onClear,
  headingLevel,
  containerLevel,
}: FilteredEmpty & Readonly<{ containerLevel: HeadingLevel }>) {
  return (
    <EmptyBody
      heading={heading ?? 'Nothing matches these filters'}
      action={<Button onClick={onClear}>Clear filters</Button>}
      headingLevel={headingLevel ?? containerLevel}
    />
  );
}

function BlockBody(props: Exclude<StateBlockProps, InlineEmpty>) {
  const containerLevel = useContext(StateHeadingLevelContext);
  switch (props.kind) {
    case 'loading': {
      const shape = props.shape ?? { kind: 'list' };
      return (
        <SkeletonFrame label={props.label ?? 'Loading…'} variant={shape.kind}>
          <ShapeBlocks shape={shape} />
        </SkeletonFrame>
      );
    }
    case 'error':
      return (
        <Notice
          kind="read"
          error={props.error}
          fallback={props.fallback}
          onRetry={props.onRetry}
          pending={props.pending}
          title={props.title}
        />
      );
    case 'not_measured':
      return (
        <EmptyBody
          icon={CircleDashed}
          heading="No measurements yet"
          description={props.description}
          action={props.action}
          headingLevel={props.headingLevel ?? containerLevel}
        />
      );
    case 'empty':
      return (
        <EmptyBody
          icon={props.icon}
          heading={props.heading}
          description={props.description}
          action={props.action}
          actionNote={props.actionNote}
          headingLevel={props.headingLevel ?? containerLevel}
        />
      );
    case 'filtered':
      return <FilteredBody {...props} containerLevel={containerLevel} />;
    default: {
      const exhaustive: never = props;
      return exhaustive;
    }
  }
}

function EmptyBody({
  icon: Glyph = Inbox,
  heading,
  description,
  action,
  actionNote,
  headingLevel,
}: Readonly<{
  icon?: IconGlyph;
  heading: string;
  description?: ReactNode;
  action?: ReactNode;
  actionNote?: ActionNote;
  headingLevel: HeadingLevel;
}>) {
  const Heading = HEADING_TAG[headingLevel];
  return (
    <div className="flex flex-col items-center text-center">
      <span
        aria-hidden
        data-icon-tile=""
        className="bg-well rounded-control text-ink-2 grid size-8 place-items-center"
      >
        <Glyph className="size-4" />
      </span>
      <Heading className={textRole('subheading', 'mt-[var(--state-title-gap,16px)] text-balance')}>
        {heading}
      </Heading>
      {description ? (
        <p className={textRole('body', 'text-ink-2 mt-1 max-w-[500px] text-balance')}>
          {description}
        </p>
      ) : null}
      {action ? (
        <div className="mt-[var(--state-action-gap,16px)] flex flex-wrap items-center justify-center gap-2">
          {action}
        </div>
      ) : null}
      {actionNote ? (
        <p id={actionNote.id} className={textRole('caption', 'text-ink-2 mt-2')}>
          {actionNote.text}
        </p>
      ) : null}
    </div>
  );
}
