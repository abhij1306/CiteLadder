import { z } from 'zod';
import { record } from '../db/json.ts';

const measurementShape = {
  retrieval_enabled: z.boolean(),
  max_output_tokens: z.number().int().positive(),
  timeout_seconds: z.number().positive(),
  repetitions: z.number().int().positive(),
  answer_instruction: z.string(),
  max_attempts: z.number().int().positive(),
};
const frozenRouteSchema = z.looseObject({
  logical_engine: z.string(),
  transport_provider: z.string(),
  transport_model: z.string(),
  connection_id: z.string().nullable(),
  base_url: z.string(),
});
const configurationShape = {
  brand_name: z.string(),
  country_code: z.string(),
  language_code: z.string(),
  audit_scope: z.string(),
  benchmark_mode: z.string(),
  system_instruction: z.string(),
  engines: z.array(z.string()),
  not_applicable_engines: z.array(z.string()),
  repetitions: z.number().int().positive(),
  max_attempts: z.number().int().positive(),
  max_run_seconds: z.number().positive(),
  request_timeout_seconds: z.number().positive(),
  anthropic_max_uses: z.number().int().nonnegative(),
  openai_max_tool_calls: z.number().int().nonnegative(),
  panel_hash: z.string(),
  prompt_selection: z.enum(['set', 'selected']),
  measurement_policy: z.looseObject(measurementShape),
  engine_routes: z.record(z.string(), frozenRouteSchema),
};
const frozenConfigurationSchema = z.looseObject(configurationShape);

type FrozenMeasurement = z.infer<z.ZodObject<typeof measurementShape>>;
type FrozenFields = z.infer<z.ZodObject<typeof configurationShape>>;
type FrozenConfiguration = Partial<Omit<FrozenFields, 'measurement_policy'>> & {
  measurement_policy: Partial<FrozenMeasurement>;
};

export function frozenConfiguration<T extends z.input<typeof frozenConfigurationSchema>>(
  configuration: T,
): T {
  frozenConfigurationSchema.parse(configuration);
  return configuration;
}

function readFields<Shape extends Record<string, z.ZodType>>(
  shape: Shape,
  value: unknown,
): Partial<z.infer<z.ZodObject<Shape>>> {
  const source = record(value);
  const fields: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(shape)) {
    const parsed = schema.safeParse(source[key]);
    if (parsed.success) fields[key] = parsed.data;
  }
  return fields as Partial<z.infer<z.ZodObject<Shape>>>;
}

const searchRequestShape = {
  timeout_seconds: z.number().positive(),
  location_code: z.number().int().positive(),
  language_code: z.string().min(1),
  device: z.enum(['desktop', 'mobile']),
  request_settings: z.record(z.string(), z.unknown()),
  recovery_deadline_hours: z.number().positive(),
};
export const readFrozenSearchRequest = (value: unknown) => readFields(searchRequestShape, value);

export const askedWholeSet = (configuration: unknown) =>
  configurationShape.prompt_selection.parse(record(configuration).prompt_selection) === 'set';

export const auditFrozenRetrievalEnabled = (configuration: unknown) =>
  measurementShape.retrieval_enabled.parse(
    record(record(configuration).measurement_policy).retrieval_enabled,
  );

export function readFrozenConfiguration(value: unknown): FrozenConfiguration {
  const { measurement_policy: _measurement, ...fields } = configurationShape;
  return {
    ...readFields(fields, value),
    measurement_policy: readFields(measurementShape, record(value).measurement_policy),
  };
}
