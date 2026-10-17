'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { formatDisplayTimestamp, pluralCount } from '@/lib/format';
import { ReadError, readErrorProps } from '@/components/ui/read-error';
import { queryKeys } from '@/lib/api/query-keys';
import { runsApi } from '@/lib/api/runs';
import {
  searchIntelligenceApi,
  type SearchIntelligenceDataset,
} from '@/lib/api/search-intelligence';
import { useProjectContext } from '@/lib/project/project-context';
import { referringLists } from './search-intelligence-format';

export function SearchIntelligenceCitationMatcher({
  datasets,
  targetOrigin,
  onDerived,
}: Readonly<{
  datasets: SearchIntelligenceDataset[];
  /** The website the Backlinks tab shows; its list is the one matched first. */
  targetOrigin?: string;
  onDerived: () => Promise<unknown>;
}>) {
  const { activeProject } = useProjectContext();
  const timeZone = useDisplayTimeZone();
  const { notify } = useToast();
  const [selectedAudits, setSelectedAudits] = useState<string[]>([]);
  // The reader picks which website's list to match, starting from the one on screen.
  const lists = referringLists(datasets);
  const [listId, setListId] = useState('');
  // Never another site's list unless the reader picks it by name.
  const referring =
    lists.find((dataset) => dataset.id === listId) ??
    lists.find((dataset) => dataset.target_origin === targetOrigin);
  const audits = useQuery({
    queryKey: queryKeys.runs.list({ project_id: activeProject?.id }),
    queryFn: ({ signal }) =>
      runsApi.listAudits(
        { project_id: activeProject!.id },
        { signal, workspaceId: activeProject!.workspace_id },
      ),
    enabled: Boolean(activeProject && referring),
  });
  const derive = useMutation({
    mutationFn: () =>
      searchIntelligenceApi.deriveCitationMatches(
        activeProject!.id,
        referring!.id,
        selectedAudits,
        { workspaceId: activeProject!.workspace_id },
      ),
    onSuccess: async (dataset) => {
      setSelectedAudits([]);
      notify(
        'Citation matches saved',
        `${pluralCount(dataset.unique_rows_saved, 'citation')} came from sites that link to you. Open Citation matches in Backlinks.`,
      );
      await onDerived();
    },
  });
  if (!referring) return null;
  if (audits.isError)
    return (
      <ReadError {...readErrorProps(audits)} fallback="Visibility audits could not be loaded." />
    );
  if (audits.isPending) return <Skeleton className="h-32 w-full" />;
  // Only an audit with answers can have cited sources.
  const answered = audits.data.filter((audit) => audit.completed_count > 0);
  if (!answered.length)
    return (
      <InlineEmpty>
        No Visibility audit has answers yet. Run one in Visibility, then match its citations here.
      </InlineEmpty>
    );
  const toggle = (auditId: string) =>
    setSelectedAudits((current) =>
      current.includes(auditId) ? current.filter((id) => id !== auditId) : [...current, auditId],
    );
  return (
    // The drawer is the surface and its title the heading; a Card here would
    // nest one object inside another.
    <div className="grid gap-3">
      <p className="type-body">
        Choose the Visibility audits whose cited sources to compare with the domains that link to
        you.
      </p>
      {derive.isError ? <Alert>{derive.error.message}</Alert> : null}
      {lists.length > 1 ? (
        <Select
          ariaLabel="Website"
          value={referring.id}
          onValueChange={setListId}
          options={lists.map((dataset) => ({ value: dataset.id, label: dataset.target_hostname }))}
        />
      ) : null}
      <div className="grid max-h-64 gap-2 overflow-y-auto">
        {answered.map((audit) => (
          <label
            key={audit.id}
            className="type-body border-border-subtle flex items-center justify-between gap-3 border-b py-2"
          >
            <Checkbox
              checked={selectedAudits.includes(audit.id)}
              onCheckedChange={() => toggle(audit.id)}
              label={formatDisplayTimestamp(audit.created_at, timeZone)}
            />
            <span className="text-muted">{pluralCount(audit.completed_count, 'answer')}</span>
          </label>
        ))}
      </div>
      <div>
        <Button
          size="sm"
          disabled={!selectedAudits.length || derive.isPending}
          onClick={() => derive.mutate()}
        >
          Match citations
        </Button>
      </div>
    </div>
  );
}
