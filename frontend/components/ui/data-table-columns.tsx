import { ArrowDown, ArrowUp } from '@/lib/icons';
import { Checkbox } from '@/components/ui/checkbox';
import { HintedTableHead, SortableTableHead } from '@/components/ui/table-heads';
import { TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { textRole } from '@/components/ui/typography';

const COLUMN_WIDTH = {
  flex: { kind: 'rest' },
  reading: { kind: 'rest', steps: 86 },
  index: { kind: 'steps', steps: 10 },
  figure: { kind: 'steps', steps: 16 },
  marks: { kind: 'steps', steps: 24 },
  shortMetric: { kind: 'steps', steps: 16 },
  metric: { kind: 'steps', steps: 16 },
  status: { kind: 'steps', steps: 20 },
  category: { kind: 'steps', steps: 24 },
  date: { kind: 'steps', steps: 24 },
  stamp: { kind: 'steps', steps: 24 },
  name: { kind: 'steps', steps: 24 },
  action: { kind: 'steps', steps: 10 },
  button: { kind: 'steps', steps: 20 },
  control: { kind: 'steps', steps: 10 },
  rowActions: { kind: 'steps', steps: 20 },
} as const satisfies Record<
  string,
  { kind: 'rest'; steps?: number } | { kind: 'steps'; steps: number }
>;

const SELECT_STEPS = 10;

type DataTableColumnWidth = keyof typeof COLUMN_WIDTH;

type ColumnKind = 'identity' | 'text' | 'number' | 'date' | 'status' | 'url' | 'actions';

type KindSpec = Readonly<{ align: 'start' | 'end'; tabular: boolean; width: DataTableColumnWidth }>;

const KIND = {
  identity: { align: 'start', tabular: false, width: 'flex' },
  text: { align: 'start', tabular: false, width: 'flex' },
  number: { align: 'end', tabular: true, width: 'figure' },
  date: { align: 'start', tabular: true, width: 'date' },
  status: { align: 'start', tabular: false, width: 'status' },
  url: { align: 'start', tabular: false, width: 'flex' },
  actions: { align: 'end', tabular: false, width: 'rowActions' },
} as const satisfies Record<ColumnKind, KindSpec>;

export type DataTableColumn = Readonly<{
  key: string;
  label: string;
  kind?: ColumnKind;
  width?: DataTableColumnWidth;
  hideLabel?: boolean;
  priority?: 'low';
  sort?: Readonly<{ active: boolean; descending: boolean; onSort: () => void }>;
  order?: 'ascending' | 'descending';
  sublabel?: string;
  hint?: string;
  desktopOnly?: boolean;
}>;

export type DataTableSelection = Readonly<{
  all: boolean | 'indeterminate';
  onAllChange: (checked: boolean) => void;
  noun: string;
}>;

function columnKind(column: DataTableColumn): ColumnKind {
  return column.kind ?? 'text';
}

function widthOf(column: DataTableColumn): DataTableColumnWidth {
  return column.width ?? KIND[columnKind(column)].width;
}

function isFlexible(column: DataTableColumn): boolean {
  return COLUMN_WIDTH[widthOf(column)].kind === 'rest';
}

const alignOf = (column: DataTableColumn) => KIND[columnKind(column)].align;

function gutters(columns: readonly DataTableColumn[]): boolean[] {
  return columns.map(
    (column, index) =>
      index > 0 && alignOf(column) === 'start' && alignOf(columns[index - 1]!) === 'end',
  );
}

const GUTTER_PX = 12;
const HUG_CAP = '40ch';

export function columnRules({
  scope,
  columns,
  hidden,
  selection,
}: Readonly<{
  scope: string;
  columns: readonly DataTableColumn[];
  hidden: readonly number[];
  selection: boolean;
}>): string {
  const offset = selection ? 2 : 1;
  const at = (position: number, rows = 'tr:not([data-table-state])') =>
    `[data-table-scope="${scope}"] ${rows} > :nth-child(${position})`;
  const hiddenSet = new Set(hidden);
  const shown = columns.filter((_, index) => !hiddenSet.has(index));
  const shownGutters = gutters(shown);
  const gutter = new Set(shown.filter((_, index) => shownGutters[index]));
  const share = `${(100 / Math.max(1, shown.filter(isFlexible).length)).toFixed(3)}%`;
  const select = `width:${SELECT_WIDTH};min-width:${SELECT_WIDTH};padding-inline-end:8px`;
  const rules = selection ? [`${at(1)}{${select}}`] : [];
  columns.forEach((column, index) => {
    const cell = at(index + offset);
    const kind = KIND[columnKind(column)];
    const role = COLUMN_WIDTH[widthOf(column)];
    const pad = gutter.has(column)
      ? `padding-inline-start:calc(var(--table-cell-padding-x) + ${GUTTER_PX}px);`
      : '';
    const size =
      role.kind === 'rest'
        ? `width:${share};max-width:0;min-width:var(--data-table-identity-min);`
        : `width:1px;white-space:nowrap;min-width:${steps(role.steps)};`;
    rules.push(`${cell}{text-align:${kind.align};${size}${pad}}`);
    if (role.kind === 'steps')
      rules.push(
        `${cell} > :is(.truncate, :has(.truncate)){width:max-content;max-width:${HUG_CAP}}`,
      );
    if (kind.tabular)
      rules.push(
        `${at(index + offset, 'tbody > tr:not([data-table-state])')}{font-variant-numeric:tabular-nums}`,
      );
  });
  if (hidden.length) {
    const cells = hidden.map((index) => at(index + offset, 'tr:not(:has(> [colspan]))'));
    rules.push(`${cells.join(',')}{display:none}`);
    const last = shown.at(-1);
    if (last && last !== columns.at(-1))
      rules.push(`${at(columns.indexOf(last) + offset)}{padding-inline-end:16px}`);
  }
  return rules.join('');
}

function steps(count: number) {
  return `calc(var(--spacing) * ${count})`;
}

const HEAD_CHAR_EM = 0.6;
const HEAD_MARK_PX = 16;
const CELL_PAD_PX = 12;
const EDGE_PAD_PX = 16;
const DATE_FLOOR_STEPS = 48;

type ColumnEdge = Readonly<{ first: boolean; last: boolean; gutter: boolean }>;

function labelFloor(column: DataTableColumn, edge: ColumnEdge): string | null {
  if (column.hideLabel || columnKind(column) === 'actions') return null;
  const chars = Math.max(column.label.length, column.sublabel?.length ?? 0);
  const mark = column.sort || column.order ? HEAD_MARK_PX : 0;
  const pad = (edge.first ? EDGE_PAD_PX : CELL_PAD_PX) + (edge.last ? EDGE_PAD_PX : CELL_PAD_PX);
  return `calc(${chars} * ${HEAD_CHAR_EM} * var(--text-caption) + ${mark + pad}px)`;
}

export function fitFloor(column: DataTableColumn, edge: ColumnEdge): string {
  const role = COLUMN_WIDTH[widthOf(column)];
  const parts = [role.kind === 'steps' ? steps(role.steps) : 'var(--data-table-identity-min)'];
  if (role.kind === 'rest' && 'steps' in role) parts.push(steps(role.steps));
  if (columnKind(column) === 'date') parts.push(steps(DATE_FLOOR_STEPS));
  const label = labelFloor(column, edge);
  if (label) parts.push(label);
  const floor = `max(${parts.join(', ')})`;
  return edge.gutter ? `calc(${floor} + ${GUTTER_PX}px)` : floor;
}

export function withEdges(columns: readonly DataTableColumn[], selection: boolean) {
  const gutter = gutters(columns);
  return columns.map((column, index) => ({
    column,
    edge: {
      first: !selection && index === 0,
      last: index === columns.length - 1,
      gutter: gutter[index] ?? false,
    },
  }));
}

export const SELECT_WIDTH = steps(SELECT_STEPS);

export function DataTableColumns({
  columns,
  selection,
}: Readonly<{ columns: readonly DataTableColumn[]; selection?: DataTableSelection }>) {
  return (
    <TableHeader>
      <TableRow>
        {selection ? <SelectAllHead selection={selection} /> : null}
        {columns.map((column) => (
          <ColumnHead key={column.key} column={column} />
        ))}
      </TableRow>
    </TableHeader>
  );
}

function SelectAllHead({ selection }: Readonly<{ selection: DataTableSelection }>) {
  return (
    <TableHead>
      <Checkbox
        aria-label={`Select all ${selection.noun}`}
        checked={selection.all}
        onCheckedChange={(checked) => selection.onAllChange(checked === true)}
      />
    </TableHead>
  );
}

function ColumnHead({ column }: Readonly<{ column: DataTableColumn }>) {
  const numeric = columnKind(column) === 'number';
  if (column.sort) {
    return (
      <SortableTableHead
        label={column.label}
        numeric={numeric}
        sublabel={column.sublabel}
        hint={column.hint}
        desktopOnly={column.desktopOnly}
        {...column.sort}
      />
    );
  }
  if (column.hint) {
    return (
      <HintedTableHead
        label={column.label}
        hint={column.hint}
        numeric={numeric}
        desktopOnly={column.desktopOnly}
      />
    );
  }
  const hidden = column.hideLabel || columnKind(column) === 'actions';
  return (
    <TableHead numeric={numeric} desktopOnly={column.desktopOnly} aria-sort={column.order}>
      {hidden ? <span className="sr-only">{column.label || 'Actions'}</span> : column.label}
      {column.order ? <OrderMark order={column.order} /> : null}
      {column.sublabel ? (
        <span className={textRole('caption', 'block')}>{column.sublabel}</span>
      ) : null}
    </TableHead>
  );
}

function OrderMark({ order }: Readonly<{ order: 'ascending' | 'descending' }>) {
  const Arrow = order === 'descending' ? ArrowDown : ArrowUp;
  return <Arrow className="ms-1 inline size-3 align-[-1px]" aria-hidden />;
}
