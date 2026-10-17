'use client';

import { useMemo } from 'react';
import { Archive, Check, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';

import { ProjectLink } from '@/components/layout/scoped-link';
import { Tag } from '@/components/ui/tag';
import { Button } from '@/components/ui/button';
import { Delta } from '@/components/ui/delta';
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownSeparator,
  DropdownTrigger,
} from '@/components/ui/dropdown';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Pager, pageNumberControls, useTablePage } from '@/components/ui/pager';
import { Tooltip } from '@/components/ui/tooltip';
import { Switch } from '@/components/ui/switch';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import type { Prompt, PromptStatus, Topic } from '@/lib/api/types';
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
    <>
      {/* Fixed layout: paging or filtering never resizes the columns. */}
      <Table minWidth="xl" fixed>
        <TableHeader>
          <TableRow>
            <TableHead>Prompt</TableHead>
            <TableHead className="w-40">Topic</TableHead>
            <TableHead className="w-56">Tags</TableHead>
            {measured ? (
              <TableHead numeric className="w-24">
                Visibility
              </TableHead>
            ) : null}
            {measured ? (
              <TableHead numeric className="w-36">
                Owned citations
              </TableHead>
            ) : null}
            {/* A mean mention ordinal, not a competitive rank — the rankings
                table owns that word. Named for what it measures. */}
            {measured ? (
              <TableHead numeric className="w-44">
                Avg. mention position
              </TableHead>
            ) : null}
            {measured ? (
              <TableHead numeric className="w-24">
                Change
              </TableHead>
            ) : null}
            <TableHead className="w-40">Enabled</TableHead>
            <TableHead className="w-16 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pagedPrompts.map((prompt) => (
            <TableRow key={prompt.id}>
              <TableCell>
                {/* The question is held to two lines, so the tooltip carries the
                    whole question. */}
                <Tooltip content={prompt.text}>
                  {/* The question opens its history: the prompt is the object. */}
                  <ProjectLink
                    href={promptHistoryHref(prompt.id)}
                    className="text-foreground line-clamp-2 break-words hover:underline"
                  >
                    {prompt.text}
                  </ProjectLink>
                </Tooltip>
              </TableCell>
              <TableCell>
                <TopicBadge name={prompt.topic_id ? topicNames.get(prompt.topic_id) : undefined} />
              </TableCell>
              <TableCell>
                <PromptTags prompt={prompt} />
              </TableCell>
              {measured ? <MeasuredCells measurement={measurements?.get(prompt.id)} /> : null}
              <TableCell>
                <span className="flex items-center gap-2">
                  <Switch
                    checked={prompt.enabled}
                    label={`${prompt.enabled ? 'Disable' : 'Enable'} prompt`}
                    disabled={busyId === prompt.id}
                    onCheckedChange={() => onToggleEnabled(prompt)}
                  />
                </span>
              </TableCell>
              <TableCell className="text-right">
                <Dropdown>
                  <DropdownTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="Prompt actions">
                      <MoreHorizontal className="size-4" aria-hidden />
                    </Button>
                  </DropdownTrigger>
                  <DropdownContent align="end">
                    {onSetStatus && prompt.status === 'archived' ? (
                      <DropdownItem onSelect={() => onSetStatus(prompt, 'active')}>
                        <Check className="size-4" aria-hidden />
                        Restore
                      </DropdownItem>
                    ) : null}
                    <DropdownItem onSelect={() => onEdit(prompt)}>
                      <Pencil className="size-4" aria-hidden />
                      Edit
                    </DropdownItem>
                    {onSetStatus && prompt.status !== 'archived' ? (
                      <DropdownItem onSelect={() => onSetStatus(prompt, 'archived')}>
                        <Archive className="size-4" aria-hidden />
                        Archive
                      </DropdownItem>
                    ) : null}
                    <DropdownSeparator />
                    <DropdownItem
                      onSelect={() => onDelete(prompt)}
                      className="text-danger-text data-[highlighted]:bg-danger-bg"
                    >
                      <Trash2 className="size-4" aria-hidden />
                      Delete
                    </DropdownItem>
                  </DropdownContent>
                </Dropdown>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pager
        frame="table"
        range={{ from, to, total: prompts.length, noun: 'prompts' }}
        {...pageNumberControls(page, pageCount, setPage)}
      />
    </>
  );
}

/** The row's topic; a prompt without one (or with a since-deleted one) has none. */
function TopicBadge({ name }: Readonly<{ name?: string }>) {
  if (!name) return <UnavailableValue state="not_set" />;
  return (
    <Tooltip content={name}>
      <Tag tone="blue" className="max-w-full">
        <span className="min-w-0 truncate">{name}</span>
      </Tag>
    </Tooltip>
  );
}

/** Whether the prompt names a brand, then its intent, buyer stage and persona when set. */
function PromptTags({ prompt }: Readonly<{ prompt: Prompt }>) {
  return (
    <span className="flex flex-wrap gap-1">
      <Tag tone={prompt.branded ? 'amber' : 'neutral'}>
        {prompt.branded ? 'Branded' : 'Unbranded'}
      </Tag>
      {prompt.intent ? <Tag tone="outline">{intentLabels[prompt.intent]}</Tag> : null}
      {prompt.buyer_stage ? <Tag tone="outline">{buyerStageLabels[prompt.buyer_stage]}</Tag> : null}
      {prompt.persona ? <Tag tone="outline">{prompt.persona}</Tag> : null}
    </span>
  );
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
