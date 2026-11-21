import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { Checkbox } from '@/components/ui/checkbox';
import { Inline, Stack } from '@/components/ui/layout';
import { ledgerClasses, ledgerItemClasses } from '@/components/ui/workspace';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { formatDisplayTimestamp, pluralCount } from '@/lib/format';
import { runsQueries } from '@/lib/api/runs';
import {
  searchIntelligenceMutations,
  type SearchIntelligenceDataset,
} from '@/lib/api/search-intelligence';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { referringLists } from './search-intelligence-format';
import { Notice, readErrorProps } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';

export function SearchIntelligenceCitationMatcher({
  datasets,
  targetOrigin,
  onDerived,
}: Readonly<{
  datasets: SearchIntelligenceDataset[];
  targetOrigin?: string;
  onDerived: () => void;
}>) {
  const { workspaceId, projectId } = useProjectScope();
  const scope = { workspaceId, projectId };
  const timeZone = useDisplayTimeZone();
  const { notify } = useToast();
  const [selectedAudits, setSelectedAudits] = useState<string[]>([]);
  const lists = referringLists(datasets);
  const [listId, setListId] = useState('');
  const referring =
    lists.find((dataset) => dataset.id === listId) ??
    lists.find((dataset) => dataset.target_origin === targetOrigin);
  const audits = useQuery({
    ...runsQueries.list(scope),
    enabled: Boolean(referring),
  });
  const derive = useMutation(searchIntelligenceMutations.deriveCitationMatches(scope));
  const deriveMatches = () => {
    if (!referring) return;
    derive.mutate(
      { backlink_dataset_id: referring.id, audit_ids: selectedAudits },
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
  };
  if (!referring) return null;
  if (audits.isError)
    return (
      <Notice
        kind="read"
        {...readErrorProps(audits)}
        fallback="Visibility audits could not be loaded."
        title="Visibility audits could not be loaded"
      />
    );
  if (audits.isPending) return <Skeleton variant="list" />;
  const answered = audits.data.filter((audit) => audit.completed_count > 0);
  if (!answered.length)
    return (
      <StateBlock
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
    <Stack gap="compact">
      {derive.isError ? (
        <Notice
          kind="mutation"
          notice={mutationNoticeForError(derive.error, { action: 'compare the cited sources' })}
        />
      ) : null}
      {lists.length > 1 ? (
        <Select
          ariaLabel="Website"
          value={referring.id}
          onValueChange={setListId}
          options={lists.map((dataset) => ({ value: dataset.id, label: dataset.target_hostname }))}
        />
      ) : null}
      <div className={ledgerClasses('max-h-64 overflow-y-auto')}>
        {answered.map((audit) => (
          <Inline
            as="label"
            key={audit.id}
            gap="compact"
            className={ledgerItemClasses('type-body text-ink-2 justify-between')}
          >
            <Checkbox
              checked={selectedAudits.includes(audit.id)}
              onCheckedChange={() => toggle(audit.id)}
              label={formatDisplayTimestamp(audit.created_at, timeZone)}
            />
            <span className="text-ink-2">{pluralCount(audit.completed_count, 'answer')}</span>
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
