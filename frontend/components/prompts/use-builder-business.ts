'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { projectMutations, projectQueries } from '@/lib/api/projects';
import {
  businessDraft,
  mapChanges,
  profileChanges,
  type BusinessDraft,
} from '@/lib/prompts/builder-business';

/**
 * The "About your business" step's state: the saved brand profile and
 * business map as a draft, and one save that writes each owner only what
 * changed — the profile first, so the map never names an offering the
 * profile does not list yet.
 */
export function useBuilderBusiness({
  projectId,
  workspaceId,
}: Readonly<{ projectId: string; workspaceId: string }>) {
  const scope = { workspaceId, projectId };
  const profileQuery = useQuery(projectQueries.brandProfile(scope));
  const mapQuery = useQuery(projectQueries.businessMap(scope));
  const saved = useMemo(
    () =>
      profileQuery.data && mapQuery.data ? businessDraft(profileQuery.data, mapQuery.data) : null,
    [profileQuery.data, mapQuery.data],
  );
  const [edited, setEdited] = useState<BusinessDraft | null>(null);
  const draft = edited ?? saved;
  const profileUpdate = edited && saved ? profileChanges(edited, saved) : {};
  const mapUpdate = edited && saved ? mapChanges(edited, saved) : null;
  const dirty = Object.keys(profileUpdate).length > 0 || mapUpdate !== null;

  const saveBusiness = useMutation(projectMutations.saveBusiness(scope));
  const save = {
    isPending: saveBusiness.isPending,
    /** Write what changed; the draft becomes the saved state once both owners land. */
    mutateAsync: () =>
      saveBusiness.mutateAsync(
        { profile: Object.keys(profileUpdate).length ? profileUpdate : null, map: mapUpdate },
        { onSuccess: () => setEdited(null) },
      ),
  };

  const retry = () => {
    if (profileQuery.isError) void profileQuery.refetch();
    if (mapQuery.isError) void mapQuery.refetch();
  };
  return {
    profile: profileQuery.data,
    map: mapQuery.data,
    loading: profileQuery.isPending || mapQuery.isPending,
    loadError: profileQuery.error ?? mapQuery.error,
    retry,
    retrying: profileQuery.isFetching || mapQuery.isFetching,
    draft,
    setDraft: setEdited,
    dirty,
    save,
  };
}
export type BuilderBusiness = ReturnType<typeof useBuilderBusiness>;
