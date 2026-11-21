import { logicalEngineSchema } from '@citeladder/contracts/providers';
import { z } from 'zod';
import value from './probes.json' with { type: 'json' };
import { ConfigError } from './config-error.ts';

const positive = z.int().positive();
const template = z.string().trim().min(1);

const schema = z.strictObject({
  audit_scope: z.literal('probe'),
  cohort: z.literal('probe'),
  task_kind: z.literal('probe_labelling'),
  labelling_version: z.string().trim().min(1).max(64),
  repetitions: positive,
  engines: z.array(logicalEngineSchema).min(1),
  answer_credits: z.record(z.string(), positive),
  label_credits: positive,
  questions: z.strictObject({ known_for: template, objection: template, theme: template }),
  max_answer_chars: positive,
  max_items_per_answer: positive,
  max_new_groups_per_probe: positive,
  group_name_max_chars: positive,
  max_attempts: positive,
  task_max_attempts: positive,
  history_probes: positive,
  max_sources_per_group: positive,
  known_for_template: template,
  objection_template: template,
  theme_template: template,
  system_template: template,
});

const SLOTS = [
  ['known_for_template', ['{brand}', '{themes}', '{fallback}', '{max_items}', '{answers}']],
  ['objection_template', ['{brand}', '{groups}', '{max_items}', '{answers}']],
  ['theme_template', ['{question}', '{max_items}', '{answers}']],
] as const;

function loadProbes(input: unknown) {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new ConfigError('Invalid probe configuration: ' + result.error.message);
  const config = result.data;
  for (const engine of config.engines)
    if (config.answer_credits[engine] === undefined)
      throw new ConfigError(`Probe engine ${engine} has no answer price`);
  for (const [key, slots] of SLOTS)
    for (const slot of slots)
      if (!config[key].includes(slot)) throw new ConfigError(`Probe ${key} is missing ${slot}`);
  for (const slot of ['{theme}', '{country}'])
    if (!config.questions.theme.includes(slot))
      throw new ConfigError(`Probe theme question is missing ${slot}`);
  return config;
}

export const probes = loadProbes(value);
export type ProbePolicy = typeof probes;
