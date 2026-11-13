import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, Sparkles } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Drawer } from '@/components/ui/drawer';
import { Icon } from '@/components/ui/icon';
import { Inline } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';
import { readErrorProps } from '@/components/ui/read-error';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import type { PromptGenerateRequest } from '@citeladder/contracts/prompt-requests';
import { topicsQueries } from '@/lib/api/topics';
import type {
  PromptFormLimits,
  PromptGenerateResponse,
  SeedQueries,
  Topic,
} from '@citeladder/contracts';
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
  generate: (input: PromptGenerateRequest) => Promise<PromptGenerateResponse | null>;
  isGenerating: boolean;
  generateError?: unknown;
  /** The pending-candidate review list. */
  review: ReactNode;
  /** The request bounds the API enforces, from the prompt-set list. */
  limits: PromptFormLimits;
};

/** What this open of the builder generated: its request and every run it made. */
type Session = { request: PromptGenerateRequest; results: PromptGenerateResponse[] };

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
  const { projectId, workspaceId, topics, hasCompetitors, isGenerating, generateError, limits } =
    props;
  const scope = { workspaceId, projectId };
  const [step, setStep] = useState<BuilderStep>(props.initialStep);
  const business = useBuilderBusiness({ projectId, workspaceId });
  const seedsQuery = useQuery(topicsQueries.seedQueries(scope));
  const topicStep = useBuilderTopics({ scope, topics });
  const [edited, setEdited] = useState<RunSettings | null>(null);
  const settings = edited ?? defaultRunSettings();
  const personas = business.draft ? personaChoices(business.draft) : [];
  const built = runRequest(settings, {
    seeds: seedsQuery.data ?? null,
    hasCompetitors,
    personaChoices: personas,
    limits,
  });
  const [run, setRun] = useState<Session | null>(null);

  const generate = async (request: PromptGenerateRequest, more: boolean) => {
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
        <Callout tone="info">
          Writing and quality-checking questions can take a minute or two. Keep this open.
        </Callout>
      ) : null}
      {generateError ? <GenerateErrorAlert error={generateError} /> : null}
    </>
  );

  return (
    <Drawer
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Prompt Builder"
      description="Only suggestions you accept are tracked."
      closeLabel="Close Prompt Builder"
      width="wide"
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
            limits={limits}
          />
        </TabPanel>
        <TabPanel value="topics">
          <BuilderTopicsStep topics={topicStep} />
        </TabPanel>
        <TabPanel value="distribution">
          <BuilderDistributionStep
            settings={settings}
            onChange={setEdited}
            limits={limits}
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
  return built.ok ? null : <Callout tone="warning">{built.problem}</Callout>;
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
    <Callout tone="warning">
      {sentence.charAt(0).toUpperCase() + sentence.slice(1)}, so this run will not use them.
    </Callout>
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
