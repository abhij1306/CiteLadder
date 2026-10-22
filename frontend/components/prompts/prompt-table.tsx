'use client';

import { useMemo } from 'react';
import { Archive, Check, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';

import { ProjectLink } from '@/components/layout/scoped-link';
import { IconButton } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Delta } from '@/components/ui/delta';
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownSeparator,
  DropdownTrigger,
} from '@/components/ui/dropdown';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { TableActionsCell, TableCell, TableCellLines, TableRow } from '@/components/ui/table';
import { pageNumberControls, useTablePage } from '@/components/ui/pager';
import { Switch } from '@/components/ui/switch';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import type { Prompt, PromptStatus, Topic } from '@/lib/api/types';
import { ICONS } from '@/lib/icons';
import { buyerStageLabels, intentLabels } from '@/lib/prompts/forms';
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
 * Prompt table. Questions, topics, measured visibility and enabled state;
 * classification is secondary detail, with per-row actions (edit, delete,
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
  topics,
}: Readonly<{
  prompts: Prompt[];
  /** The project's topics, to name each row's topic (users' vocabulary, not theme). */
  topics: readonly Topic[];
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
  const topicNames = useMemo(
    () => new Map(topics.map((topic) => [topic.id, topic.name])),
    [topics],
  );

  return (
    <DataTable
      label="Prompts"
      minWidth={measured ? 'xl' : 'md'}
      columns={promptColumns(measured)}
      pageSize={PAGE_SIZE}
      rowCount={pagedPrompts.length}
      rowLines={2}
      state={
        prompts.length === 0
          ? {
              kind: 'empty',
              icon: ICONS.prompts,
              headingLevel: 3,
              heading: 'No prompts match your search or filters.',
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
            {/* The question opens its history: the prompt is the object. Its
                topic and classification are the caption under it, so the
                question keeps the table's width (each line is cut with the
                whole text in a tooltip). */}
            <TableCellLines
              title
              primary={
                <ProjectLink
                  href={promptHistoryHref(prompt.id)}
                  className="text-foreground hover:underline"
                >
                  {prompt.text}
                </ProjectLink>
              }
              secondary={promptCaption(prompt, topicNames)}
            />
          </TableCell>
          {measured ? <MeasuredCells measurement={measurements?.get(prompt.id)} /> : null}
          <TableCell>
            <Inline as="span">
              <Switch
                checked={prompt.enabled}
                label={`${prompt.enabled ? 'Disable' : 'Enable'} prompt`}
                disabled={busyId === prompt.id}
                onCheckedChange={() => onToggleEnabled(prompt)}
              />
            </Inline>
          </TableCell>
          <TableActionsCell>
            <Dropdown>
              <DropdownTrigger asChild>
                <IconButton icon={MoreHorizontal} label="Prompt actions" />
              </DropdownTrigger>
              <DropdownContent align="end">
                {onSetStatus && prompt.status === 'archived' ? (
                  <DropdownItem onSelect={() => onSetStatus(prompt, 'active')}>
                    <Icon icon={Check} />
                    Restore
                  </DropdownItem>
                ) : null}
                <DropdownItem onSelect={() => onEdit(prompt)}>
                  <Icon icon={Pencil} />
                  Edit
                </DropdownItem>
                {onSetStatus && prompt.status !== 'archived' ? (
                  <DropdownItem onSelect={() => onSetStatus(prompt, 'archived')}>
                    <Icon icon={Archive} />
                    Archive
                  </DropdownItem>
                ) : null}
                <DropdownSeparator />
                <DropdownItem
                  onSelect={() => onDelete(prompt)}
                  className="text-danger-text data-[highlighted]:bg-danger-bg"
                >
                  <Icon icon={Trash2} />
                  Delete
                </DropdownItem>
              </DropdownContent>
            </Dropdown>
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
    // A switch, and the "Not measured" badge beside it after a downgrade.
    { key: 'enabled', label: 'Enabled', width: 'category' },
    { key: 'actions', label: 'Actions', width: 'action', numeric: true },
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

/**
 * The prompt's topic, whether it names a brand, then its intent, buyer stage
 * and persona when set: one caption line. A prompt filed under a topic the
 * list cannot name (not loaded, or since deleted) says the topic is
 * unavailable, apart from a prompt filed under none.
 */
function promptCaption(prompt: Prompt, topicNames: ReadonlyMap<string, string>): string {
  const topic = prompt.topic_id
    ? (topicNames.get(prompt.topic_id) ?? 'Topic unavailable')
    : 'No topic';
  return [
    topic,
    prompt.branded ? 'Branded' : 'Unbranded',
    prompt.intent ? intentLabels[prompt.intent] : null,
    prompt.buyer_stage ? buyerStageLabels[prompt.buyer_stage] : null,
    prompt.persona,
  ]
    .filter(Boolean)
    .join(' · ');
}

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
