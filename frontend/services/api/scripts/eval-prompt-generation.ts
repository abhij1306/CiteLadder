/**
 * Live prompt-generation calibration: each business-context fixture through
 * the quick-generate planner, the configured model and admission, scored by the
 * deterministic set metrics against the configured thresholds. Operator-run
 * only (it calls the provider and spends budget); never part of CI. Metrics and
 * the selected responses append to one log in the worktree's Git directory.
 */
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { policy } from '../src/config.ts';
import { gitDirectory } from './git-directory.ts';
import { createModelGateway } from '../src/models/gateway.ts';
import { generateDrafts } from '../src/prompts/generation-drafts.ts';
import { generationInput, generationSetting } from '../src/prompts/generation-input.ts';
import {
  observedLikeness,
  setMetrics,
  thresholdFailures,
} from '../src/prompts/generation-metrics.ts';
import { selectDrafts } from '../src/prompts/generation-quality.ts';
import {
  fixtureContext,
  fixtureObserved,
  generationFixtures,
} from '../test/fixtures/prompt-generation/context.ts';

const { values } = parseArgs({
  options: {
    live: { type: 'boolean', default: false },
    count: { type: 'string', default: '20' },
    fixture: { type: 'string' },
    // Grounded runs give draft batches the fixture's observed searches; `both`
    // reports each fixture ungrounded and grounded side by side.
    grounding: { type: 'string', default: 'both' },
  },
});
if (!values.live)
  throw new Error('Calibration calls the configured model provider; pass --live to run it');
const count = Number(values.count);
// The same ceiling the API enforces, so an eval cannot outspend a request.
if (!Number.isInteger(count) || count < 1 || count > generationSetting('max_count'))
  throw new Error(`--count must be an integer from 1 to ${generationSetting('max_count')}`);
const modes = new Map([
  ['off', [false]],
  ['on', [true]],
  ['both', [false, true]],
]).get(values.grounding ?? '');
if (!modes) throw new Error('--grounding must be off, on or both');
const gateway = createModelGateway();
const log = join(gitDirectory(process.cwd()), 'prompt-generation-eval.log');
const run = new Date().toISOString();

/** One fixture through planning, the live model, admission and selection, scored. */
async function evaluate(fixture: (typeof generationFixtures)[number], grounded: boolean) {
  const started = performance.now();
  const output = await generateDrafts(
    fixtureContext(fixture, [], { grounded }),
    generationInput.parse({ count }),
    gateway,
    AbortSignal.timeout(generationSetting('generation_deadline_seconds') * 1000),
  );
  const selected = selectDrafts(output.drafts, count);
  const metrics = setMetrics({
    texts: selected.map((draft) => draft.text),
    stages: selected.map((draft) => draft.buyer_stage),
    intents: selected.map((draft) => draft.prompt_intent),
    offerings: fixture.offerings,
    offeringOf: selected.map((draft) => draft.slot.buyer_need.offering ?? ''),
    category: fixture.business_context.category_terms,
    geo: fixture.geo_terms,
    brands: [
      fixture.brand_name,
      ...fixture.brand_aliases,
      ...fixture.competitors.map((row) => row.name),
    ],
  });
  return {
    run,
    fixture: fixture.name,
    grounded,
    slots_grounded: output.grounding.slots_grounded,
    // Measured against the fixture's searches in both modes, so the grounded
    // run's change is visible beside the ungrounded baseline.
    observed_likeness: observedLikeness(
      selected.map((draft) => ({ text: draft.text, topic_id: draft.slot.topic_id })),
      fixtureObserved(fixture),
    ),
    generator_version: policy.prompts.generation.version,
    elapsed_ms: Math.round(performance.now() - started),
    stop: output.stop,
    admission_drops: output.drops,
    metrics,
    failures: thresholdFailures(metrics, {
      market_scope: String(fixture.business_context.market_scope),
      requested: count,
    }),
    models: output.models,
    responses: selected.map((draft) => ({
      buyer_need: draft.slot.buyer_need,
      target_buyer_stage: draft.slot.target_buyer_stage,
      text: draft.text,
      buyer_stage: draft.buyer_stage,
      prompt_intent: draft.prompt_intent,
      names_place: draft.names_place ?? null,
    })),
  };
}

const records = await Promise.all(
  generationFixtures
    .filter((item) => !values.fixture || item.name === values.fixture)
    .flatMap((item) => modes.map((grounded) => evaluate(item, grounded))),
);
await appendFile(log, records.map((record) => `${JSON.stringify(record)}\n`).join(''));
for (const { fixture, grounded, metrics, failures, observed_likeness } of records) {
  const verdict = failures.length ? 'failed ' + failures.join(', ') : 'within thresholds';
  const located = metrics.located_share.toFixed(2);
  process.stdout.write(
    `${fixture} (${grounded ? 'grounded' : 'ungrounded'}): ${metrics.count}/${count} selected, located ${located}, observed-like ${observed_likeness.toFixed(2)}, ${verdict}\n`,
  );
}
process.stdout.write(`Log: ${log}\n`);
