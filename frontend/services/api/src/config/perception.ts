import { factTopicSchema } from '@citeladder/contracts/fact-checking';
import { z } from 'zod';
import value from './perception.json' with { type: 'json' };
import { ConfigError } from './config-error.ts';

const positive = z.int().positive();
const version = z.string().trim().min(1).max(64);
const share = z.number().min(0).max(1);
const factCheck = z.strictObject({
  verification_task_kind: z.literal('fact_verification'),
  claims_version: version,
  verify_template_version: version,
  metrics_version: version,
  topics: z.array(factTopicSchema).min(1),
  related_topics: z.record(z.string(), z.array(factTopicSchema)),
  statement_max_chars: positive,
  source_url_max_chars: positive,
  max_facts_per_project: positive,
  facts_import_max_rows: positive,
  override_note_max_chars: positive,
  max_frozen_facts: positive,
  max_claims_per_answer: positive,
  max_facts_per_verification: positive,
  max_verifications_per_audit: positive,
  max_verifications_per_workspace_per_day: positive,
  min_confidence: share,
  min_contradiction_confidence: share,
  max_attempts: positive,
  task_max_attempts: positive,
  max_contradicted_claims: positive,
  max_cited_alongside: positive,
  claims_default_limit: positive,
  claims_max_limit: positive,
  claims_export_max_rows: positive,
  eval_policy_version: version,
  eval_thresholds: z.strictObject({
    max_false_contradiction_rate: share,
    min_verdict_agreement: share,
    min_quote_validity: share,
    max_total_tokens_per_answer: positive,
  }),
  claims_system_addendum: z.string().trim().min(1),
  claims_user_addendum: z.string().trim().min(1),
  verify_system_template: z.string().trim().min(1),
  verify_user_template: z.string().trim().min(1),
});

const schema = z.strictObject({
  task_kind: z.literal('answer_perception'),
  extractor_version: version,
  template_version: version,
  metrics_version: version,
  min_confidence: share,
  max_entities: positive,
  max_passage_chars_per_entity: positive,
  max_aspects_per_entity: positive,
  max_quotes_per_theme: positive,
  max_negative_quotes: positive,
  max_drivers: positive,
  max_classifications_per_audit: positive,
  max_classifications_per_workspace_per_day: positive,
  max_attempts: positive,
  task_max_attempts: positive,
  quotes_default_limit: positive,
  quotes_max_limit: positive,
  project_themes: z.strictObject({
    fallback: z.string().trim().min(1),
    name_max_chars: positive,
    research_max: positive,
    research_max_words: positive,
    research_min_confidence: share,
    company_fact_terms: z.array(z.string().trim().toLowerCase().min(1)),
  }),
  eval_policy_version: version,
  eval_thresholds: z.strictObject({
    min_label_agreement: share,
    min_macro_f1: share,
    min_quote_validity: share,
    max_total_tokens_per_answer: positive,
  }),
  system_template: z.string().trim().min(1),
  user_template: z.string().trim().min(1),
  max_untracked_names_per_answer: positive,
  max_untracked_name_chars: positive,
  fact_check: factCheck,
});

function assertFactCheck(facts: z.output<typeof factCheck>) {
  if (new Set(facts.topics).size !== facts.topics.length)
    throw new ConfigError('Fact-check topics must be unique');
  for (const [topic, related] of Object.entries(facts.related_topics)) {
    const parsed = factTopicSchema.safeParse(topic);
    if (
      !parsed.success ||
      related.includes(parsed.data) ||
      related.some((other) => !facts.topics.includes(other))
    )
      throw new ConfigError(`Fact-check related topics for ${topic} are invalid`);
  }
  if (facts.claims_default_limit > facts.claims_max_limit)
    throw new ConfigError('Fact-check claim default limit exceeds its maximum');
  if (facts.min_contradiction_confidence < facts.min_confidence)
    throw new ConfigError('Fact-check contradiction confidence must not be below the floor');
  for (const slot of ['{topics}', '{max_claims}'])
    if (!facts.claims_user_addendum.includes(slot))
      throw new ConfigError(`Fact-check claims addendum is missing ${slot}`);
  for (const slot of ['{brand}', '{language}', '{facts}', '{claims}'])
    if (!facts.verify_user_template.includes(slot))
      throw new ConfigError(`Fact-check verification template is missing ${slot}`);
}

function loadPerception(input: unknown) {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new ConfigError('Invalid perception configuration: ' + result.error.message);
  const config = result.data;
  if (config.quotes_default_limit > config.quotes_max_limit)
    throw new ConfigError('Perception quote default limit exceeds its maximum');
  for (const slot of ['{prompt}', '{language}', '{themes}', '{max_aspects}', '{entities}'])
    if (!config.user_template.includes(slot))
      throw new ConfigError(`Perception user template is missing ${slot}`);
  assertFactCheck(config.fact_check);
  return config;
}

export const perception = loadPerception(value);
export type PerceptionPolicy = typeof perception;

export const factTopicOrder: ReadonlyMap<string, number> = new Map(
  perception.fact_check.topics.map((topic, index) => [topic, index]),
);
export type FactCheckPolicy = PerceptionPolicy['fact_check'];
