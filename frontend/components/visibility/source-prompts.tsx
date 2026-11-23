import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { BrandMark } from '@/components/ui/brand-mark';
import { Button } from '@/components/ui/button';
import { EngineMark, engineMarkKey } from '@/components/ui/engine-mark';
import { Icon } from '@/components/ui/icon';
import type { EvidenceSubject } from '@/components/runs/answer-dialog';
import { useAnswerDialog } from '@/components/runs/answer-link';
import { DataTable, type DataTableColumn, type DataTableState } from '@/components/ui/data-table';
import { readErrorProps } from '@/components/ui/notice';
import { TitledSection } from '@/components/ui/section';
import { Inline } from '@/components/ui/layout';
import { TableCell, TableCellLines, TableRow } from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { textRole } from '@/components/ui/typography';
import { Absence } from '@/components/ui/absence';
import type {
  VisibilityEvidenceResponse,
  VisibilityExecutionEvidence,
} from '@citeladder/contracts';
import { MessageSquare, MessageSquareText } from '@/lib/icons';
import { visibilityQueries } from '@/lib/api/visibility-queries';
import { useEngineCatalog } from '@/lib/providers/engines';
import type { SourceFilters } from '@/components/visibility/source-rows';
import { count, hostOf, sinceLabel } from '@/lib/visibility/sources';
import type { SourceQueries } from '@/lib/visibility/use-source-analysis';
import { EVIDENCE_LIMIT } from '@/lib/visibility/use-visibility-dashboard';

function ObservedNone() {
  return <span className={textRole('caption', 'tabular-nums')}>0</span>;
}

const MAX_CHIPS = 3;

export function SourcePrompts({
  filters,
  queries,
  url,
}: Readonly<{
  filters: SourceFilters;
  queries: SourceQueries;
  url: string;
}>) {
  const params = {
    audit_id: queries.selectedRunIds ? undefined : (queries.activeRunId ?? undefined),
    audit_ids: queries.selectedRunIds,
    engine: filters.engine === 'all' ? undefined : filters.engine,
    topic: queries.topic,
    cohort: filters.cohort,
    url,
  };
  const query = useQuery({
    ...visibilityQueries.evidence(
      { workspaceId: queries.workspaceId, projectId: queries.projectId },
      params,
    ),
    enabled: Boolean(queries.activeRunId),
  });

  const answerDialog = useAnswerDialog();

  return (
    <>
      <TitledSection title="Prompts">
        <DataTable
          label="Prompts"
          columns={COLUMNS}
          state={promptsState(query)}
          busy={{ active: query.isFetching, label: 'Updating prompts' }}
          footer={query.data?.truncated ? `Newest ${EVIDENCE_LIMIT} shown` : null}
        >
          {(query.data?.items ?? []).map((item) => (
            <PromptRow key={item.analysis_id} item={item} onOpenAnswer={answerDialog.open} />
          ))}
        </DataTable>
      </TitledSection>
      {answerDialog.dialog}
    </>
  );
}

const COLUMNS: readonly DataTableColumn[] = [
  { key: 'prompt', label: 'Prompt' },
  { key: 'citations', label: 'Citations', width: 'figure', kind: 'number' },
  { key: 'mentioned', label: 'Mentioned', width: 'status', desktopOnly: true },
  { key: 'sources', label: 'Sources', width: 'status', desktopOnly: true },
  { key: 'created', label: 'Created', width: 'figure', kind: 'date', desktopOnly: true },
  { key: 'open', label: 'Open', width: 'status', hideLabel: true },
];

function promptsState(
  query: UseQueryResult<VisibilityEvidenceResponse, unknown>,
): DataTableState | undefined {
  if (query.isError) {
    return {
      kind: 'error',
      ...readErrorProps(query),
      title: "Couldn't load the tracked answers",
      fallback: 'The request failed or timed out.',
    };
  }
  if (!query.data) return { kind: 'loading', label: 'Loading prompts…' };
  if (query.data.items.length) return undefined;
  return {
    kind: 'empty',
    headingLevel: 3,
    icon: MessageSquare,
    heading: 'No tracked answers in this selection used this source',
  };
}

function EngineLogo({ engine }: Readonly<{ engine: string }>) {
  const key = engineMarkKey(engine);
  return key ? <EngineMark engine={key} className="shrink-0" /> : null;
}

function PromptRow({
  item,
  onOpenAnswer,
}: Readonly<{
  item: VisibilityExecutionEvidence;
  onOpenAnswer: (subject: EvidenceSubject) => void;
}>) {
  const engines = useEngineCatalog();
  return (
    <TableRow>
      <TableCell>
        <Inline as="span">
          <EngineLogo engine={item.logical_engine} />
          <TableCellLines
            primary={item.prompt_text || 'Untitled prompt'}
            secondary={engines.label(item.logical_engine)}
          />
        </Inline>
      </TableCell>
      <TableCell numeric>{count(item.citations.length) ?? '0'}</TableCell>
      <TableCell desktopOnly>
        <MentionChips item={item} />
      </TableCell>
      <TableCell desktopOnly>
        <SourceChips item={item} />
      </TableCell>
      <TableCell numeric desktopOnly>
        {sinceLabel(item.completed_at) ?? <Absence />}
      </TableCell>
      <TableCell>
        <Button
          variant="quiet"
          onClick={() =>
            onOpenAnswer({
              id: item.task_id,
              prompt_text: item.prompt_text,
              prompt_index: item.prompt_index,
              prompt_id: item.prompt_id,
            })
          }
        >
          <Icon icon={MessageSquareText} />
          Open answer
        </Button>
      </TableCell>
    </TableRow>
  );
}

function MentionChips({ item }: Readonly<{ item: VisibilityExecutionEvidence }>) {
  const named = [...new Map(item.mentions.map((one) => [one.name, one])).values()];
  if (!named.length) return <ObservedNone />;
  return (
    <ChipRow overflow={named.length - MAX_CHIPS}>
      {named.slice(0, MAX_CHIPS).map((mention) => (
        <Tooltip key={`${mention.kind}:${mention.name}`} content={mention.name}>
          <span className="inline-flex">
            <BrandMark
              name={mention.name || 'Brand'}
              logoUrl={mention.logo_url}
              websiteUrl={mention.website_url}
              placement="inline"
            />
          </span>
        </Tooltip>
      ))}
    </ChipRow>
  );
}

function SourceChips({ item }: Readonly<{ item: VisibilityExecutionEvidence }>) {
  const hosts = [...new Set(item.citations.flatMap((citation) => hostOf(citation.url) || []))];
  if (!hosts.length) return <ObservedNone />;
  return (
    <ChipRow overflow={hosts.length - MAX_CHIPS}>
      {hosts.slice(0, MAX_CHIPS).map((host) => (
        <Tooltip key={host} content={host}>
          <span className="inline-flex">
            <BrandMark
              name={host}
              websiteUrl={`https://${host}`}
              placement="inline"
              entity="site"
            />
          </span>
        </Tooltip>
      ))}
    </ChipRow>
  );
}

function ChipRow({ children, overflow }: Readonly<{ children: ReactNode; overflow: number }>) {
  return (
    <Inline as="span" gap="tight">
      {children}
      {overflow > 0 ? (
        <span className={textRole('caption', 'text-ink-2 tabular-nums')}>+{overflow}</span>
      ) : null}
    </Inline>
  );
}
