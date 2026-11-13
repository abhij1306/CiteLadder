import { Archive, Check, FileSearch, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';

import type { PromptAnswerRef } from '@/components/prompts/prompt-evidence';
import { ProjectLink } from '@/components/ui/project-link';
import { IconButton } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Delta } from '@/components/ui/delta';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { TableActionsCell, TableCell, TableCellLines, TableRow } from '@/components/ui/table';
import { pageNumberControls, useTablePage } from '@/components/ui/pager';
import { Switch } from '@/components/ui/switch';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import { NamedBrandMarks } from '@/components/visibility/named-brand-marks';
import type { NamedBrand, Prompt, PromptStatus } from '@citeladder/contracts';
import { ICONS } from '@/lib/icons';
import { promptHistoryHref } from '@/lib/prompts/history';
import { formatPosition, formatPositionExact, formatRate } from '@/lib/visibility/dashboard';

/** What the latest run measured for one prompt, keyed by prompt id. */
export type PromptMeasurement = {
  visibilityRate: number | null;
  /** Answers citing an owned page, over the prompt's successful answers. */
  ownedCitationRate: number | null;
  change: number | null;
  position: number | null;
  /** Distinct brands named in the answers; `brands` is the leading few. */
  mentions: number;
  brands: readonly NamedBrand[];
  /** Where that run asked the prompt, for the row's Evidence. */
  answer: PromptAnswerRef;
};

/** What a prompt row's controls do. */
export type PromptRowActions = Readonly<{
  onEdit: (prompt: Prompt) => void;
  onDelete: (prompt: Prompt) => void;
  onToggleEnabled: (prompt: Prompt) => void;
  onSetStatus?: (prompt: Prompt, status: PromptStatus) => void;
  /** Opens the answers the latest run got for a measured prompt. */
  onEvidence?: (prompt: Prompt, answer: PromptAnswerRef) => void;
  busyId?: string | null;
}>;

/** Rows per page on the prompt table (client-side; the list arrives whole). */
const PAGE_SIZE = 10;

/**
 * Prompt table (F7). Questions, measured visibility and enabled state, with
 * per-row actions (edit, delete,
 * enable/disable toggle, and — when `onSetStatus` is wired — archive or restore
 * transitions).
 *
 * The measured columns arrive as a map rather than being fetched here: the
 * prompt IS the object a reader is looking at, so its result belongs on this
 * row. It previously lived in a "Prompt analysis" card on the Visibility
 * dashboard, where the prompt was a detail of a measurement instead.
 * Client-side pagination footer
 * (tabular page indicator + ghost buttons) per the prompts frame. Purely
 * presentational — CRUD is delegated to callbacks owned by the page.
 */
export function PromptTable({
  prompts,
  actions,
  measurements,
}: Readonly<{
  prompts: Prompt[];
  /**
   * The row controls, for a role that may edit prompts. Without them the
   * table states each prompt's enabled state and offers no control.
   */
  actions?: PromptRowActions;
  /** Latest-run measurement per prompt id. Omitted before any run exists. */
  measurements?: ReadonlyMap<string, PromptMeasurement>;
}>) {
  // With no run there is nothing measured for ANY prompt, so the columns are
  // not drawn at all rather than filling with placeholders.
  const measured = Boolean(measurements?.size);
  const { page, setPage, pageCount, from, to } = useTablePage(prompts.length, PAGE_SIZE);
  const pagedPrompts = prompts.slice(from - 1, to);

  return (
    <DataTable
      label="Prompts"
      // Every column fits the page from the owner's 982px desktop up; below
      // that the table scrolls with the prompt pinned.
      minWidth={measured ? 'md' : 'sm'}
      pinFirstColumn
      columns={promptColumns(measured, actions !== undefined)}
      pageSize={PAGE_SIZE}
      rowCount={pagedPrompts.length}
      rowLines={3}
      state={
        prompts.length === 0
          ? {
              kind: 'empty',
              icon: ICONS.prompts,
              headingLevel: 3,
              heading: 'No prompts match your search or filters',
            }
          : undefined
      }
      pager={{
        range: { from, to, total: prompts.length, noun: 'prompts' },
        ...pageNumberControls(page, pageCount, setPage),
      }}
    >
      {pagedPrompts.map((prompt) => (
        <TableRow key={prompt.id}>
          <TableCell>
            {/* The question opens its history: the prompt is the object. It
                wraps to two lines. Topic and classification are filters in
                the control strip, not tags on every row (owner, 2026-11-06);
                the caption only says when audits skip the prompt. */}
            <TableCellLines
              title
              primary={
                <ProjectLink
                  href={promptHistoryHref(prompt.id)}
                  className="text-ink hover:underline"
                >
                  {prompt.text}
                </ProjectLink>
              }
            />
          </TableCell>
          {measured ? <MeasuredCells measurement={measurements?.get(prompt.id)} /> : null}
          {actions ? (
            <PromptRowControls
              prompt={prompt}
              actions={actions}
              onEvidence={evidenceOpener(prompt, measurements?.get(prompt.id), actions)}
            />
          ) : (
            <TableCell>{prompt.enabled ? 'Yes' : 'No'}</TableCell>
          )}
        </TableRow>
      ))}
    </DataTable>
  );
}

/** Opens the latest run's answers to a measured prompt; nothing for an unmeasured one. */
function evidenceOpener(
  prompt: Prompt,
  measurement: PromptMeasurement | undefined,
  { onEvidence }: PromptRowActions,
) {
  if (!measurement || !onEvidence) return undefined;
  return () => onEvidence(prompt, measurement.answer);
}

/** The enabled switch and the actions menu of one editable row. */
function PromptRowControls({
  prompt,
  actions: { onEdit, onDelete, onToggleEnabled, onSetStatus, busyId },
  onEvidence,
}: Readonly<{
  prompt: Prompt;
  actions: PromptRowActions;
  /** Opens the latest run's answers; absent for a prompt no run has measured. */
  onEvidence?: () => void;
}>) {
  return (
    <>
      <TableCell>
        <Switch
          checked={prompt.enabled}
          label={`${prompt.enabled ? 'Disable' : 'Enable'} prompt`}
          disabled={busyId === prompt.id}
          onCheckedChange={() => onToggleEnabled(prompt)}
        />
      </TableCell>
      <TableActionsCell>
        <Menu>
          <MenuTrigger asChild>
            <IconButton icon={MoreHorizontal} label="Prompt actions" />
          </MenuTrigger>
          <MenuContent align="end">
            {onSetStatus && prompt.status === 'archived' ? (
              <MenuItem icon={<Icon icon={Check} />} onSelect={() => onSetStatus(prompt, 'active')}>
                Restore
              </MenuItem>
            ) : null}
            <MenuItem icon={<Icon icon={Pencil} />} onSelect={() => onEdit(prompt)}>
              Edit
            </MenuItem>
            {onSetStatus && prompt.status !== 'archived' ? (
              <MenuItem
                icon={<Icon icon={Archive} />}
                onSelect={() => onSetStatus(prompt, 'archived')}
              >
                Archive
              </MenuItem>
            ) : null}
            {onEvidence ? (
              <MenuItem icon={<Icon icon={FileSearch} />} onSelect={onEvidence}>
                Evidence
              </MenuItem>
            ) : null}
            <MenuSeparator />
            <MenuItem icon={<Icon icon={Trash2} />} danger onSelect={() => onDelete(prompt)}>
              Delete
            </MenuItem>
          </MenuContent>
        </Menu>
      </TableActionsCell>
    </>
  );
}

/**
 * The measured columns are drawn only once a run exists. The headers are one
 * word (owner, 2026-11-11); each hint says exactly what its figure measures.
 * A reader who may not edit reads the enabled state as text, with no actions.
 */
function promptColumns(measured: boolean, editable: boolean): DataTableColumn[] {
  const columns: DataTableColumn[] = [
    { key: 'prompt', label: 'Prompt' },
    ...(measured ? MEASURED_COLUMNS : []),
    { key: 'enabled', label: 'Enabled', width: 'control' },
  ];
  if (editable)
    columns.push({ key: 'actions', label: 'Actions', width: 'control', trailing: true });
  return columns;
}

const MEASURED_COLUMNS: readonly DataTableColumn[] = [
  { key: 'visibility', label: 'Visibility', width: 'figure', numeric: true },
  {
    key: 'mentions',
    label: 'Mentions',
    width: 'status',
    hint: "The brands named in this prompt's answers: yours and your competitors'.",
  },
  {
    key: 'citations',
    label: 'Citations',
    width: 'figure',
    numeric: true,
    hint: "The share of this prompt's answers that cited one of your pages.",
  },
  {
    key: 'position',
    label: 'Position',
    width: 'figure',
    numeric: true,
    hint: 'Where your brand was named among the brands in an answer, averaged over the answers that named it.',
  },
  { key: 'change', label: 'Change', width: 'figure', numeric: true },
];

/** A prompt's measured visibility, and its movement since the last run. */
function MeasuredCells({ measurement }: Readonly<{ measurement?: PromptMeasurement }>) {
  return (
    <>
      <TableCell numeric>
        {measurement ? (
          formatRate(measurement.visibilityRate)
        ) : (
          <UnavailableValue state="not_measured" />
        )}
      </TableCell>
      <TableCell>
        {measurement ? (
          <NamedBrandMarks
            brands={measurement.brands}
            total={measurement.mentions}
            answers="this prompt's answers"
          />
        ) : (
          <UnavailableValue state="not_measured" />
        )}
      </TableCell>
      <TableCell numeric>
        {measurement ? (
          formatRate(measurement.ownedCitationRate)
        ) : (
          <UnavailableValue state="not_measured" />
        )}
      </TableCell>
      <TableCell numeric>
        {measurement?.position == null ? (
          <UnavailableValue state="not_measured" />
        ) : (
          <span
            title={`Average of ${formatPositionExact(measurement.position)} across this prompt's answers`}
          >
            {formatPosition(measurement.position)}
          </span>
        )}
      </TableCell>
      <TableCell numeric>
        {measurement?.change == null ? (
          <UnavailableValue state="not_measured" />
        ) : (
          <Delta value={measurement.change} unit=" pp" />
        )}
      </TableCell>
    </>
  );
}
