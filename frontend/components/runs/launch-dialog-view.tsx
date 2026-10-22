import { Plus, X } from 'lucide-react';

import { ProviderList } from '@/components/providers/provider-list';
import { Button, IconButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Inline, Stack } from '@/components/ui/layout';
import { MutationNotice } from '@/components/ui/mutation-notice';
import { Select } from '@/components/ui/select';
import type { MutationNotice as MutationNoticeData } from '@/lib/api/mutation-notice';
import type { LogicalEngine, Prompt, PromptSet } from '@/lib/api/types';
import type { ProjectMarket } from '@citeladder/contracts/markets';
import { ENGINE_LABELS, ENGINE_ORDER, isConsumerEngine } from '@/lib/providers/catalog';
import {
  batchLabel,
  clampRepetitions,
  MAX_REPETITIONS,
  MIN_REPETITIONS,
  toggleEngine,
  toggleMarket,
} from '@/lib/runs/launch';
import { textRole } from '@/components/ui/typography';
import { panelClasses } from '@/components/ui/panel';

type Estimate = {
  execution_count: number;
  maximum_attempt_count: number;
  maximum_wall_clock_seconds: number;
  cost_status: string;
  estimated_total_cost_microusd: number | null;
};

/**
 * The prompt selection: a locked, named one, or the project's prompt sets.
 *
 * "Locked" is one contract with the launch payload — whenever the caller fixes
 * the prompts (a prompt set OR an explicit id list), the field states what will
 * run instead of offering a control whose value the payload would ignore. A
 * locked field never reads the prompt-set list, so an empty list is not the
 * caller's problem and "add prompts first" would be the wrong advice.
 */
function PromptSetField({
  promptSets,
  promptSetsLoading,
  promptSetId,
  setPromptSetId,
  promptSetLocked,
  promptSelectionLabel,
}: Readonly<{
  promptSets: PromptSet[];
  promptSetsLoading: boolean;
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
    <Field label="Prompt set" required>
      {(props) => {
        if (locked) {
          return <p className={textRole('body')}>{label}</p>;
        }
        if (!promptSetsLoading && !promptSets.length) {
          return (
            <p className="type-body">No prompt set yet. Add prompts on the Prompts screen first.</p>
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

/**
 * Which slice of the set to run.
 *
 * Only offered when there is more than one batch, unless a refresh invalidated
 * a prior choice. In that case it stays visible so the user can explicitly
 * recover to "All prompts" without silently broadening the launch.
 */
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
    <Field
      label="Prompts to run"
      hint="Run the whole set, or one batch at a time to keep a run short and its cost predictable."
    >
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

/**
 * Provider setup inside the launch dialog, instead of a second dialog stacked
 * on this one. It scrolls on its own so the launch controls stay in reach, and
 * a verified save refreshes the shared connections query, which turns the
 * engine chips on without leaving the dialog.
 */
function InlineProviderSetup({
  connecting,
  onClose,
}: Readonly<{ connecting: LogicalEngine | 'any'; onClose: () => void }>) {
  const engine = connecting === 'any' ? null : connecting;
  return (
    <Stack
      as="section"
      gap="item"
      aria-label="Connect a provider"
      className={panelClasses({ tone: 'well' })}
    >
      <Inline className="justify-between">
        <p className={textRole('label')}>Connect a provider</p>
        <IconButton icon={X} label="Close provider setup" onClick={onClose} />
      </Inline>
      <div className="max-h-80 overflow-y-auto overscroll-contain">
        {/* Keyed by engine so clicking another engine opens its provider. */}
        <ProviderList key={engine ?? 'any'} expandEngine={engine} />
      </div>
    </Stack>
  );
}

/**
 * Which markets to measure from: one run each. Only offered once the project
 * has more than its default market.
 */
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
    <Stack as="fieldset" gap="item">
      <legend className={textRole('label')}>
        Markets <span className="text-muted">*</span>
      </legend>
      <p className="type-caption text-muted">
        Each market runs separately. An engine that cannot measure a market is skipped there.
      </p>
      <Inline className="flex-wrap">
        {markets.map((market) => (
          <Button
            key={market.id ?? 'default'}
            variant="secondary"
            aria-pressed={marketIds.includes(market.id)}
            onClick={() => setMarketIds((current) => toggleMarket(current, market.id))}
          >
            {market.label}
          </Button>
        ))}
      </Inline>
    </Stack>
  );
}

/** A prompt set names its size only when the server counted it. */
function promptSetLabel(set: Readonly<{ name: string; prompt_count?: number | null }>): string {
  const count = typeof set.prompt_count === 'number' ? ` (${set.prompt_count})` : '';
  return `${set.name}${count}`;
}

export function LaunchDialogView({
  open,
  onOpenChange,
  promptSets,
  promptSetsLoading,
  configuredEngines,
  unverifiedEngines,
  promptSetId,
  setPromptSetId,
  batches,
  batchIndex,
  setBatchIndex,
  engines,
  setEngines,
  repetitions,
  setRepetitions,
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
  selectionReady,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  promptSets: PromptSet[];
  promptSetsLoading: boolean;
  configuredEngines: LogicalEngine[];
  unverifiedEngines: LogicalEngine[];
  promptSetId: string | null;
  setPromptSetId: (id: string) => void;
  batches: Prompt[][];
  batchIndex: number | null;
  setBatchIndex: (index: number | null) => void;
  engines: LogicalEngine[];
  setEngines: React.Dispatch<React.SetStateAction<LogicalEngine[]>>;
  repetitions: number;
  setRepetitions: React.Dispatch<React.SetStateAction<number>>;
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
  selectionReady: boolean;
}>) {
  const noEngines = !configuredEngines.length;
  const selected = new Set(engines);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Launch an audit"
      width="wide"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onLaunch} disabled={!selectionReady || launchPending}>
            {launchPending ? 'Launching…' : 'Launch audit'}
          </Button>
        </>
      }
    >
      <Stack gap="workspace">
        {launchNotice ? <MutationNotice notice={launchNotice} onRetry={onLaunch} /> : null}
        <PromptSetField
          promptSets={promptSets}
          promptSetsLoading={promptSetsLoading}
          promptSetId={promptSetId}
          setPromptSetId={setPromptSetId}
          promptSetLocked={promptSetLocked}
          promptSelectionLabel={promptSelectionLabel}
        />
        <BatchField batches={batches} batchIndex={batchIndex} setBatchIndex={setBatchIndex} />
        <Stack as="fieldset" gap="item">
          <legend className={textRole('label')}>
            Engines <span className="text-muted">*</span>
          </legend>
          {noEngines ? (
            <Stack gap="item">
              <p className="type-body">
                {unverifiedEngines.length
                  ? `A key is stored for ${unverifiedEngines.map((engine) => ENGINE_LABELS[engine]).join(', ')}, but it has not passed a connection test yet. Test it to launch an audit with it.`
                  : 'No configured engines. Connect a provider to launch an audit.'}
              </p>
              <div>
                <Button
                  variant="secondary"
                  onClick={() => setConnecting(unverifiedEngines[0] ?? 'any')}
                >
                  {unverifiedEngines.length ? 'Test connection' : 'Connect a provider'}
                </Button>
              </div>
            </Stack>
          ) : null}
          {[true, false].map((consumer) => (
            <Stack key={String(consumer)} gap="item">
              <p className={textRole('label')}>{consumer ? 'Consumer experiences' : 'APIs'}</p>
              <Inline className="flex-wrap">
                {ENGINE_ORDER.filter((engine) => isConsumerEngine(engine) === consumer).map(
                  (engine) => (
                    <Button
                      key={engine}
                      variant="secondary"
                      aria-pressed={selected.has(engine)}
                      onClick={() =>
                        configuredEngines.includes(engine)
                          ? setEngines((current) => toggleEngine(current, engine))
                          : setConnecting(engine)
                      }
                    >
                      {configuredEngines.includes(engine) ? null : <Icon icon={Plus} />}
                      {ENGINE_LABELS[engine]}
                      {configuredEngines.includes(engine) ? null : (
                        <span className="sr-only">, not connected</span>
                      )}
                    </Button>
                  ),
                )}
              </Inline>
            </Stack>
          ))}
          {connecting ? (
            <InlineProviderSetup connecting={connecting} onClose={() => setConnecting(null)} />
          ) : null}
        </Stack>
        <MarketsField markets={markets} marketIds={marketIds} setMarketIds={setMarketIds} />
        <Field
          label="Repetitions"
          hint={`How many times to run each prompt per engine (${MIN_REPETITIONS}–${MAX_REPETITIONS}).`}
        >
          {(props) => (
            <Input
              {...props}
              type="number"
              min={MIN_REPETITIONS}
              max={MAX_REPETITIONS}
              value={repetitions}
              onChange={(event) => setRepetitions(Number(event.target.value))}
              onBlur={() => setRepetitions((current) => clampRepetitions(current))}
            />
          )}
        </Field>
        {estimate ? (
          <Stack gap="tight" className={panelClasses({ tone: 'well' }, 'type-caption')}>
            <span className={textRole('emphasis', 'text-foreground')}>
              {estimate.execution_count} {estimate.execution_count === 1 ? 'response' : 'responses'}{' '}
              planned
            </span>
            <span className="text-muted">
              Maximum wall-clock budget {estimate.maximum_wall_clock_seconds}s · cost{' '}
              {estimate.cost_status}
              {estimate.estimated_total_cost_microusd !== null
                ? ` · ~$${(estimate.estimated_total_cost_microusd / 1_000_000).toFixed(4)}`
                : ' · unavailable'}
            </span>
          </Stack>
        ) : null}
        <p className="type-caption text-muted">
          Answers that mention you or a competitor are also classified for sentiment, using your
          connected providers.
        </p>
      </Stack>
    </Dialog>
  );
}
