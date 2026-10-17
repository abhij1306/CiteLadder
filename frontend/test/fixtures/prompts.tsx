import type { z } from 'zod';

import { promptSchema, promptSetSchema } from '@citeladder/contracts/project';

type Prompt = z.infer<typeof promptSchema>;
type PromptSet = z.infer<typeof promptSetSchema>;

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
