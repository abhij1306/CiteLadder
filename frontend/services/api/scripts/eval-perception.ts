/**
 * Live answer-perception calibration: each hand-labelled answer through the
 * passage builder, the configured gateway model and the deterministic
 * validator, scored for label agreement, macro F1, quote validity and tokens
 * per answer against the configured thresholds. Operator-run only (it calls
 * the provider and spends platform budget); never part of CI. Records append
 * to one log in the worktree's Git directory.
 */
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';

import { scoringConfig } from '../src/analysis/scoring.ts';
import { policy } from '../src/config.ts';
import { gitDirectory } from './git-directory.ts';
import { createModelGateway } from '../src/models/gateway.ts';
import { LABELS, perceptionOutputSchema, perceptionPrompt } from '../src/perception/model.ts';
import { entityPassages, type PerceptionPackage } from '../src/perception/passages.ts';
import { validateOutput } from '../src/perception/validate.ts';
import raw from '../test/fixtures/perception/answers.json' with { type: 'json' };

const { values } = parseArgs({
  options: { live: { type: 'boolean', default: false }, fixture: { type: 'string' } },
});
if (!values.live)
  throw new Error('Calibration calls the configured model provider; pass --live to run it');
const fixtures = z
  .array(
    z.object({
      name: z.string(),
      language: z.string(),
      prompt: z.string(),
      brand_name: z.string(),
      competitors: z.array(z.string()),
      answer: z.string(),
      labels: z.record(z.string(), z.enum(LABELS)),
    }),
  )
  .parse(raw);
const settings = policy.perception;
const gateway = createModelGateway();
const log = join(gitDirectory(process.cwd()), 'perception-eval.log');
const run = new Date().toISOString();

type Fixture = (typeof fixtures)[number];

async function evaluate(fixture: Fixture) {
  const config = scoringConfig({
    brand_name: fixture.brand_name,
    competitors: fixture.competitors.map((name) => ({ name, domains: [] })),
  });
  const pkg: PerceptionPackage = {
    extractor_version: settings.extractor_version,
    template_version: settings.template_version,
    language: fixture.language,
    prompt: fixture.prompt,
    entities: entityPassages({
      answer: fixture.answer,
      languageCode: fixture.language,
      config,
      policy: settings,
    }),
  };
  const { system, user } = perceptionPrompt(pkg, settings);
  const { value, result } = await gateway.structured(system, user, perceptionOutputSchema);
  const validated = validateOutput(pkg, value, settings);
  const expected = fixture.labels;
  return {
    run,
    fixture: fixture.name,
    template_version: settings.template_version,
    pairs: validated.entities
      .filter((entity) => expected[entity.entity_name] !== undefined)
      .map((entity) => ({
        entity: entity.entity_name,
        expected: expected[entity.entity_name]!,
        actual: entity.label,
        confidence: entity.confidence,
      })),
    quotes: validated.entities.reduce((sum, entity) => sum + entity.aspects.length, 0),
    drops: validated.drops,
    total_tokens: Number(result.usage.total_tokens ?? 0),
    model: result.returned_model,
  };
}

const selected = fixtures.filter((item) => !values.fixture || item.name === values.fixture);
if (!selected.length) throw new Error(`No calibration fixture is named ${values.fixture}`);
const records = await Promise.all(selected.map(evaluate));
await appendFile(log, records.map((record) => `${JSON.stringify(record)}\n`).join(''));

const pairs = records.flatMap((record) => record.pairs);
if (!pairs.length) throw new Error('No labelled business was found in the evaluated answers');
const agreement = pairs.filter((pair) => pair.expected === pair.actual).length / pairs.length;
// Macro F1 over the labels that occur, so an absent label cannot score zero.
const occurring = LABELS.filter((label) =>
  pairs.some((pair) => pair.expected === label || pair.actual === label),
);
const f1 = occurring.map((label) => {
  const tp = pairs.filter((p) => p.actual === label && p.expected === label).length;
  const fp = pairs.filter((p) => p.actual === label && p.expected !== label).length;
  const fn = pairs.filter((p) => p.actual !== label && p.expected === label).length;
  return (2 * tp) / (2 * tp + fp + fn);
});
const macroF1 = f1.reduce((sum, value) => sum + value, 0) / f1.length;
const kept = records.reduce((sum, record) => sum + record.quotes, 0);
const invented = records.reduce((sum, record) => sum + (record.drops.quote_not_found ?? 0), 0);
const quoteValidity = kept + invented ? kept / (kept + invented) : 1;
const tokens = records.reduce((sum, record) => sum + record.total_tokens, 0) / records.length;
const limits = settings.eval_thresholds;
const failures = [
  agreement < limits.min_label_agreement && 'label_agreement',
  macroF1 < limits.min_macro_f1 && 'macro_f1',
  quoteValidity < limits.min_quote_validity && 'quote_validity',
  tokens > limits.max_total_tokens_per_answer && 'tokens_per_answer',
].filter(Boolean);
const verdict = failures.length ? 'failed ' + failures.join(', ') : 'within thresholds';
process.stdout.write(
  `${records.length} answers, ${pairs.length} labels (${settings.eval_policy_version}): ` +
    `agreement ${agreement.toFixed(2)}, macro F1 ${macroF1.toFixed(2)}, ` +
    `quote validity ${quoteValidity.toFixed(2)}, tokens/answer ${Math.round(tokens)}; ` +
    `${verdict}\nLog: ${log}\n`,
);
