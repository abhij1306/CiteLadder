import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { lazy, useEffect, type ReactNode } from 'react';

import { ANSWER_FORMAT_LABELS } from '@/components/runs/answer-formats';
import { choiceFilter } from '@/components/ui/all-filters';
import { ClampText } from '@/components/ui/clamp-text';
import { Dialog } from '@/components/ui/dialog';
import { EngineMark, engineMarkKey } from '@/components/ui/engine-mark';
import { FilterControls } from '@/components/ui/filter-bar';
import { Icon } from '@/components/ui/icon';
import { IslandUnavailable, LazyIsland } from '@/components/ui/lazy-island';
import { Stack } from '@/components/ui/layout';
import { Notice, readErrorProps } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import { StateBlock } from '@/components/ui/state-block';
import { StatusMark } from '@/components/ui/status-mark';
import { Tag } from '@/components/ui/tag';
import { TextLink } from '@/components/ui/text-link';
import type { ExecutionEvidence, ExecutionStatus } from '@citeladder/contracts';
import { Globe, ICONS } from '@/lib/icons';
import { runsQueries } from '@/lib/api/runs';
import { formatCountry } from '@/lib/format';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { promptHistoryHref } from '@/lib/prompts/history';
import { useEngineCatalog } from '@/lib/providers/engines';
import { EXECUTION_STATES, executionStatusLabel } from '@/lib/runs/status';
import { usePromptEngineAnswers } from '@/lib/runs/use-prompt-engine-answers';

const loadAnswerEvidence = () => import('@/components/runs/answer-evidence');
const AnswerEvidence = lazy(() =>
  loadAnswerEvidence().then(({ AnswerEvidence }) => ({ default: AnswerEvidence })),
);

export type EvidenceSubject = {
  id: string | null;
  prompt_text?: string;
  prompt_index?: number;
  prompt_id?: string | null;
};

function answerTitle(subject: EvidenceSubject | null): ReactNode {
  if (subject?.prompt_text) return <ClampText>{subject.prompt_text}</ClampText>;
  if (subject?.prompt_index !== undefined) return `Prompt #${subject.prompt_index + 1}`;
  return 'Answer';
}

function AnswerLoading() {
  return (
    <Stack gap="workspace" aria-label="Loading the answer">
      <Skeleton lines={1} />
      <Skeleton lines={3} />
      <Skeleton variant="facts" />
    </Stack>
  );
}

function flagOf(code: string): string | null {
  const upper = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/u.test(upper)) return null;
  return String.fromCodePoint(
    ...[...upper].map((letter) => 0x1f1a5 + (letter.codePointAt(0) ?? 0)),
  );
}

function MarketChip({ auditId }: Readonly<{ auditId: string }>) {
  const { workspaceId } = useProjectScope();
  const audit = useQuery(runsQueries.detail(workspaceId, auditId));
  const code = audit.data?.market.country_code;
  if (!code) return null;
  const flag = flagOf(code);
  return (
    <Tag>
      {flag ? <span aria-hidden>{flag}</span> : <Icon icon={Globe} />}
      {formatCountry(code)}
    </Tag>
  );
}

function EngineChip({ engine }: Readonly<{ engine: string }>) {
  const label = useEngineCatalog().label(engine);
  const key = engineMarkKey(engine);
  return (
    <Tag>
      {key ? <EngineMark engine={key} placement="inline" /> : null}
      {label}
    </Tag>
  );
}

const SENTIMENT_WORDS = {
  positive: 'Positive sentiment',
  neutral: 'Neutral sentiment',
  negative: 'Negative sentiment',
  mixed: 'Mixed sentiment',
} as const;

function SentimentChip({ evidence }: Readonly<{ evidence: ExecutionEvidence }>) {
  const own = evidence.perception.find((entity) => entity.is_brand);
  const label = own?.state === 'classified' ? own.label : null;
  if (!label || label === 'not_assessable') return null;
  return (
    <StatusMark variant="sentiment" value={label}>
      {SENTIMENT_WORDS[label]}
    </StatusMark>
  );
}

function FeatureFlags({ evidence }: Readonly<{ evidence: ExecutionEvidence }>) {
  const { ads, answer_formats: formats } = evidence;
  let adsWord: string | null = null;
  if (ads.applicability === 'applicable')
    adsWord = ads.items.length === 1 ? '1 ad' : `${ads.items.length || 'No'} ads`;
  return (
    <>
      {evidence.search === 'used' ? <Tag>Web search used</Tag> : null}
      {adsWord ? <Tag>{adsWord}</Tag> : null}
      {formats.kind === 'observed'
        ? formats.formats.map((format) => <Tag key={format}>{ANSWER_FORMAT_LABELS[format]}</Tag>)
        : null}
    </>
  );
}

function StatusChip({ status, engine }: Readonly<{ status: ExecutionStatus; engine: string }>) {
  const label = executionStatusLabel(status, useEngineCatalog().label(engine));
  return (
    <StatusMark variant="status" value={EXECUTION_STATES[status].badge}>
      {label}
    </StatusMark>
  );
}

function AnswerBody({
  query,
  promptText,
  promptId,
  unavailable,
  attributes,
}: Readonly<{
  query: UseQueryResult<ExecutionEvidence>;
  promptText: string | null;
  promptId: string | undefined;
  unavailable?: string;
  attributes?: boolean;
}>) {
  if (unavailable) return <StateBlock kind="empty" icon={ICONS.runs} heading={unavailable} />;
  if (query.isError)
    return (
      <Notice
        kind="read"
        {...readErrorProps(query)}
        title="Couldn't load this answer's evidence"
        fallback="The request failed or timed out."
      />
    );
  if (!query.data) return <AnswerLoading />;
  return (
    <LazyIsland
      label="answer-evidence"
      defects="surface"
      loading={<AnswerLoading />}
      failed={<IslandUnavailable message="Couldn't load the answer." />}
    >
      <AnswerEvidence
        evidence={query.data}
        promptText={promptText}
        promptId={promptId}
        attributes={attributes}
      />
    </LazyIsland>
  );
}

function AnswerToolbar({
  evidence,
  engines,
  promptId,
}: Readonly<{
  evidence: ExecutionEvidence | undefined;
  engines: ReturnType<typeof usePromptEngineAnswers>;
  promptId: string | null | undefined;
}>) {
  return (
    <>
      {evidence ? (
        <>
          {engines.shown ? (
            <StatusChip status={engines.shown.status} engine={evidence.logical_engine} />
          ) : null}
          <EngineChip engine={evidence.logical_engine} />
          <MarketChip auditId={evidence.audit_id} />
          <SentimentChip evidence={evidence} />
          <FeatureFlags evidence={evidence} />
        </>
      ) : null}
      {engines.options.length > 1 && engines.activeId !== null ? (
        <FilterControls
          filters={[
            choiceFilter({
              id: 'engine',
              label: 'Engine',
              value: engines.activeId,
              defaultValue: engines.activeId,
              groups: [{ options: engines.options }],
              onChange: engines.select,
            }),
          ]}
        />
      ) : null}
      {promptId ? (
        <TextLink href={promptHistoryHref(promptId)} text="caption" className="ms-auto">
          Prompt history
        </TextLink>
      ) : null}
    </>
  );
}

export function AnswerDialog({
  execution,
  open,
  onOpenChange,
  unavailable,
  attributes,
}: Readonly<{
  execution: EvidenceSubject | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unavailable?: string;
  attributes?: boolean;
}>) {
  const { workspaceId } = useProjectScope();
  const engines = usePromptEngineAnswers({
    workspaceId,
    executionId: execution?.id ?? null,
    enabled: open,
  });
  const evidenceQuery = useQuery({
    ...runsQueries.execution(workspaceId, engines.activeId),
    enabled: open && engines.activeId !== null,
  });
  useEffect(() => {
    if (open) void loadAnswerEvidence().catch(() => {});
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={answerTitle(execution)}
      width="answer"
      toolbar={
        <AnswerToolbar
          evidence={unavailable ? undefined : evidenceQuery.data}
          engines={engines}
          promptId={execution?.prompt_id}
        />
      }
    >
      <AnswerBody
        query={evidenceQuery}
        promptText={engines.shown?.prompt_text ?? null}
        promptId={execution?.prompt_id ?? undefined}
        unavailable={unavailable}
        attributes={attributes}
      />
    </Dialog>
  );
}
