'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Checkbox } from '@/components/ui/checkbox';
import { Inline, Stack } from '@/components/ui/layout';
import { ledgerClasses, ledgerItemClasses } from '@/components/ui/workspace';
import { QueryState } from '@/components/ui/query-state';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { formatDisplayTimestamp, pluralCount } from '@/lib/format';
import { ReadError, readErrorProps } from '@/components/ui/read-error';
import { runsQueries } from '@/lib/api/runs';
import {
  searchIntelligenceMutations,
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
  /** The matches are saved and the readiness is refreshed. */
  onDerived: () => void;
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
  const scope = {
    workspaceId: activeProject?.workspace_id ?? null,
    projectId: activeProject?.id ?? '',
  };
  const audits = useQuery({
    ...runsQueries.list(scope),
    enabled: Boolean(activeProject && referring),
  });
  const derive = useMutation(searchIntelligenceMutations.deriveCitationMatches(scope));
  const deriveMatches = () =>
    derive.mutate(
      { backlink_dataset_id: referring!.id, audit_ids: selectedAudits },
      {
        onSuccess: (dataset) => {
          setSelectedAudits([]);
          notify(
            'Citation matches saved',
            `${pluralCount(dataset.unique_rows_saved, 'citation')} came from sites that link to you. Open Citation matches in Backlinks.`,
            { tone: 'positive' },
          );
          onDerived();
        },
      },
    );
  if (!referring) return null;
  if (audits.isError)
    return (
      <ReadError {...readErrorProps(audits)} fallback="Visibility audits could not be loaded." />
    );
  if (audits.isPending) return <Skeleton variant="block" />;
  // Only an audit with answers can have cited sources.
  const answered = audits.data.filter((audit) => audit.completed_count > 0);
  if (!answered.length)
    return (
      <QueryState
        kind="empty"
        inline
        message="No Visibility audit has answers yet. Run one in Visibility, then match its citations here."
      />
    );
  const toggle = (auditId: string) =>
    setSelectedAudits((current) =>
      current.includes(auditId) ? current.filter((id) => id !== auditId) : [...current, auditId],
    );
  return (
    // The drawer is the surface and its title the heading; a Card here would
    // nest one object inside another.
    <Stack gap="compact">
      <p className="type-body">
        Choose the Visibility audits whose cited sources to compare with the domains that link to
        you.
      </p>
      {derive.isError ? <Callout tone="negative">{derive.error.message}</Callout> : null}
      {lists.length > 1 ? (
        <Select
          ariaLabel="Website"
          value={referring.id}
          onValueChange={setListId}
          options={lists.map((dataset) => ({ value: dataset.id, label: dataset.target_hostname }))}
        />
      ) : null}
      <div className={ledgerClasses('open', 'max-h-64 overflow-y-auto')}>
        {answered.map((audit) => (
          <Inline
            as="label"
            key={audit.id}
            gap="compact"
            className={ledgerItemClasses('type-body justify-between')}
          >
            <Checkbox
              checked={selectedAudits.includes(audit.id)}
              onCheckedChange={() => toggle(audit.id)}
              label={formatDisplayTimestamp(audit.created_at, timeZone)}
            />
            <span className="text-ink-muted">{pluralCount(audit.completed_count, 'answer')}</span>
          </Inline>
        ))}
      </div>
      <div>
        <Button
          variant="primary"
          disabled={!selectedAudits.length || derive.isPending}
          onClick={deriveMatches}
        >
          Match citations
        </Button>
      </div>
    </Stack>
  );
}
