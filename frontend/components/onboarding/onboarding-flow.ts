'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';

import {
  brandDiscoveriesApi,
  type BrandDiscovery,
  type DiscoveryProfile,
} from '@/lib/api/brand-discoveries';
import { queryKeys } from '@/lib/api/query-keys';
import { brandDiscoveryKeys } from '@/lib/api/query-keys/brand-discovery';
import { projectDestination } from '@/lib/navigation/project-destination';
import {
  brandStepSchema,
  emptyBrandStep,
  normalizeWebsiteUrl,
  type BrandStepValues,
  type ReviewCompetitor,
  type ReviewDomain,
} from '@/lib/onboarding/forms';
import { ONBOARDING_COMPLETION_REQUEST_TIMEOUT_MS } from '@/lib/config/operational';
import {
  finishOnboardingCompletionRequest,
  startOnboardingCompletionRequest,
  startOnboardingNavigationHandoff,
} from '@/lib/onboarding/timing';
import { clearReviewDraft, readReviewDraft, saveReviewDraft } from '@/lib/onboarding/review-draft';
import { useBrandDiscovery } from '@/lib/onboarding/use-brand-discovery';
import { refreshBrandLogos } from '@/lib/project/brand-logos';
import { useProjectContext } from '@/lib/project/project-context';

import { hasConfirmedIcp } from './icp-confirmation';

export type OnboardingStep = 0 | 1 | 2;

function selectedDomains(domains: ReviewDomain[]): string[] {
  return domains.flatMap((item) => (item.selected ? [item.domain] : []));
}

function selectedCompetitors(competitors: ReviewCompetitor[]) {
  return competitors.flatMap((item) =>
    item.selected ? [{ name: item.name.trim(), aliases: item.aliases, domains: item.domains }] : [],
  );
}

/**
 * Where a resumed onboarding picks up.
 *
 * Without a discovery to resume there is nothing to return to, so the flow
 * starts at the brand step whatever the URL claims.
 */
function resumedStep(discoveryId: string | null, stepParameter: string | null): OnboardingStep {
  if (!discoveryId) return 0;
  return stepParameter === 'review' ? 2 : 1;
}

function stepQueryValue(step: OnboardingStep): 'brand' | 'discovery' | 'review' {
  return ['brand', 'discovery', 'review'][step] as 'brand' | 'discovery' | 'review';
}

function persistedBrand(input: Record<string, unknown>): BrandStepValues {
  const text = (key: string, fallback = '') =>
    typeof input[key] === 'string' ? (input[key] as string) : fallback;
  return {
    brand_name: text('brand_name'),
    website_url: text('website_url'),
    industry: text('industry'),
    subindustry: text('subindustry'),
    primary_market: text('primary_market', 'US'),
    language_code: text('language_code', 'en'),
  };
}

function isOrphanedCompletion(
  discoveryId: string | null,
  discovery: BrandDiscovery | undefined,
): boolean {
  if (!discoveryId || discovery?.project_id) return false;
  return discovery?.status === 'project_created';
}

export function useOnboardingFlow(transactionKey: string) {
  const router = useNavigate();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams()[0];
  const { activeWorkspaceId, setActiveProjectId } = useProjectContext();
  const openingProject = useRef<string | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const isAdditional = searchParams?.get('new') === '1';
  const initialDiscoveryId = searchParams?.get('discovery') ?? null;
  const initialStepParameter = searchParams?.get('step') ?? null;
  const [step, setStep] = useState<OnboardingStep>(() =>
    resumedStep(initialDiscoveryId, initialStepParameter),
  );
  const [resumeDiscoveryId, setResumeDiscoveryId] = useState<string | null>(initialDiscoveryId);
  const [brand, setBrand] = useState<BrandStepValues | null>(null);
  const [domains, setDomains] = useState<ReviewDomain[]>([]);
  const [competitors, setCompetitors] = useState<ReviewCompetitor[]>([]);
  const [profile, setProfile] = useState<DiscoveryProfile | null>(null);
  const form = useForm<BrandStepValues>({
    resolver: zodResolver(brandStepSchema),
    defaultValues: emptyBrandStep,
  });
  const discovery = useBrandDiscovery(
    step >= 1 && brand
      ? {
          brand_name: brand.brand_name.trim(),
          website_url: normalizeWebsiteUrl(brand.website_url),
          industry: brand.industry,
          subindustry: brand.subindustry,
          primary_market: brand.primary_market,
          language_code: brand.language_code,
        }
      : null,
    resumeDiscoveryId,
    activeWorkspaceId,
  );
  const catalog = useQuery({
    queryKey: brandDiscoveryKeys.catalog(activeWorkspaceId),
    queryFn: ({ signal }) =>
      brandDiscoveriesApi.catalog({ signal, workspaceId: activeWorkspaceId }),
    staleTime: Number.POSITIVE_INFINITY,
    enabled: activeWorkspaceId !== null,
  });
  const maximumCompetitors = catalog.data?.maximum_competitors;
  const discoveryState = discovery.discovery;
  const orphanedCompletion = isOrphanedCompletion(initialDiscoveryId, discoveryState);
  useEffect(() => {
    if (!orphanedCompletion && !brand && discoveryState) {
      // oxlint-disable-next-line react-hooks/set-state-in-effect -- hydrate the persisted draft once.
      setBrand(persistedBrand(discoveryState.input_data));
    }
  }, [brand, discoveryState, orphanedCompletion]);

  useEffect(() => {
    if (!orphanedCompletion) return;
    // Project deletion preserves discovery provenance by nulling project_id.
    // A bookmarked completion URL must not resurrect that old transaction.
    if (initialDiscoveryId) clearReviewDraft(initialDiscoveryId);
    // oxlint-disable-next-line react-hooks/set-state-in-effect -- discard the stale route-owned draft.
    setResumeDiscoveryId(null);
    setBrand(null);
    setDomains([]);
    setCompetitors([]);
    setProfile(null);
    form.reset(emptyBrandStep);
    setStep(0);
    // Keep the workspace: a discarded draft still belongs to the workspace the
    // reader was creating in, and dropping it here would silently re-target
    // the retry at whichever workspace resolves by default.
    const reset = new URLSearchParams({ new: '1' });
    // The URL is the first authority, but an orphaned completion link
    // may carry no workspace at all — and the resolved one is still the
    // workspace this draft belonged to.
    const workspace = searchParams?.get('workspace') ?? activeWorkspaceId;
    if (workspace) reset.set('workspace', workspace);
    router(`/onboarding?${reset.toString()}`, { replace: true, preventScrollReset: true });
  }, [activeWorkspaceId, form, initialDiscoveryId, orphanedCompletion, router, searchParams]);

  // Edits saved before a reload win over the discovery's suggestions. Read
  // once per discovery; the save effect below keeps it current.
  const readyDiscoveryId = discoveryState?.status === 'ready' ? discoveryState.id : null;
  const savedDraft = useMemo(
    () => (readyDiscoveryId ? readReviewDraft(readyDiscoveryId) : null),
    [readyDiscoveryId],
  );
  useEffect(() => {
    if (discoveryState?.status !== 'ready') return;
    // oxlint-disable-next-line react-hooks/set-state-in-effect -- seed an editable persisted draft.
    setDomains((current) =>
      current.length
        ? current
        : (savedDraft?.domains ??
          discoveryState.domains.map((domain, index) => ({
            id: `domain:${index}:${domain}`,
            domain,
            selected: true,
          }))),
    );
    setProfile((current) => current ?? savedDraft?.profile ?? discoveryState.profile);
  }, [discoveryState, savedDraft]);

  useEffect(() => {
    if (discoveryState?.status !== 'ready' || maximumCompetitors === undefined) return;
    // Suggestions arrive ranked; the first ones up to the cap start selected
    // and the reader deselects any that are wrong before creation.
    // oxlint-disable-next-line react-hooks/set-state-in-effect -- seed an editable persisted draft.
    setCompetitors((current) =>
      current.length
        ? current
        : (savedDraft?.competitors ??
          discoveryState.competitors.map((competitor, index) => ({
            ...competitor,
            id: `competitor:${index}:${competitor.name}`,
            selected: index < maximumCompetitors,
          }))),
    );
  }, [discoveryState, maximumCompetitors, savedDraft]);

  // Keep the reader's review edits for this tab, so a reload returns to them.
  useEffect(() => {
    // Competitors seed once the catalog's cap is known; saving before then
    // would store an empty list over the suggestions.
    if (step !== 2 || !readyDiscoveryId || profile === null || maximumCompetitors === undefined)
      return;
    saveReviewDraft(readyDiscoveryId, { domains, competitors, profile });
  }, [competitors, domains, maximumCompetitors, profile, readyDiscoveryId, step]);

  // The completion response is the committed write receipt. Do not hold the
  // user here for another detail request: the destination owns that bounded
  // read and its retry UI, including when the project list predates creation.
  const openProject = useCallback(
    async (projectId: string) => {
      if (!mounted.current || openingProject.current === projectId) return;
      openingProject.current = projectId;
      if (activeWorkspaceId) {
        const listKey = queryKeys.projects.list(activeWorkspaceId);
        await queryClient.cancelQueries({ queryKey: listKey });
        if (!mounted.current) return;
        void queryClient.invalidateQueries({ queryKey: listKey });
      }
      setActiveProjectId(projectId);
      startOnboardingNavigationHandoff(projectId);
      router(projectDestination('/projects', null, projectId), { replace: true });
    },
    [activeWorkspaceId, queryClient, router, setActiveProjectId],
  );

  const complete = useMutation({
    mutationFn: async () => {
      if (!brand || !discoveryState || !hasConfirmedIcp(profile)) {
        throw new Error('Confirm the required ICP fields before creating the project.');
      }
      const timingStarted = startOnboardingCompletionRequest();
      try {
        const result = await brandDiscoveriesApi.complete(
          discoveryState.id,
          {
            name: brand.brand_name.trim(),
            profile,
            domains: selectedDomains(domains),
            competitors: selectedCompetitors(competitors),
          },
          `complete:${discoveryState.id}`,
          { workspaceId: activeWorkspaceId, timeoutMs: ONBOARDING_COMPLETION_REQUEST_TIMEOUT_MS },
        );
        if (!result.project_id) {
          throw new Error(
            'Project creation did not return a project. Try Create project again; your reviewed details are preserved.',
          );
        }
        return result;
      } finally {
        finishOnboardingCompletionRequest(timingStarted);
      }
    },
    // Completion creates the project, with no prompts yet, in the request.
    onSuccess: async (result) => {
      if (!result.project_id) return;
      if (discoveryState) clearReviewDraft(discoveryState.id);
      if (activeWorkspaceId) refreshBrandLogos(queryClient, result.project_id, activeWorkspaceId);
      await openProject(result.project_id);
    },
    // A request the browser abandoned may still have committed. Re-read the
    // draft: if it now names its project, the effect below opens it, instead
    // of leaving the reader on a review whose project already exists.
    onError: () => {
      if (!discoveryState) return;
      void queryClient.invalidateQueries({
        queryKey: brandDiscoveryKeys.detail(activeWorkspaceId, discoveryState.id),
      });
    },
  });

  const completedProjectId = complete.data?.project_id ?? discoveryState?.project_id ?? null;
  const completionFailed = discoveryState?.status === 'failed';
  const isCompleting = !completionFailed && (complete.isPending || complete.isSuccess);
  useEffect(() => {
    // Completion owns navigation from acceptance through the project handoff.
    if (orphanedCompletion || openingProject.current || isCompleting || completedProjectId) return;
    const discoveryId = discoveryState?.id ?? resumeDiscoveryId;
    if (!discoveryId) return;
    if (resumeDiscoveryId !== discoveryId) {
      // oxlint-disable-next-line react-hooks/set-state-in-effect -- mirror the persisted discovery id.
      setResumeDiscoveryId(discoveryId);
    }
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('discovery', discoveryId);
    params.set('step', stepQueryValue(step));
    const next = params.toString();
    if (next !== searchParams?.toString())
      router(`/onboarding?${next}`, {
        replace: true,
        preventScrollReset: true,
        state: { onboardingTransactionKey: transactionKey },
      });
  }, [
    isCompleting,
    completedProjectId,
    discoveryState?.id,
    orphanedCompletion,
    resumeDiscoveryId,
    router,
    searchParams,
    step,
    transactionKey,
  ]);

  useEffect(() => {
    if (!completedProjectId || completionFailed) return;
    void openProject(completedProjectId);
  }, [completedProjectId, completionFailed, openProject]);

  const submitBrand = form.handleSubmit((values) => {
    const rediscovers =
      discoveryState?.status === 'failed' ||
      (brand !== null && JSON.stringify(brand) !== JSON.stringify(values));
    if (rediscovers) {
      if (discoveryState) clearReviewDraft(discoveryState.id);
      setDomains([]);
      setCompetitors([]);
      setProfile(null);
      setResumeDiscoveryId(null);
    }
    setBrand(values);
    setStep(1);
  });

  const toggle = useCallback(
    <T extends { selected: boolean }>(setter: React.Dispatch<React.SetStateAction<T[]>>) =>
      (index: number) =>
        setter((current) =>
          current.map((item, itemIndex) =>
            itemIndex === index ? { ...item, selected: !item.selected } : item,
          ),
        ),
    [],
  );

  return {
    brand,
    catalog,
    competitors,
    complete,
    completedProjectId,
    completionFailed,
    // Hold the action through navigation to the created project so a second
    // click cannot race the handoff.
    isCompleting,
    discovery,
    domains,
    form,
    hasSelectedDomain: domains.some((item) => item.selected),
    hasIncompleteCompetitor: competitors.some(
      (item) =>
        item.selected &&
        (!item.name.trim() || !item.domains.some((domain) => domain.trim().length > 0)),
    ),
    isAdditional,
    maximumCompetitors,
    profile,
    setCompetitors,
    setDomains,
    setProfile,
    setStep,
    step,
    submitBrand,
    toggle,
  };
}
