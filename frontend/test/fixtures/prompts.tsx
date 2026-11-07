import type { z } from 'zod';

import {
  promptFormLimitsSchema,
  promptSchema,
  promptSetListSchema,
  promptSetSchema,
} from '@citeladder/contracts/project';

type Prompt = z.infer<typeof promptSchema>;
type PromptSet = z.infer<typeof promptSetSchema>;
type PromptFormLimits = z.infer<typeof promptFormLimitsSchema>;
type PromptSetList = z.infer<typeof promptSetListSchema>;

const SET_ID = '22222222-2222-4222-8222-222222222222';

export function makePrompt(overrides: Partial<Prompt> = {}): Prompt {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    prompt_set_id: SET_ID,
    text: 'Best running shoes?',
    theme: 'Comfort',
    intent: 'discovery',
    buyer_stage: '',
    prompt_intent: '',
    persona: '',
    cohort: 'core',
    branded: false,
    enabled: true,
    status: 'active',
    origin: 'manual',
    ...overrides,
  };
}

export function makeSet(prompts: Prompt[]): PromptSet {
  return {
    id: SET_ID,
    project_id: '11111111-1111-4111-8111-111111111111',
    name: 'Default prompt set',
    description: '',
    prompt_count: prompts.length,
    prompts,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

/** Form bounds as the API lists them; tests override the one they exercise. */
export function makeFormLimits(overrides: Partial<PromptFormLimits> = {}): PromptFormLimits {
  return {
    generation_count_max: 50,
    import_rows_max: 500,
    persona_max_chars: 120,
    run_context_max_chars: 280,
    distribution_personas_max: 8,
    seed_query_ids_max: 200,
    context_list_max_entries: 20,
    audit_repetitions_min: 1,
    audit_repetitions_max: 10,
    ...overrides,
  };
}

/** The prompt-set list read: the sets plus the form bounds. */
export function makeSetList(
  sets: PromptSet[],
  limits: PromptFormLimits = makeFormLimits(),
): PromptSetList {
  return { prompt_sets: sets, limits };
}
