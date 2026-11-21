import { useId } from 'react';

import { ProviderList } from '@/components/providers/provider-list';
import { ACTIONS } from '@/components/ui/actions';
import { Button, IconButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, FieldRow } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Inline, Stack } from '@/components/ui/layout';
import { Select } from '@/components/ui/select';
import { Check, Plus, X, type IconGlyph } from '@/lib/icons';
import type { MutationNotice as MutationNoticeData } from '@/lib/api/mutation-notice';
import type { LogicalEngine, Prompt, PromptSet } from '@citeladder/contracts';
import type { ProjectMarket } from '@citeladder/contracts/markets';
import { useEngineCatalog } from '@/lib/providers/engines';
import {
  batchLabel,
  clampRepetitions,
  toggleEngine,
  toggleMarket,
  type RepetitionLimits,
} from '@/lib/runs/launch';
import { textRole } from '@/components/ui/typography';
import { Notice, readErrorProps, type RetryableRead } from '@/components/ui/notice';
import { wellClasses } from '@/components/ui/slip';

type PromptSetsRead = RetryableRead & Readonly<{ status: 'pending' | 'error' | 'success' }>;

type Estimate = {
  execution_count: number;
  maximum_attempt_count: number;
  maximum_wall_clock_seconds: number;
  cost_status: string;
  estimated_total_cost_microusd: number | null;
};

function PromptSetField({
  promptSets,
  promptSetsRead,
  promptSetId,
  setPromptSetId,
  promptSetLocked,
  promptSelectionLabel,
}: Readonly<{
  promptSets: PromptSet[];
  promptSetsRead: PromptSetsRead;
  promptSetId: string | null;
  setPromptSetId: (id: string) => void;
  promptSetLocked?: boolean;
  promptSelectionLabel?: string;
}>) {
  const locked = Boolean(promptSetLocked) || Boolean(promptSelectionLabel);
  const label =
    promptSelectionLabel ??
    promptSets.find((set) => set.id === promptSetId)?.name ??
    'Commerce Product Visibility';
  return (
    <Field label="Prompt set" required layout="row">
      {(props) => {
        if (locked) {
          return <p className={textRole('body', 'text-ink-2')}>{label}</p>;
        }
        if (promptSetsRead.status === 'error') {
          return (
            <Notice
              kind="read"
              {...readErrorProps(promptSetsRead)}
              title="Couldn't load this project's prompt sets"
              fallback="The request failed or timed out."
            />
          );
        }
        if (promptSetsRead.status === 'success' && !promptSets.length) {
          return (
            <p className="type-body text-ink-2">
              No prompt set yet. Add prompts on the Prompts screen first.
            </p>
          );
        }
        return (
          <Select
            {...props}
            ariaLabel="Prompt set"
            value={promptSetId ?? ''}
            onValueChange={setPromptSetId}
            options={promptSets.map((set) => ({
              value: set.id,
              label: promptSetLabel(set),
            }))}
          />
        );
      }}
    </Field>
  );
}

function BatchField({
  batches,
  batchIndex,
  setBatchIndex,
}: Readonly<{
  batches: Prompt[][];
  batchIndex: number | null;
  setBatchIndex: (index: number | null) => void;
}>) {
  if (batches.length < 2 && batchIndex === null) return null;
  const total = batches.reduce((count, batch) => count + batch.length, 0);
  return (
    <Field label="Prompts to run" layout="row">
      {(props) => (
        <Select
          {...props}
          ariaLabel="Prompts to run"
          value={batchIndex === null ? 'all' : String(batchIndex)}
          onValueChange={(value) => setBatchIndex(value === 'all' ? null : Number(value))}
          options={[
            { value: 'all', label: `All ${total} prompts` },
            ...batches.map((batch, index) => ({
              value: String(index),
              label: batchLabel(index, batch),
            })),
          ]}
        />
      )}
    </Field>
  );
}

export function InlineProviderSetup({
  connecting,
  onClose,
  compact = false,
}: Readonly<{ connecting: LogicalEngine | 'any'; onClose: () => void; compact?: boolean }>) {
  const engine = connecting === 'any' ? null : connecting;
  return (
    <Stack as="section" gap="item" aria-label="Connect a provider" className={wellClasses()}>
      <Inline className="justify-between">
        <p className={textRole('body', 'text-ink-2')}>Connect a provider</p>
        <IconButton icon={X} label="Close provider setup" onClick={onClose} />
      </Inline>
      <ProviderList key={engine ?? 'any'} expandEngine={engine} compact={compact} />
    </Stack>
  );
}

function MarketsField({
  markets,
  marketIds,
  setMarketIds,
}: Readonly<{
  markets: readonly ProjectMarket[];
  marketIds: (string | null)[];
  setMarketIds: React.Dispatch<React.SetStateAction<(string | null)[]>>;
}>) {
  if (markets.length < 2) return null;
  return (
    <ChoiceRow label="Markets">
      <Inline className="flex-wrap">
        {markets.map((market) => (
          <ChoiceChip
            key={market.id ?? 'default'}
            selected={marketIds.includes(market.id)}
            onClick={() => setMarketIds((current) => toggleMarket(current, market.id))}
          >
            {market.label}
          </ChoiceChip>
        ))}
      </Inline>
      <p className="type-caption">
        Each market runs separately. An engine that cannot measure a market is skipped there.
      </p>
    </ChoiceRow>
  );
}

function ChoiceRow({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  const labelId = useId();
  return (
    <FieldRow label={label} required labelId={labelId}>
      <Stack as="fieldset" gap="item" aria-labelledby={labelId}>
        {children}
      </Stack>
    </FieldRow>
  );
}

function ChoiceChip({
  selected,
  onClick,
  leading,
  children,
}: Readonly<{
  selected: boolean;
  onClick: () => void;
  leading?: IconGlyph;
  children: React.ReactNode;
}>) {
  const glyph = selected ? Check : leading;
  return (
    <Button variant="secondary" aria-pressed={selected} onClick={onClick}>
      {glyph ? <Icon icon={glyph} /> : null}
      {children}
    </Button>
  );
}

function LaunchFooter({
  blocker,
  pending,
  onLaunch,
  onCancel,
}: Readonly<{
  blocker: string | null;
  pending: boolean;
  onLaunch: () => void;
  onCancel: () => void;
}>) {
  const reasonId = useId();
  return (
    <>
      {blocker ? (
        <span id={reasonId} className="sr-only">
          {blocker}
        </span>
      ) : null}
      <Button variant="quiet" onClick={onCancel}>
        <Icon icon={X} />
        Cancel
      </Button>
      <Button
        variant="primary"
        onClick={onLaunch}
        disabled={blocker !== null || pending}
        aria-describedby={blocker ? reasonId : undefined}
      >
        {pending ? 'Launching…' : ACTIONS.launchRun.label}
      </Button>
    </>
  );
}

function RepetitionsField({
  repetitions,
  setRepetitions,
  limits,
}: Readonly<{
  repetitions: number;
  setRepetitions: React.Dispatch<React.SetStateAction<number>>;
  limits: RepetitionLimits | null;
}>) {
  return (
    <Field label="Repetitions" layout="row">
      {(props) => (
        <Input
          {...props}
          type="number"
          min={limits?.audit_repetitions_min}
          max={limits?.audit_repetitions_max}
          value={repetitions}
          onChange={(event) => setRepetitions(Number(event.target.value))}
          onBlur={() => {
            if (limits) setRepetitions((current) => clampRepetitions(current, limits));
          }}
        />
      )}
    </Field>
  );
}

function EstimateNote({ estimate }: Readonly<{ estimate: Estimate }>) {
  return (
    <Stack gap="tight" className={wellClasses('type-caption')}>
      <span className={textRole('emphasis', 'text-ink')}>
        {estimate.execution_count} {estimate.execution_count === 1 ? 'response' : 'responses'}{' '}
        planned
      </span>
      <span className="text-ink-2">
        Maximum wall-clock budget {estimate.maximum_wall_clock_seconds}s · cost{' '}
        {estimate.cost_status}
        {estimate.estimated_total_cost_microusd !== null
          ? ` · ~$${(estimate.estimated_total_cost_microusd / 1_000_000).toFixed(4)}`
          : ' · unavailable'}
      </span>
    </Stack>
  );
}

function promptSetLabel(set: Readonly<{ name: string; prompt_count?: number | null }>): string {
  const count = typeof set.prompt_count === 'number' ? ` (${set.prompt_count})` : '';
  return `${set.name}${count}`;
}

export function LaunchDialogView({
  open,
  onOpenChange,
  promptSets,
  promptSetsRead,
  configuredEngines,
  promptSetId,
  setPromptSetId,
  batches,
  batchIndex,
  setBatchIndex,
  engines,
  setEngines,
  repetitions,
  setRepetitions,
  repetitionLimits,
  markets,
  marketIds,
  setMarketIds,
  estimate,
  launchPending,
  launchNotice,
  onLaunch,
  connecting,
  setConnecting,
  promptSetLocked,
  promptSelectionLabel,
  blocker,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  promptSets: PromptSet[];
  promptSetsRead: PromptSetsRead;
  configuredEngines: LogicalEngine[];
  promptSetId: string | null;
  setPromptSetId: (id: string) => void;
  batches: Prompt[][];
  batchIndex: number | null;
  setBatchIndex: (index: number | null) => void;
  engines: LogicalEngine[];
  setEngines: React.Dispatch<React.SetStateAction<LogicalEngine[]>>;
  repetitions: number;
  setRepetitions: React.Dispatch<React.SetStateAction<number>>;
  repetitionLimits: RepetitionLimits | null;
  markets: readonly ProjectMarket[];
  marketIds: (string | null)[];
  setMarketIds: React.Dispatch<React.SetStateAction<(string | null)[]>>;
  estimate?: Estimate;
  launchPending: boolean;
  launchNotice: MutationNoticeData | null;
  onLaunch: () => void;
  connecting: LogicalEngine | 'any' | null;
  setConnecting: (target: LogicalEngine | 'any' | null) => void;
  promptSetLocked?: boolean;
  promptSelectionLabel?: string;
  blocker: string | null;
}>) {
  const catalog = useEngineCatalog();
  const selected = new Set(engines);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Launch a run"
      width="prose"
      footer={
        <LaunchFooter
          blocker={blocker}
          pending={launchPending}
          onLaunch={onLaunch}
          onCancel={() => onOpenChange(false)}
        />
      }
    >
      <Stack gap="workspace">
        {launchNotice ? <Notice kind="mutation" notice={launchNotice} onRetry={onLaunch} /> : null}
        <PromptSetField
          promptSets={promptSets}
          promptSetsRead={promptSetsRead}
          promptSetId={promptSetId}
          setPromptSetId={setPromptSetId}
          promptSetLocked={promptSetLocked}
          promptSelectionLabel={promptSelectionLabel}
        />
        <BatchField batches={batches} batchIndex={batchIndex} setBatchIndex={setBatchIndex} />
        <RepetitionsField
          repetitions={repetitions}
          setRepetitions={setRepetitions}
          limits={repetitionLimits}
        />
        <ChoiceRow label="Engines">
          {[true, false].map((consumer) => (
            <Stack key={String(consumer)} gap="item">
              <p className={textRole('captionStrong')}>
                {consumer ? 'Consumer experiences' : 'APIs'}
              </p>
              <Inline className="flex-wrap">
                {catalog.order
                  .filter((engine) => catalog.isObserved(engine) === consumer)
                  .map((engine) => {
                    const connected = configuredEngines.includes(engine);
                    return (
                      <ChoiceChip
                        key={engine}
                        selected={selected.has(engine)}
                        leading={connected ? undefined : Plus}
                        onClick={() =>
                          connected
                            ? setEngines((current) => toggleEngine(current, engine))
                            : setConnecting(engine)
                        }
                      >
                        {catalog.label(engine)}
                        {connected ? null : <span className="sr-only">, not connected</span>}
                      </ChoiceChip>
                    );
                  })}
              </Inline>
            </Stack>
          ))}
          {connecting ? (
            <InlineProviderSetup
              connecting={connecting}
              onClose={() => setConnecting(null)}
              compact
            />
          ) : null}
        </ChoiceRow>
        <MarketsField markets={markets} marketIds={marketIds} setMarketIds={setMarketIds} />
        {estimate ? <EstimateNote estimate={estimate} /> : null}
        <p className="type-caption text-ink-2">
          Answers that mention you or a competitor are also classified for sentiment, using your
          connected providers.
        </p>
      </Stack>
    </Dialog>
  );
}
