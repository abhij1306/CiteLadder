import {
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { DataTable, type DataTableColumn, type DataTableState } from '@/components/ui/data-table';
import { BrandMark } from '@/components/ui/brand-mark';
import { Inline, Stack } from '@/components/ui/layout';
import { Notice, readErrorProps } from '@/components/ui/notice';
import { TitledSection } from '@/components/ui/section';
import { TableActionsCell, TableCell, TableCellLines, TableRow } from '@/components/ui/table';
import { Tag } from '@/components/ui/tag';
import { useToast } from '@/components/ui/toast';
import type { ObservedCompetitor } from '@citeladder/contracts';
import { ProjectLink } from '@/components/ui/project-link';
import { UserPlus, X } from '@/lib/icons';
import { brandDiscoveryQueries } from '@/lib/api/brand-discoveries';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { visibilityMutations } from '@/lib/api/visibility-queries';
import { formatCount, pluralCount } from '@/lib/format';
import { useActiveWorkspaceId, useWorkspaceCapability } from '@/lib/project/project-context';

const TITLE = 'Suggested competitors';

const FOUND_BY = {
  cited_domain: 'Cited domain',
  named_in_answers: 'Named in answers',
} satisfies Record<ObservedCompetitor['kind'], string>;

function seenIn(candidate: ObservedCompetitor): string {
  switch (candidate.kind) {
    case 'cited_domain':
      return pluralCount(candidate.citation_count, 'citation');
    case 'named_in_answers':
      return pluralCount(candidate.prompt_count, 'prompt');
    default: {
      const unknown: never = candidate;
      return unknown;
    }
  }
}

const engines = ({ engine_count: count, engine_total: total }: ObservedCompetitor) =>
  `${formatCount(count)} of ${formatCount(total)}`;

export function CompetitorSuggestions({
  projectId,
  tracked,
  suggestionsQuery,
}: Readonly<{
  projectId: string;
  tracked: number;
  suggestionsQuery: UseQueryResult<ObservedCompetitor[], unknown>;
}>) {
  const workspaceId = useActiveWorkspaceId();
  const { notify } = useToast();
  const acceptMutation = useMutation(
    visibilityMutations.acceptCompetitorSuggestion({ workspaceId, projectId }),
  );
  const rejectMutation = useMutation(
    visibilityMutations.rejectCompetitorSuggestion({ workspaceId, projectId }),
  );
  const limit = useQuery(brandDiscoveryQueries.catalog(workspaceId)).data?.maximum_competitors;
  const full = limit !== undefined && tracked >= limit;
  const canWrite = useWorkspaceCapability('write');
  const rows = suggestionsQuery.data ?? [];
  const deciding = acceptMutation.isPending || rejectMutation.isPending;
  return (
    <TitledSection title={TITLE} description={sectionDescription(tracked, limit)}>
      <Stack>
        {canWrite && full && rows.length > 0 ? (
          <Notice
            tone="info"
            standing
            action={
              <Button variant="secondary" asChild>
                <ProjectLink href="/agent/context?tab=competitors">Edit competitors</ProjectLink>
              </Button>
            }
          >
            {`Your project tracks the maximum of ${formatCount(limit)} competitors. Remove one to accept a suggestion.`}
          </Notice>
        ) : null}
        <DecisionFailure mutation={acceptMutation} action="add that competitor" />
        <DecisionFailure mutation={rejectMutation} action="reject that suggestion" />
        <DataTable label={TITLE} columns={columns(canWrite)} state={tableState(suggestionsQuery)}>
          {rows.map((candidate) => (
            <TableRow key={candidate.id}>
              <TableCell>
                <Inline as="span">
                  <BrandMark
                    name={candidate.name}
                    websiteUrl={
                      candidate.kind === 'cited_domain' ? `https://${candidate.domain}` : null
                    }
                  />
                  <TableCellLines
                    title
                    primary={candidate.name}
                    secondary={candidate.kind === 'cited_domain' ? candidate.domain : undefined}
                  />
                </Inline>
              </TableCell>
              <TableCell>
                <Tag>{FOUND_BY[candidate.kind]}</Tag>
              </TableCell>
              <TableCell numeric>{seenIn(candidate)}</TableCell>
              <TableCell numeric>{engines(candidate)}</TableCell>
              {canWrite ? (
                <TableActionsCell>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      acceptMutation.mutate(candidate.id, {
                        onSuccess: () => notify(`${candidate.name} added to your competitors`),
                      })
                    }
                    disabled={deciding || full}
                    aria-label={`Accept ${candidate.name} as a competitor`}
                  >
                    Accept
                  </Button>
                  <Button
                    variant="quiet"
                    onClick={() =>
                      rejectMutation.mutate(candidate.id, {
                        onSuccess: () => notify(`${candidate.name} won't be suggested again`),
                      })
                    }
                    disabled={deciding}
                    aria-label={`Reject ${candidate.name} as a competitor`}
                  >
                    <Icon icon={X} />
                    Reject
                  </Button>
                </TableActionsCell>
              ) : null}
            </TableRow>
          ))}
        </DataTable>
      </Stack>
    </TitledSection>
  );
}

function sectionDescription(tracked: number, limit: number | undefined): string | undefined {
  return limit === undefined
    ? undefined
    : `${formatCount(tracked)} of ${formatCount(limit)} tracked`;
}

function DecisionFailure({
  mutation,
  action,
}: Readonly<{
  mutation: UseMutationResult<unknown, Error, string>;
  action: string;
}>) {
  const candidateId = mutation.variables;
  if (!mutation.isError || candidateId === undefined) return null;
  return (
    <Notice
      kind="mutation"
      notice={mutationNoticeForError(mutation.error, { action })}
      onRetry={() => mutation.mutate(candidateId)}
    />
  );
}

function columns(canWrite: boolean): DataTableColumn[] {
  return [
    { key: 'name', label: 'Name', kind: 'identity' },
    { key: 'found', label: 'Found by', kind: 'status', width: 'category' },
    { key: 'seen', label: 'Seen in', kind: 'number', width: 'metric' },
    { key: 'engines', label: 'Engines', kind: 'number' },
    ...(canWrite ? [{ key: 'actions', label: 'Actions', kind: 'actions' } as const] : []),
  ];
}

function tableState(
  query: UseQueryResult<ObservedCompetitor[], unknown>,
): DataTableState | undefined {
  if (query.isError)
    return {
      kind: 'error',
      ...readErrorProps(query),
      title: "Couldn't load competitor suggestions",
      fallback: 'The request failed or timed out.',
    };
  if (query.isPending) return { kind: 'loading', label: 'Loading suggestions…' };
  if (!query.data.length)
    return {
      kind: 'empty',
      headingLevel: 3,
      icon: UserPlus,
      heading: 'No suggested competitors yet.',
    };
  return undefined;
}
