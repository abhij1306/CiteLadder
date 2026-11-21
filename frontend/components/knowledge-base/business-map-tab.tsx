import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Stack } from '@/components/ui/layout';
import { Notice } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { promptsQueries } from '@/lib/api/prompts';
import { useWorkspaceCapability } from '@/lib/project/project-context';

import { BusinessFacts, OfferingsGrid, SuggestionsNotice } from './business-editor';
import { SaveFoot } from './save-foot';
import type { BusinessDraftState } from './use-business-draft';

export function BusinessMapTab({
  business,
  projectId,
  workspaceId,
}: Readonly<{
  business: BusinessDraftState;
  projectId: string;
  workspaceId: string;
}>) {
  const sets = useQuery(promptsQueries.sets({ workspaceId, projectId }));
  const mayEdit = useWorkspaceCapability('write');
  const { draft, profile, map } = business;
  const limits = sets.data?.limits;
  const failed = business.loadError ?? sets.error;
  if (failed)
    return (
      <StateBlock
        kind="error"
        error={failed}
        title="Couldn't load the business map"
        fallback="The request failed or timed out."
        onRetry={() => {
          business.retry();
          if (sets.isError) void sets.refetch();
        }}
        pending={business.retrying || sets.isFetching}
      />
    );
  if (!draft || !profile || !map || !limits)
    return <StateBlock kind="loading" label="Loading the business map" shape={{ kind: 'list' }} />;
  const saving = business.save.isPending;
  const editor = {
    draft,
    onChange: business.setDraft,
    disabled: !mayEdit || saving,
    listMax: limits.context_list_max_entries,
  };
  return (
    <Stack gap="section">
      {business.save.error ? (
        <Notice
          kind="mutation"
          notice={mutationNoticeForError(business.save.error, { action: 'save the business map' })}
        />
      ) : null}
      {mayEdit ? <SuggestionsNotice {...editor} /> : null}
      <OfferingsGrid {...editor} saved={map} />
      <BusinessFacts {...editor} context={profile.business_context} />
      {mayEdit ? <SaveBar business={business} /> : null}
    </Stack>
  );
}

function SaveBar({ business }: Readonly<{ business: BusinessDraftState }>) {
  const saving = business.save.isPending;
  return (
    <div className="bg-panel border-rule sticky bottom-0 flex justify-end gap-2 border-t py-3">
      {business.dirty ? (
        <Button variant="quiet" disabled={saving} onClick={business.discard}>
          Discard
        </Button>
      ) : null}
      <SaveFoot
        label="Save business map"
        changed={business.dirty}
        saving={saving}
        onSave={() => void business.save.mutateAsync().catch(() => undefined)}
      />
    </div>
  );
}
