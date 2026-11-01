'use client';

import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, Sparkles } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Icon } from '@/components/ui/icon';
import { Inline } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';
import { readErrorProps } from '@/components/ui/read-error';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import type { PromptGenerateInput } from '@/lib/api/prompts';
import { queryKeys } from '@/lib/api/query-keys';
import { topicsApi } from '@/lib/api/topics';
import type { PromptGenerateResponse, SeedQueries, Topic } from '@/lib/api/types';
import { personaChoices } from '@/lib/prompts/builder-business';
import { defaultRunSettings, runRequest, type RunSettings } from '@/lib/prompts/builder-run';

import { BuilderBusinessStep } from './builder-business-step';
import { BuilderDistributionStep } from './builder-distribution-step';
import { BuilderReviewStep, RunCoverage } from './builder-review-step';
import { BuilderTopicsStep } from './builder-topics-step';
import { GenerateErrorAlert, GenerateResultAlert } from './generation-alerts';
import { useBuilderBusiness, type BuilderBusiness } from './use-builder-business';
import { useBuilderTopics, type BuilderTopics } from './use-builder-topics';

export type BuilderStep = 'business' | 'topics' | 'distribution' | 'review';

const STEPS: readonly { value: BuilderStep; label: string }[] = [
  { value: 'business', label: '1. About your business' },
  { value: 'topics', label: '2. Topics' },
  { value: 'distribution', label: '3. Distribution' },
  { value: 'review', label: '4. Review' },
];

type PromptBuilderProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The step a fresh open starts on: `business` to build, `review` for waiting suggestions. */
  initialStep: BuilderStep;
  projectId: string;
  workspaceId: string;
  topics: Topic[];
  hasCompetitors: boolean;
  /** Runs one generate request; null when it failed (the error arrives as `generateError`). */
  generate: (input: PromptGenerateInput) => Promise<PromptGenerateResponse | null>;
  isGenerating: boolean;
  generateError?: unknown;
  /** The pending-candidate review list. */
  review: ReactNode;
  /** Refreshes the library's reads after topics change. */
  onTopicsChanged: () => Promise<void>;
};

/** What this open of the builder generated: its request and every run it made. */
type Session = { request: PromptGenerateInput; results: PromptGenerateResponse[] };

/**
 * The Prompt Builder: a right-hand sheet on the Prompts screen that steers
 * generation end to end — business facts, topics, distribution and search
 * seeds — then lands in candidate review. Every step is prefilled from saved
 * data, so a returning user can go straight to Generate. Each open is a fresh
 * session: drafts and settings never outlive the sheet.
 */
export function PromptBuilder(props: Readonly<PromptBuilderProps>) {
  const [session, setSession] = useState(0);
  const [previousOpen, setPreviousOpen] = useState(props.open);
  if (props.open !== previousOpen) {
    setPreviousOpen(props.open);
    if (props.open) setSession((count) => count + 1);
  }
  // A project switch is a new session too, so no draft saves against another project.
  return <BuilderSheet key={`${props.projectId}:${session}`} {...props} />;
}

function BuilderSheet(props: Readonly<PromptBuilderProps>) {
  const { projectId, workspaceId, topics, hasCompetitors, isGenerating, generateError } = props;
  const queryClient = useQueryClient();
  const [step, setStep] = useState<BuilderStep>(props.initialStep);
  const business = useBuilderBusiness({ projectId, workspaceId });
  const seedsQuery = useQuery({
    queryKey: queryKeys.topics.seedQueries(projectId),
    queryFn: ({ signal }) => topicsApi.seedQueries(projectId, { signal, workspaceId }),
  });
  const topicStep = useBuilderTopics({
    projectId,
    workspaceId,
    topics,
    onConfirmed: async () => {
      await props.onTopicsChanged();
      await queryClient.invalidateQueries({ queryKey: queryKeys.topics.seedQueries(projectId) });
    },
  });
  const [edited, setEdited] = useState<RunSettings | null>(null);
  const settings = edited ?? defaultRunSettings();
  const personas = business.draft ? personaChoices(business.draft) : [];
  const built = runRequest(settings, {
    seeds: seedsQuery.data ?? null,
    hasCompetitors,
    personaChoices: personas,
  });
  const [run, setRun] = useState<Session | null>(null);

  const generate = async (request: PromptGenerateInput, more: boolean) => {
    const result = await props.generate(request);
    if (!result) return;
    setRun((current) =>
      more && current
        ? { ...current, results: [...current.results, result] }
        : { request, results: [result] },
    );
    setStep('review');
  };
  const last = run?.results.at(-1);
  const runNotices = (
    <>
      {isGenerating ? (
        <Alert tone="info">
          Writing and quality-checking questions can take a minute or two. Keep this open.
        </Alert>
      ) : null}
      {generateError ? <GenerateErrorAlert error={generateError} /> : null}
    </>
  );

  return (
    <Drawer
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Prompt Builder"
      description="Shape what CiteLadder drafts. Suggestions wait for your review; only accepted ones are tracked."
      closeLabel="Close Prompt Builder"
      width="review"
      footer={
        <BuilderFooter
          step={step}
          setStep={setStep}
          business={business}
          topics={topicStep}
          canGenerate={built.ok && !isGenerating}
          isGenerating={isGenerating}
          onGenerate={() => {
            if (built.ok) void generate(built.request, false);
          }}
          onClose={() => props.onOpenChange(false)}
        />
      }
    >
      <Tabs
        value={step}
        onValueChange={setStep}
        items={STEPS}
        ariaLabel="Prompt Builder steps"
        spaced
      >
        <TabPanel value="business">
          <BuilderBusinessStep
            business={business}
            runContext={settings.runContext}
            onRunContextChange={(runContext) => setEdited({ ...settings, runContext })}
          />
        </TabPanel>
        <TabPanel value="topics">
          <BuilderTopicsStep topics={topicStep} />
        </TabPanel>
        <TabPanel value="distribution">
          <BuilderDistributionStep
            settings={settings}
            onChange={setEdited}
            hasCompetitors={hasCompetitors}
            personaChoices={personas}
            seeds={{ data: seedsQuery.data, status: <SeedsReadState read={seedsQuery} /> }}
            topics={topics}
            notices={
              <>
                {runNotices}
                <UnsavedNotice business={business} topics={topicStep} />
                {/* Until search data loads, its own loading or error state says why Generate waits. */}
                {seedsQuery.data ? <RunProblem built={built} /> : null}
              </>
            }
          />
        </TabPanel>
        <TabPanel value="review">
          <BuilderReviewStep
            notices={
              <>
                {runNotices}
                {last && !generateError ? <GenerateResultAlert result={last} /> : null}
              </>
            }
            coverage={
              run ? (
                <RunCoverage
                  request={run.request}
                  topics={topics}
                  drafted={run.results.flatMap((result) => result.candidates)}
                  disabled={isGenerating}
                  onGenerate={(request) => void generate(request, true)}
                />
              ) : null
            }
            review={props.review}
          />
        </TabPanel>
      </Tabs>
    </Drawer>
  );
}

/** The seed-query read before it has data: loading, or failed with a retry. */
function SeedsReadState({ read }: Readonly<{ read: UseQueryResult<SeedQueries> }>) {
  return read.isError ? (
    <QueryState
      kind="error"
      {...readErrorProps(read)}
      fallback="Your search data could not be loaded."
    />
  ) : (
    <QueryState kind="loading" label="Loading your search data" />
  );
}

/** Why the distribution settings cannot make a run, if they cannot. */
function RunProblem({ built }: Readonly<{ built: ReturnType<typeof runRequest> }>) {
  return built.ok ? null : <Alert tone="warning">{built.problem}</Alert>;
}

/** Edits from earlier steps that this run will not see until they are saved. */
function UnsavedNotice({
  business,
  topics,
}: Readonly<{ business: BuilderBusiness; topics: BuilderTopics }>) {
  const unsaved = [
    business.dirty ? 'your business edits are not saved' : null,
    topics.pending ? 'your topic changes are not confirmed' : null,
  ].filter((item): item is string => item !== null);
  if (!unsaved.length) return null;
  const sentence = unsaved.join(' and ');
  return (
    <Alert tone="warning">
      {sentence.charAt(0).toUpperCase() + sentence.slice(1)}, so this run will not use them.
    </Alert>
  );
}

/** Each step's way forward: save or confirm before moving on, Generate at the end. */
function BuilderFooter({
  step,
  setStep,
  business,
  topics,
  canGenerate,
  isGenerating,
  onGenerate,
  onClose,
}: Readonly<{
  step: BuilderStep;
  setStep: (step: BuilderStep) => void;
  business: BuilderBusiness;
  topics: BuilderTopics;
  canGenerate: boolean;
  isGenerating: boolean;
  onGenerate: () => void;
  onClose: () => void;
}>) {
  const back = (to: BuilderStep) => (
    <Button variant="ghost" onClick={() => setStep(to)}>
      <Icon icon={ArrowLeft} />
      Back
    </Button>
  );
  const advance = async (save: () => Promise<unknown>, to: BuilderStep) => {
    try {
      await save();
      setStep(to);
    } catch {
      // The step shows the failure; the person stays to fix it.
    }
  };
  switch (step) {
    case 'business':
      return (
        <Inline className="justify-end">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!business.draft}
            pending={business.save.isPending}
            pendingLabel="Saving…"
            onClick={() =>
              void advance(
                () => (business.dirty ? business.save.mutateAsync() : Promise.resolve()),
                'topics',
              )
            }
          >
            {business.dirty ? 'Save and continue' : 'Continue'}
            <Icon icon={ArrowRight} />
          </Button>
        </Inline>
      );
    case 'topics':
      return (
        <Inline className="justify-end">
          {back('business')}
          <Button
            variant="primary"
            disabled={topics.problem !== null || topics.preview.isPending}
            pending={topics.confirm.isPending}
            pendingLabel="Confirming…"
            onClick={() =>
              void advance(
                () => (topics.pending ? topics.confirm.mutateAsync() : Promise.resolve()),
                'distribution',
              )
            }
          >
            {topics.pending ? 'Confirm topics' : 'Continue'}
            <Icon icon={topics.pending ? Check : ArrowRight} />
          </Button>
        </Inline>
      );
    case 'distribution':
      return (
        <Inline className="justify-end">
          {back('topics')}
          <Button
            variant="primary"
            disabled={!canGenerate}
            pending={isGenerating}
            pendingLabel="Generating…"
            onClick={onGenerate}
          >
            <Icon icon={Sparkles} />
            Generate
          </Button>
        </Inline>
      );
    case 'review':
      return (
        <Inline className="justify-end">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="secondary" onClick={() => setStep('distribution')}>
            Adjust run
          </Button>
        </Inline>
      );
    default: {
      const exhaustive: never = step;
      return exhaustive;
    }
  }
}
