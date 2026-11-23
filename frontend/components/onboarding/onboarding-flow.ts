import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm, type FieldErrors } from 'react-hook-form';

import {
  brandDiscoveriesApi,
  brandDiscoveryQueries,
  refreshBrandDiscovery,
  type BrandDiscovery,
  type DiscoveryProfile,
} from '@/lib/api/brand-discoveries';
import { refreshAfterProjectCreated, refreshBrandLogos } from '@/lib/api/projects';
import { projectDestination } from '@/lib/navigation/project-destination';
import {
  readUrlParam,
  useUrlParam,
  useUrlSearch,
  withUrlParams,
} from '@/lib/navigation/url-params';
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

function resumedStep(discoveryId: string | null, stepParameter: string | null): OnboardingStep {
  if (!discoveryId) return 0;
  return stepParameter === 'review' ? 2 : 1;
}

const STEP_QUERY_VALUES = ['brand', 'discovery', 'review'] as const;

function persistedBrand(input: Record<string, unknown>): BrandStepValues {
  const text = (key: string, fallback = '') => {
    const value = input[key];
    return typeof value === 'string' ? value : fallback;
  };
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
  const searchParams = useUrlSearch();
  const { activeWorkspaceId, setActiveProjectId } = useProjectContext();
  const openingProject = useRef<string | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const isAdditional = useUrlParam('new');
  const initialDiscoveryId = useUrlParam('discovery');
  const initialStepParameter = useUrlParam('step');
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
    ...brandDiscoveryQueries.catalog(activeWorkspaceId),
    enabled: activeWorkspaceId !== null,
  });
  const maximumCompetitors = catalog.data?.maximum_competitors;
  const discoveryState = discovery.discovery;
  const orphanedCompletion = isOrphanedCompletion(initialDiscoveryId, discoveryState);
  useEffect(() => {
    if (!orphanedCompletion && !brand && discoveryState) {
      // oxlint-disable-next-line react-hooks/set-state-in-effect
      setBrand(persistedBrand(discoveryState.input_data));
    }
  }, [brand, discoveryState, orphanedCompletion]);

  useEffect(() => {
    if (!orphanedCompletion) return;
    if (initialDiscoveryId) clearReviewDraft(initialDiscoveryId);
    // oxlint-disable-next-line react-hooks/set-state-in-effect
    setResumeDiscoveryId(null);
    setBrand(null);
    setDomains([]);
    setCompetitors([]);
    setProfile(null);
    form.reset(emptyBrandStep);
    setStep(0);
    const workspace = readUrlParam(searchParams, 'workspace') ?? activeWorkspaceId;
    const reset = withUrlParams(null, { new: true, workspace: workspace || null });
    router(`/onboarding?${reset.toString()}`, { replace: true, preventScrollReset: true });
  }, [activeWorkspaceId, form, initialDiscoveryId, orphanedCompletion, router, searchParams]);

  const readyDiscoveryId = discoveryState?.status === 'ready' ? discoveryState.id : null;
  const savedDraft = useMemo(
    () => (readyDiscoveryId ? readReviewDraft(readyDiscoveryId) : null),
    [readyDiscoveryId],
  );
  useEffect(() => {
    if (discoveryState?.status !== 'ready') return;
    // oxlint-disable-next-line react-hooks/set-state-in-effect
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
    // oxlint-disable-next-line react-hooks/set-state-in-effect
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

  useEffect(() => {
    if (step !== 2 || !readyDiscoveryId || profile === null || maximumCompetitors === undefined)
      return;
    saveReviewDraft(readyDiscoveryId, { domains, competitors, profile });
  }, [competitors, domains, maximumCompetitors, profile, readyDiscoveryId, step]);

  const openProject = useCallback(
    async (projectId: string) => {
      if (!mounted.current || openingProject.current === projectId) return;
      openingProject.current = projectId;
      if (activeWorkspaceId) {
        await refreshAfterProjectCreated(queryClient, activeWorkspaceId);
        if (!mounted.current) return;
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
          throw new Error('Project creation did not return a project.');
        }
        return result;
      } finally {
        finishOnboardingCompletionRequest(timingStarted);
      }
    },
    onSuccess: async (result) => {
      if (!result.project_id) return;
      if (discoveryState) clearReviewDraft(discoveryState.id);
      if (activeWorkspaceId) refreshBrandLogos(queryClient, result.project_id, activeWorkspaceId);
      await openProject(result.project_id);
    },
    onError: () => {
      if (discoveryState)
        void refreshBrandDiscovery(queryClient, activeWorkspaceId, discoveryState.id);
    },
  });

  const completedProjectId = complete.data?.project_id ?? discoveryState?.project_id ?? null;
  const completionFailed = discoveryState?.status === 'failed';
  const isCompleting = !completionFailed && (complete.isPending || complete.isSuccess);
  useEffect(() => {
    if (orphanedCompletion || openingProject.current || isCompleting || completedProjectId) return;
    const discoveryId = discoveryState?.id ?? resumeDiscoveryId;
    if (!discoveryId) return;
    if (resumeDiscoveryId !== discoveryId) {
      // oxlint-disable-next-line react-hooks/set-state-in-effect
      setResumeDiscoveryId(discoveryId);
    }
    const next = withUrlParams(searchParams, {
      discovery: discoveryId,
      step: STEP_QUERY_VALUES[step],
    }).toString();
    if (next !== searchParams.toString())
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
  }, revealFirstInvalid);

  const rerunDiscovery = () => {
    const previous = discoveryState?.id;
    discovery.rerun(() => {
      if (previous) clearReviewDraft(previous);
      setDomains([]);
      setCompetitors([]);
      setProfile(null);
    });
  };

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
    rerunDiscovery,
    setCompetitors,
    setDomains,
    setProfile,
    setStep,
    step,
    submitBrand,
    toggle,
  };
}

function revealFirstInvalid(errors: FieldErrors<BrandStepValues>) {
  const fields = Object.values(errors).flatMap((error): HTMLElement[] => {
    const ref = error && 'ref' in error ? error.ref : undefined;
    return ref instanceof HTMLElement ? [ref] : [];
  });
  fields.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const [first] = fields;
  first?.scrollIntoView?.({ block: 'center' });
}
