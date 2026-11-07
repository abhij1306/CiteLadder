'use client';

import { Archive, Check, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';

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
import type { Prompt, PromptStatus } from '@citeladder/contracts';
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
};

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
  onEdit,
  onDelete,
  onToggleEnabled,
  onSetStatus,
  busyId,
  measurements,
}: Readonly<{
  prompts: Prompt[];
  onEdit: (prompt: Prompt) => void;
  onDelete: (prompt: Prompt) => void;
  onToggleEnabled: (prompt: Prompt) => void;
  onSetStatus?: (prompt: Prompt, status: PromptStatus) => void;
  busyId?: string | null;
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
      columns={promptColumns(measured)}
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
                  <MenuItem
                    icon={<Icon icon={Check} />}
                    onSelect={() => onSetStatus(prompt, 'active')}
                  >
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
                <MenuSeparator />
                <MenuItem icon={<Icon icon={Trash2} />} danger onSelect={() => onDelete(prompt)}>
                  Delete
                </MenuItem>
              </MenuContent>
            </Menu>
          </TableActionsCell>
        </TableRow>
      ))}
    </DataTable>
  );
}

/**
 * The measured columns are drawn only once a run exists. "Avg. mention
 * position" is a mean mention ordinal, not a competitive rank — the rankings
 * table owns that word — so it is named for what it measures.
 */
function promptColumns(measured: boolean): DataTableColumn[] {
  return [
    { key: 'prompt', label: 'Prompt' },
    ...(measured ? MEASURED_COLUMNS : []),
    { key: 'enabled', label: 'Enabled', width: 'control' },
    { key: 'actions', label: 'Actions', width: 'control', trailing: true },
  ];
}

const MEASURED_COLUMNS: readonly DataTableColumn[] = [
  { key: 'visibility', label: 'Visibility', width: 'figure', numeric: true },
  { key: 'owned', label: 'Owned citations', width: 'metric', numeric: true },
  {
    key: 'position',
    label: 'Avg. mention position',
    width: 'metric',
    numeric: true,
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
