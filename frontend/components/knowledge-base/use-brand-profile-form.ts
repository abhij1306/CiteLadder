'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { brandProfileDraftSchema } from '@citeladder/contracts';

import { projectsApi } from '@/lib/api/projects';
import { queryKeys } from '@/lib/api/query-keys';
import type { BrandProfile, BrandProfileDraft } from '@/lib/api/types';
import { identityFacets, type IdentityFacets } from '@/lib/project/identity-facets';

function profileDraft(profile: BrandProfile | null | undefined): BrandProfileDraft {
  return {
    description: profile?.description ?? '',
    positioning: profile?.positioning ?? '',
    products_services: profile?.products_services ?? [],
    target_audience: profile?.target_audience ?? '',
  };
}

/** The editable profile fields, from the contract that owns them. */
const DRAFT_FIELDS = brandProfileDraftSchema.keyof().options;
const IDENTITY_FIELDS = [
  'category',
  'buyer_type',
  'market_scope',
] as const satisfies readonly (keyof IdentityFacets)[];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The named fields of `next` that differ from `base`. Only what the reader
 * changed is sent, because the API marks every sent field and facet reviewed.
 */
function changed<T, K extends keyof T>(fields: readonly K[], next: T, base: T): Partial<T> {
  const patch: Partial<T> = {};
  for (const field of fields) if (!same(next[field], base[field])) patch[field] = next[field];
  return patch;
}

/** A cleared category is sent so the API can reject it; an unset facet never is. */
function identityUpdate(identity: IdentityFacets, saved: IdentityFacets) {
  const category = identity.category.trim();
  return {
    ...(category !== saved.category ? { category } : {}),
    ...(identity.buyer_type && identity.buyer_type !== saved.buyer_type
      ? { buyer_type: identity.buyer_type }
      : {}),
    ...(identity.market_scope && identity.market_scope !== saved.market_scope
      ? { market_scope: identity.market_scope }
      : {}),
  };
}

const sameOffering = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The offerings with a typed but not yet added entry appended, so Save never drops it. */
function withPending(offerings: readonly string[], pending: string): string[] {
  const value = pending.trim();
  return value && !offerings.some((item) => sameOffering(item, value))
    ? [...offerings, value]
    : [...offerings];
}

type Edits = Readonly<{
  draft: Partial<BrandProfileDraft>;
  identity: Partial<IdentityFacets>;
  pendingOffering: string;
}>;

const NO_EDITS: Edits = { draft: {}, identity: {}, pendingOffering: '' };

/**
 * The company profile's editable draft across the Context tabs that edit it,
 * and its one save. Edits are kept as the fields the reader touched over the
 * persisted profile, so a background refresh of an untouched field shows
 * through and is never sent back stale. The page places the save action.
 */
export function useBrandProfileForm({
  projectId,
  workspaceId,
  profile,
  onSaved,
}: Readonly<{
  projectId: string;
  workspaceId: string;
  /** The persisted profile; none yet (or still loading) edits an empty draft. */
  profile: BrandProfile | null | undefined;
  onSaved?: () => void;
}>) {
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState<Edits>(NO_EDITS);
  const [notice, setNotice] = useState<string | null>(null);
  const savedDraft = profileDraft(profile);
  const savedIdentity = identityFacets(profile?.business_context ?? {});
  const draft: BrandProfileDraft = { ...savedDraft, ...edits.draft };
  const identity: IdentityFacets = { ...savedIdentity, ...edits.identity };

  const save = useMutation({
    mutationFn: () =>
      projectsApi.updateBrandProfile(
        projectId,
        {
          ...changed(
            DRAFT_FIELDS,
            {
              ...draft,
              products_services: withPending(draft.products_services, edits.pendingOffering),
            },
            savedDraft,
          ),
          ...identityUpdate(identity, savedIdentity),
        },
        { workspaceId },
      ),
    onSuccess: (next) => {
      queryClient.setQueryData(queryKeys.projects.brandProfile(projectId), next);
      // Seed queries carry the category and offerings, so the builder rereads them.
      void queryClient.invalidateQueries({ queryKey: queryKeys.topics.seedQueries(projectId) });
      onSaved?.();
      setEdits(NO_EDITS);
      setNotice('Brand knowledge saved. These details now inform assisted features.');
    },
  });

  return {
    draft,
    identity,
    pendingOffering: edits.pendingOffering,
    saving: save.isPending,
    error: save.error,
    notice,
    save: () => save.mutate(),
    setDraft: (next: BrandProfileDraft) =>
      setEdits((current) => ({
        ...current,
        draft: { ...current.draft, ...changed(DRAFT_FIELDS, next, draft) },
      })),
    setIdentity: (next: IdentityFacets) =>
      setEdits((current) => ({
        ...current,
        identity: { ...current.identity, ...changed(IDENTITY_FIELDS, next, identity) },
      })),
    setPendingOffering: (pendingOffering: string) =>
      setEdits((current) => ({ ...current, pendingOffering })),
  };
}

export type BrandProfileForm = ReturnType<typeof useBrandProfileForm>;
