'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { projectsApi } from '@/lib/api/projects';
import { queryKeys } from '@/lib/api/query-keys';
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
  const queryClient = useQueryClient();
  const profileQuery = useQuery({
    queryKey: queryKeys.projects.brandProfile(projectId),
    queryFn: ({ signal }) => projectsApi.getBrandProfile(projectId, { signal, workspaceId }),
  });
  const mapQuery = useQuery({
    queryKey: queryKeys.projects.businessMap(projectId),
    queryFn: ({ signal }) => projectsApi.getBusinessMap(projectId, { signal, workspaceId }),
  });
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

  const save = useMutation({
    mutationFn: async () => {
      if (Object.keys(profileUpdate).length) {
        const next = await projectsApi.updateBrandProfile(projectId, profileUpdate, {
          workspaceId,
        });
        queryClient.setQueryData(queryKeys.projects.brandProfile(projectId), next);
      }
      if (mapUpdate) {
        const next = await projectsApi.updateBusinessMap(projectId, mapUpdate, { workspaceId });
        queryClient.setQueryData(queryKeys.projects.businessMap(projectId), next);
      }
    },
    onSuccess: () => {
      setEdited(null);
      // Offerings and category terms decide which searches seed a run.
      void queryClient.invalidateQueries({ queryKey: queryKeys.topics.seedQueries(projectId) });
    },
  });

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
