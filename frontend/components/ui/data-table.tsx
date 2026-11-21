import { useContext, useId, type ComponentProps, type ReactNode, type RefObject } from 'react';

import { BusyRung } from '@/components/ui/rung-meter';
import {
  DataTableColumns,
  useFlexibleColumnCheck,
  type DataTableColumn,
  type DataTableSelection,
} from '@/components/ui/data-table-columns';
import { ShownColumnsContext, useFittedColumns } from '@/components/ui/data-table-fit';
import {
  DataTableBody,
  usePinnedPadding,
  type DataTableInlineEmpty,
  type DataTableState,
} from '@/components/ui/data-table-body';
import { FilterBar, type FilterBarProps } from '@/components/ui/filter-bar';
import { Pager } from '@/components/ui/pager';
import { TABLE_PAGE_SIZE_OPTIONS } from '@/lib/config/tables';
import { useScrollFrame, type ScrollFrameState } from '@/components/ui/scroll-edges';
import { Table } from '@/components/ui/table';
import { textRole } from '@/components/ui/typography';
import { StateBlock } from '@/components/ui/state-block';
import { StateHeadingLevelContext, type HeadingLevel } from '@/components/ui/state-heading-level';

import './data-table.css';

export type { DataTableColumn, DataTableSelection, DataTableState };

export type DataTablePager = Omit<ComponentProps<typeof Pager>, 'frame' | 'className'>;

export function DataTable({
  title,
  description,
  actions,
  toolbar,
  columns,
  children,
  rowCount,
  pageSize,
  state,
  pager,
  busy,
  selection,
  footer,
  label,
  reserveRows = false,
}: Readonly<{
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  toolbar?: FilterBarProps;
  columns: readonly DataTableColumn[];
  children?: ReactNode;
  rowCount?: number;
  pageSize?: number;
  state?: DataTableState | DataTableInlineEmpty;
  pager?: DataTablePager;
  busy?: Readonly<{ active: boolean; label: string }>;
  selection?: DataTableSelection;
  footer?: ReactNode;
  label?: string;
  reserveRows?: boolean;
}>) {
  const headingId = useId();
  const level = useContext(StateHeadingLevelContext);
  const parts = dataTableParts({ title, label, headingId, columns, selection });
  const { frameRef, probe, scope, shown, shownKeys } = useFittedColumns({
    columns,
    selection: Boolean(selection),
  });
  const paging = pagingLayout(pager, pageSize, reserveRows);
  const scroll = useScrollFrame({ label: parts.regionLabel, start: false });
  useFlexibleColumnCheck({ columns, title, label });
  const replacing = replacingState(state);
  return (
    <section
      aria-labelledby={parts.naming.ariaLabelledBy}
      aria-label={parts.naming.ariaLabel}
      aria-busy={busy?.active || undefined}
      data-data-table=""
      className="relative grid min-w-0 content-start"
    >
      {busy ? <BusyRung active={busy.active} label={busy.label} /> : null}
      <DataTableHeader
        title={title}
        headingId={headingId}
        level={level}
        toolbar={toolbar}
        description={description}
        actions={actions}
      />
      <HeldFootprint state={replacing} level={stateLevel(title, level)} held={reserveRows}>
        <DataTableFrame
          hidden={dropsTable(replacing, reserveRows)}
          scroll={scroll}
          naming={parts.naming}
          pinned={parts.pinned}
          frameRef={frameRef}
          scope={scope}
          probe={probe}
          foot={<DataTableFoot footer={footer} pager={paging.pager} />}
        >
          <DataTableColumns columns={columns} selection={selection} />
          <DataTableBody
            cells={parts.colSpan}
            colSpan={shown.length + (selection ? 1 : 0)}
            state={replacing ? undefined : state}
            pageSize={state?.kind === 'loading' ? pageSize : paging.pageSize}
            rowCount={rowCount}
            reserve={reserveRows}
          >
            <ShownColumnsContext value={shownKeys}>
              {state === undefined ? children : null}
            </ShownColumnsContext>
          </DataTableBody>
        </DataTableFrame>
      </HeldFootprint>
    </section>
  );
}

function HeldFootprint({
  state,
  level,
  held,
  children,
}: Readonly<{
  state: ComponentProps<typeof StateBlock> | null;
  level: HeadingLevel;
  held: boolean;
  children: ReactNode;
}>) {
  const block = state ? <ReplacingState state={state} level={level} /> : null;
  if (!block || !held)
    return (
      <>
        {block}
        {children}
      </>
    );
  return (
    <div className="grid min-w-0">
      <div className="col-start-1 row-start-1 min-w-0">{block}</div>
      <div inert className="col-start-1 row-start-1 min-w-0" style={{ visibility: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}

function dataTableParts({
  title,
  label,
  headingId,
  columns,
  selection,
}: Readonly<{
  title?: string;
  label?: string;
  headingId: string;
  columns: readonly DataTableColumn[];
  selection?: DataTableSelection;
}>) {
  const naming = title
    ? { ariaLabelledBy: headingId, ariaLabel: undefined }
    : { ariaLabelledBy: undefined, ariaLabel: label };
  const pinned: 1 | 2 = selection ? 2 : 1;
  return {
    colSpan: columns.length + (selection ? 1 : 0),
    regionLabel: title ?? label ?? 'Table',
    naming,
    pinned,
  };
}

const stateLevel = (title: string | undefined, level: HeadingLevel): HeadingLevel => {
  if (!title) return level;
  return level === 1 ? 2 : 3;
};

const dropsTable = (replacing: ReturnType<typeof replacingState>, reserveRows: boolean) =>
  replacing !== null && !reserveRows;

function replacingState(
  state: DataTableState | DataTableInlineEmpty | undefined,
): ComponentProps<typeof StateBlock> | null {
  if (state === undefined || state.kind === 'loading' || state.kind === 'filtered') return null;
  return state;
}

function ReplacingState({
  state,
  level,
}: Readonly<{ state: ComponentProps<typeof StateBlock>; level: HeadingLevel }>) {
  return (
    <StateHeadingLevelContext value={level}>
      {state.kind === 'empty' && state.inline ? (
        <div className="p-4">
          <StateBlock {...state} />
        </div>
      ) : (
        <StateBlock {...state} />
      )}
    </StateHeadingLevelContext>
  );
}

function DataTableFrame({
  hidden,
  scroll,
  naming,
  pinned,
  frameRef,
  scope,
  probe,
  foot,
  children,
}: Readonly<{
  hidden: boolean;
  scroll: ScrollFrameState;
  naming: { ariaLabelledBy?: string; ariaLabel?: string };
  pinned: 1 | 2;
  frameRef: RefObject<HTMLDivElement | null>;
  scope: string;
  probe: ReactNode;
  foot: ReactNode;
  children: ReactNode;
}>) {
  usePinnedPadding(scroll.ref, pinned);
  return (
    <div
      ref={frameRef}
      data-data-table-frame=""
      data-table-scope={scope}
      data-pinned={pinned}
      hidden={hidden}
      className="relative isolate min-w-0"
    >
      {probe}
      <div {...scroll.frame} className="relative min-w-0">
        <Table
          {...naming}
          wrapperRef={scroll.ref}
          region={scroll.region}
          wrapperClassName="@container"
        >
          {children}
        </Table>
      </div>
      {foot}
    </div>
  );
}

function DataTableFoot({
  footer,
  pager,
}: Readonly<{ footer: ReactNode; pager: DataTablePager | undefined }>) {
  if (!pager && !footer) return null;
  return (
    <div
      data-data-table-foot=""
      className="border-rule flex min-h-10 min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t px-4 py-1"
    >
      {footer ? (
        <div className="type-caption grid min-w-0 content-center gap-1">{footer}</div>
      ) : null}
      {pager ? (
        <div className="ms-auto flex min-w-0 flex-wrap items-center gap-4">
          <Pager {...pager} />
        </div>
      ) : null}
    </div>
  );
}

function hasMorePages(pager: DataTablePager): boolean {
  if (pager.canPrev || pager.canNext) return true;
  if (pager.pageSize === undefined) return false;
  const smallest = Math.min(...TABLE_PAGE_SIZE_OPTIONS);
  if (pager.pageSize.value > smallest) return true;
  const total = pager.range?.total;
  return total !== undefined && total > smallest;
}

function pagingLayout(
  pager: DataTablePager | undefined,
  pageSize: number | undefined,
  reserveRows: boolean,
): { pager?: DataTablePager; pageSize?: number } {
  if (pager === undefined) return { pageSize };
  return reserveRows || hasMorePages(pager) ? { pager, pageSize } : {};
}

function DataTableHeader({
  title,
  headingId,
  level,
  toolbar,
  description,
  actions,
}: Readonly<{
  title?: string;
  headingId: string;
  level: HeadingLevel;
  toolbar?: FilterBarProps;
  description?: ReactNode;
  actions?: ReactNode;
}>) {
  if (!title && !toolbar && !description && !actions) return null;
  const head = (
    <>
      <TitleRow title={title} headingId={headingId} level={level} toolbar={toolbar} />
      {description ? (
        <p data-data-table-description="" className="type-caption max-w-[72ch]">
          {description}
        </p>
      ) : null}
    </>
  );
  if (!actions) return <header className="grid min-w-0 gap-1 pb-3">{head}</header>;
  return (
    <header className="flex flex-wrap items-start justify-between gap-2 pb-3">
      <div className="grid min-w-0 flex-1 basis-60 grid-cols-[minmax(0,1fr)] gap-1">{head}</div>
      <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">{actions}</div>
    </header>
  );
}

function TitleRow({
  title,
  headingId,
  level,
  toolbar,
}: Readonly<{
  title?: string;
  headingId: string;
  level: HeadingLevel;
  toolbar?: FilterBarProps;
}>) {
  const Heading = level === 3 ? 'h3' : 'h2';
  return (
    <div
      data-data-table-header=""
      className="rail:flex-row rail:items-center flex min-h-[var(--control-md)] min-w-0 flex-col items-stretch gap-2"
    >
      {title ? (
        <Heading id={headingId} className={textRole('heading', 'min-w-0 shrink-0 truncate')}>
          {title}
        </Heading>
      ) : null}
      {toolbar ? (
        <div className="min-w-0 flex-1">
          <FilterBar {...toolbar} />
        </div>
      ) : null}
    </div>
  );
}
