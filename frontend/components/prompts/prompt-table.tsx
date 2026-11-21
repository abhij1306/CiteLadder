import { useNavigate } from 'react-router-dom';

import type { PromptAnswerRef } from '@/components/prompts/prompt-evidence';
import { TextLink } from '@/components/ui/text-link';
import { IconButton } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Delta } from '@/components/ui/delta';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { DataTable, type DataTableColumn, type DataTableState } from '@/components/ui/data-table';
import {
  isRowSurfaceClick,
  TableActionsCell,
  TableCell,
  TableCellLines,
  TableRow,
  TableSelectCell,
} from '@/components/ui/table';
import { pageNumberControls, useTablePage } from '@/components/ui/pager';
import { Absence } from '@/components/ui/absence';
import { ClampText } from '@/components/ui/clamp-text';
import { NamedBrandMarks } from '@/components/visibility/named-brand-marks';
import { SentimentValue } from '@/components/visibility/sentiment-value';
import type { NamedBrand, NetSentiment, Prompt, PromptStatus } from '@citeladder/contracts';
import { Archive, Check, ICONS, MoreHorizontal, Pencil, Power, Trash2 } from '@/lib/icons';
import { SHARE_OF_VOICE_HINT } from '@/lib/config/visibility';
import { useProjectHref } from '@/lib/navigation/project-destination';
import type { PromptMentions } from '@/lib/prompts/filter';
import { promptHistoryHref } from '@/lib/prompts/history';
import type { RowSelectionState } from '@/lib/prompts/selection';

import { CitedDomainMarks } from './cited-domain-marks';
import { NO_ANSWERS, NOT_MEASURED, positionAbsence } from './prompt-figures';
import { formatMean, percentText } from '@/lib/format';

export type PromptChange =
  | { kind: 'delta'; points: number }
  | { kind: 'first' }
  | { kind: 'not_compared'; reason: 'changed_context' | 'no_observations' };

export type PromptMeasurement = PromptMentions & {
  visibilityRate: number | null;
  ownedCitationRate: number | null;
  change: PromptChange;
  position: number | null;
  shareOfVoice: number | null;
  sentiment: NetSentiment | null;
  mentions: number;
  brands: readonly NamedBrand[];
  answer: PromptAnswerRef;
};

export type PromptRowActions = Readonly<{
  onEdit: (prompt: Prompt) => void;
  onDelete: (prompt: Prompt) => void;
  onToggleEnabled: (prompt: Prompt) => void;
  onSetStatus: (prompt: Prompt, status: PromptStatus) => void;
}>;

const PAGE_SIZE = 10;

function emptyState(rows: number, onClearFilters?: () => void): DataTableState | undefined {
  if (rows > 0) return undefined;
  const heading = 'No prompts match your search or filters';
  return onClearFilters
    ? { kind: 'filtered', headingLevel: 3, heading, onClear: onClearFilters }
    : { kind: 'empty', icon: ICONS.prompts, headingLevel: 3, heading };
}

export function PromptTable({
  prompts,
  actions,
  measurements,
  setNames,
  topicNames,
  commerceSetIds,
  selection,
  onClearFilters,
  onOpenAnswer,
  resetKey,
}: Readonly<{
  prompts: Prompt[];
  resetKey?: string;
  onClearFilters?: () => void;
  onOpenAnswer?: (prompt: Prompt, answer: PromptAnswerRef) => void;
  topicNames?: ReadonlyMap<string, string>;
  selection?: RowSelectionState;
  commerceSetIds?: ReadonlySet<string>;
  setNames?: ReadonlyMap<string, string>;
  actions?: PromptRowActions;
  measurements?: ReadonlyMap<string, PromptMeasurement>;
}>) {
  const hasRun = Boolean(measurements?.size);
  const compared = [...(measurements?.values() ?? [])].some(
    (measurement) => measurement.change.kind !== 'first',
  );
  const shelf = prompts.some((prompt) => commerceSetIds?.has(prompt.prompt_set_id));
  const measuredColumns = hasRun ? measuredColumnsFor({ compared, shelf }) : [];
  const { page, setPage, pageCount, from, to } = useTablePage(prompts.length, {
    pageSize: PAGE_SIZE,
    resetKey,
    urlKey: 'page',
  });
  const pagedPrompts = prompts.slice(from - 1, to);
  const pageIds = pagedPrompts.map((prompt) => prompt.id);
  const navigate = useNavigate();
  const projectHref = useProjectHref();

  return (
    <DataTable
      label="Prompts"
      columns={promptColumns(measuredColumns, actions !== undefined)}
      pageSize={PAGE_SIZE}
      rowCount={pagedPrompts.length}
      selection={
        selection
          ? {
              all: pageTicked(pageIds, selection.ids),
              onAllChange: (checked) => selection.togglePage(pageIds, checked),
              noun: 'prompts on this page',
            }
          : undefined
      }
      state={emptyState(prompts.length, onClearFilters)}
      pager={{
        range: { from, to, total: prompts.length, noun: 'prompts' },
        ...pageNumberControls(page, pageCount, setPage),
      }}
    >
      {pagedPrompts.map((prompt) => {
        const openAnswer = answerOpener(prompt, measurements?.get(prompt.id), onOpenAnswer);
        return (
          <TableRow
            key={prompt.id}
            className="cursor-pointer"
            onClick={(event) => {
              if (!isRowSurfaceClick(event)) return;
              if (openAnswer) openAnswer();
              else void navigate(projectHref(promptHistoryHref(prompt.id)));
            }}
          >
            {selection ? (
              <TableSelectCell
                label={`Select “${prompt.text}”`}
                checked={selection.ids.has(prompt.id)}
                onCheckedChange={(checked, range) => selection.toggle(prompt.id, checked, range)}
              />
            ) : null}
            <TableCell>
              <TableCellLines
                title
                primary={<PromptQuestion prompt={prompt} openAnswer={openAnswer} />}
                secondary={rowCaption(prompt, setNames?.get(prompt.prompt_set_id))}
              />
            </TableCell>
            <TableCell>
              <TopicName topicId={prompt.topic_id} names={topicNames} />
            </TableCell>
            {hasRun && commerceSetIds?.has(prompt.prompt_set_id) ? (
              <ShelfMeasuredCells columns={measuredColumns} />
            ) : null}
            {hasRun && !commerceSetIds?.has(prompt.prompt_set_id) ? (
              <MeasuredCells measurement={measurements?.get(prompt.id)} compared={compared} />
            ) : null}
            {actions ? <PromptRowMenu prompt={prompt} actions={actions} /> : null}
          </TableRow>
        );
      })}
    </DataTable>
  );
}

function pageTicked(
  pageIds: readonly string[],
  ids: ReadonlySet<string>,
): boolean | 'indeterminate' {
  const ticked = pageIds.filter((id) => ids.has(id)).length;
  if (ticked === 0) return false;
  return ticked === pageIds.length ? true : 'indeterminate';
}

function rowCaption(prompt: Prompt, setName: string | undefined): string | undefined {
  const parts = [
    setName,
    prompt.enabled || prompt.status === 'archived' ? '' : 'Disabled',
    prompt.over_plan_limit ? 'Beyond the plan limit' : '',
  ];
  return parts.filter(Boolean).join(' · ') || undefined;
}

function answerOpener(
  prompt: Prompt,
  measurement: PromptMeasurement | undefined,
  onOpenAnswer: ((prompt: Prompt, answer: PromptAnswerRef) => void) | undefined,
) {
  if (!measurement || !onOpenAnswer) return undefined;
  return () => onOpenAnswer(prompt, measurement.answer);
}

function PromptQuestion({
  prompt,
  openAnswer,
}: Readonly<{ prompt: Prompt; openAnswer: (() => void) | undefined }>) {
  return (
    <TextLink
      href={promptHistoryHref(prompt.id)}
      text="inherit"
      underline="hover"
      aria-haspopup={openAnswer ? 'dialog' : undefined}
      onClick={(event) => {
        const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
        if (!openAnswer || event.button !== 0 || modified) return;
        event.preventDefault();
        openAnswer();
      }}
    >
      {prompt.text}
    </TextLink>
  );
}

function TopicName({
  topicId,
  names,
}: Readonly<{ topicId: Prompt['topic_id']; names?: ReadonlyMap<string, string> }>) {
  if (!topicId) return <Absence state="none" label="No topic" />;
  const name = names?.get(topicId);
  if (name === undefined) return <Absence state="unavailable" />;
  return <ClampText className="text-ink-2">{name}</ClampText>;
}

function PromptRowMenu({
  prompt,
  actions: { onEdit, onDelete, onToggleEnabled, onSetStatus },
}: Readonly<{
  prompt: Prompt;
  actions: PromptRowActions;
}>) {
  return (
    <TableActionsCell>
      <Menu>
        <MenuTrigger asChild>
          <IconButton icon={MoreHorizontal} label="Prompt actions" />
        </MenuTrigger>
        <MenuContent align="end">
          {prompt.status === 'archived' ? (
            <MenuItem icon={<Icon icon={Check} />} onSelect={() => onSetStatus(prompt, 'active')}>
              Restore
            </MenuItem>
          ) : null}
          <MenuItem icon={<Icon icon={Pencil} />} onSelect={() => onEdit(prompt)}>
            Edit
          </MenuItem>
          {prompt.status === 'archived' ? null : (
            <MenuItem icon={<Icon icon={Power} />} onSelect={() => onToggleEnabled(prompt)}>
              {prompt.enabled ? 'Disable' : 'Enable'}
            </MenuItem>
          )}
          {prompt.status === 'archived' ? null : (
            <MenuItem
              icon={<Icon icon={Archive} />}
              onSelect={() => onSetStatus(prompt, 'archived')}
            >
              Archive
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuItem icon={<Icon icon={Trash2} />} danger onSelect={() => onDelete(prompt)}>
            Delete
          </MenuItem>
        </MenuContent>
      </Menu>
    </TableActionsCell>
  );
}

function promptColumns(
  measuredColumns: readonly DataTableColumn[],
  editable: boolean,
): DataTableColumn[] {
  const columns: DataTableColumn[] = [
    { key: 'prompt', label: 'Prompt', kind: 'identity', width: 'reading' },
    { key: 'topic', label: 'Topic', width: 'status' },
    ...measuredColumns,
  ];
  if (editable)
    columns.push({ key: 'actions', label: 'Actions', width: 'control', kind: 'actions' });
  return columns;
}

const VISIBILITY_COLUMN: DataTableColumn = {
  key: 'visibility',
  label: 'Visibility',
  width: 'figure',
  kind: 'number',
};

const SHELF_HINT =
  'Shopping prompts are measured with the shopping shelf on Shopping, not one prompt at a time, so their figures here are not applicable.';

const CHANGE_COLUMN: DataTableColumn = {
  key: 'change',
  label: 'Change',
  width: 'figure',
  kind: 'number',
  priority: 'low',
};

const MEASURED_COLUMNS: readonly DataTableColumn[] = [
  {
    key: 'mentions',
    label: 'Mentions',
    width: 'marks',
  },
  {
    key: 'citations',
    label: 'Citations',
    width: 'figure',
    kind: 'number',
    hint: "The share of this prompt's answers that cited one of your pages.",
  },
  {
    key: 'sources',
    label: 'Sources',
    width: 'marks',
  },
  {
    key: 'position',
    label: 'Position',
    width: 'figure',
    kind: 'number',
    priority: 'low',
    hint: 'Where your brand was named among the brands in an answer, averaged over the answers that named it.',
  },
  {
    key: 'sov',
    label: 'Share of voice',
    width: 'figure',
    kind: 'number',
    priority: 'low',
    hint: SHARE_OF_VOICE_HINT,
  },
  {
    key: 'sentiment',
    label: 'Sentiment',
    width: 'figure',
    kind: 'number',
    priority: 'low',
    hint: "Net sentiment toward your brand in this prompt's answers: positive minus negative mentions, as a share of the classified ones.",
  },
];

function measuredColumnsFor({
  compared,
  shelf,
}: Readonly<{ compared: boolean; shelf: boolean }>): readonly DataTableColumn[] {
  const visibility = shelf ? { ...VISIBILITY_COLUMN, hint: SHELF_HINT } : VISIBILITY_COLUMN;
  return [visibility, ...(compared ? [CHANGE_COLUMN] : []), ...MEASURED_COLUMNS];
}

function RateValue({
  measurement,
  rate,
}: Readonly<{ measurement?: PromptMeasurement; rate?: number | null }>) {
  if (!measurement) return NOT_MEASURED;
  return rate == null ? NO_ANSWERS : percentText(rate);
}

function MeasuredCells({
  measurement,
  compared,
}: Readonly<{ measurement?: PromptMeasurement; compared: boolean }>) {
  return (
    <>
      <TableCell numeric>
        <RateValue measurement={measurement} rate={measurement?.visibilityRate} />
      </TableCell>
      {compared ? (
        <TableCell numeric>
          <ChangeValue change={measurement?.change} />
        </TableCell>
      ) : null}
      <TableCell>
        {measurement ? (
          <NamedBrandMarks
            brands={measurement.brands}
            total={measurement.mentions}
            answers="this prompt's answers"
          />
        ) : (
          NOT_MEASURED
        )}
      </TableCell>
      <TableCell numeric>
        <RateValue measurement={measurement} rate={measurement?.ownedCitationRate} />
      </TableCell>
      <TableCell>
        {measurement ? (
          <CitedDomainMarks
            sources={measurement.visibilityRate === null ? null : measurement.sources}
          />
        ) : (
          NOT_MEASURED
        )}
      </TableCell>
      <FigureCells measurement={measurement} />
    </>
  );
}

function FigureCells({ measurement }: Readonly<{ measurement?: PromptMeasurement }>) {
  return (
    <>
      <TableCell numeric>
        <AveragePosition measurement={measurement} />
      </TableCell>
      <TableCell numeric>
        <ShareOfVoice measurement={measurement} />
      </TableCell>
      <TableCell numeric>
        {measurement?.sentiment ? (
          <SentimentValue sentiment={measurement.sentiment} tooFew="Too few" showCount={false} />
        ) : (
          NOT_MEASURED
        )}
      </TableCell>
    </>
  );
}

function ShareOfVoice({ measurement }: Readonly<{ measurement?: PromptMeasurement }>) {
  if (!measurement) return NOT_MEASURED;
  if (measurement.visibilityRate === null) return NO_ANSWERS;
  if (measurement.shareOfVoice === null)
    return <Absence state="none" reason="No tracked brand was named in these answers." />;
  return percentText(measurement.shareOfVoice);
}

function AveragePosition({ measurement }: Readonly<{ measurement?: PromptMeasurement }>) {
  if (!measurement) return NOT_MEASURED;
  if (measurement.position === null) return positionAbsence(measurement.visibilityRate);
  const position = formatMean(measurement.position);
  return <span title={`Average of ${position} across this prompt's answers`}>{position}</span>;
}

function ShelfMeasuredCells({ columns }: Readonly<{ columns: readonly DataTableColumn[] }>) {
  return columns.map((column) => (
    <TableCell key={column.key} numeric={column.kind === 'number'}>
      <Absence state="not_applicable" label="Measured with Shopping" />
    </TableCell>
  ));
}

const NOT_COMPARED = {
  changed_context:
    'Not comparable with its previous measurement: the run settings or prompt changed.',
  no_observations: 'Not comparable with its previous measurement: one of the runs had no answers.',
} as const satisfies Record<Extract<PromptChange, { kind: 'not_compared' }>['reason'], string>;

function ChangeValue({ change }: Readonly<{ change?: PromptChange }>) {
  if (change === undefined) return NOT_MEASURED;
  switch (change.kind) {
    case 'delta':
      return <Delta value={change.points} unit=" pp" />;
    case 'first':
      return (
        <Absence state="not_applicable" reason="First measurement: nothing earlier to compare." />
      );
    case 'not_compared':
      return <Absence state="unavailable" label="Unknown" reason={NOT_COMPARED[change.reason]} />;
    default: {
      const unhandled: never = change;
      return unhandled;
    }
  }
}
