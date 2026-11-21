import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { brandProfileDraftSchema } from '@citeladder/contracts';

import { projectMutations } from '@/lib/api/projects';
import type { BrandProfile, BrandProfileDraft } from '@citeladder/contracts';
import { identityFacets, type IdentityFacets } from '@/lib/project/identity-facets';

function profileDraft(profile: BrandProfile | null | undefined): BrandProfileDraft {
  return {
    description: profile?.description ?? '',
    positioning: profile?.positioning ?? '',
    products_services: profile?.products_services ?? [],
    target_audience: profile?.target_audience ?? '',
  };
}

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

type Edits = Readonly<{
  draft: Partial<BrandProfileDraft>;
  identity: Partial<IdentityFacets>;
}>;

const NO_EDITS: Edits = { draft: {}, identity: {} };

export function useBrandProfileForm({
  projectId,
  workspaceId,
  profile,
}: Readonly<{
  projectId: string;
  workspaceId: string;
  profile: BrandProfile | null | undefined;
}>) {
  const [edits, setEdits] = useState<Edits>(NO_EDITS);
  const [notice, setNotice] = useState<string | null>(null);
  const savedDraft = profileDraft(profile);
  const savedIdentity = identityFacets(profile?.business_context ?? {});
  const draft: BrandProfileDraft = { ...savedDraft, ...edits.draft };
  const identity: IdentityFacets = { ...savedIdentity, ...edits.identity };

  const save = useMutation(projectMutations.updateBrandProfile({ workspaceId, projectId }));
  const submit = () =>
    save.mutate(
      {
        ...changed(DRAFT_FIELDS, draft, savedDraft),
        ...identityUpdate(identity, savedIdentity),
      },
      {
        onSuccess: () => {
          setEdits(NO_EDITS);
          setNotice('Brand knowledge saved. These details now inform assisted features.');
        },
      },
    );

  const dirty =
    Object.keys(changed(DRAFT_FIELDS, draft, savedDraft)).length > 0 ||
    Object.keys(identityUpdate(identity, savedIdentity)).length > 0;
  return {
    draft,
    identity,
    dirty,
    empty:
      Object.values(savedDraft).every((value) => value.length === 0) &&
      Object.values(savedIdentity).every((value) => !value),
    saving: save.isPending,
    error: save.error,
    notice,
    save: submit,
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
  };
}

export type BrandProfileForm = ReturnType<typeof useBrandProfileForm>;
