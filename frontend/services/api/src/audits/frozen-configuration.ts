/**
 * The typed audit configuration frozen at admission. `freeze.ts` writes it
 * through `frozenConfiguration`; every reader goes through
 * `readFrozenConfiguration`, which reads field by field: a missing or
 * malformed field stays unavailable (undefined) and is never filled from the
 * live configuration.
 */
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
  measurement_policy: z.looseObject(measurementShape),
  engine_routes: z.record(z.string(), frozenRouteSchema),
};
const frozenConfigurationSchema = z.looseObject(configurationShape);

type FrozenMeasurement = z.infer<z.ZodObject<typeof measurementShape>>;
type FrozenFields = z.infer<z.ZodObject<typeof configurationShape>>;
/** What a reader sees: every field possibly unavailable, the measurement block likewise. */
type FrozenConfiguration = Partial<Omit<FrozenFields, 'measurement_policy'>> & {
  measurement_policy: Partial<FrozenMeasurement>;
};

/** The configuration to persist, refused when a typed field is missing or malformed. */
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
  // Every key was validated against its own schema above.
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
/** A search-surface task's frozen request (`request_snapshot`), read field by field. */
export const readFrozenSearchRequest = (value: unknown) => readFields(searchRequestShape, value);

/** A stored configuration's typed fields; anything missing or malformed is unavailable. */
export function readFrozenConfiguration(value: unknown): FrozenConfiguration {
  const { measurement_policy: _measurement, ...fields } = configurationShape;
  return {
    ...readFields(fields, value),
    measurement_policy: readFields(measurementShape, record(value).measurement_policy),
  };
}
