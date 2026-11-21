import { promptGeneration } from './prompt-generation.ts';

export const agentSkills = {
  groups: ['strategy', 'demand', 'owned_site', 'visibility', 'content'],
  output_kinds: [
    'plan',
    'measurement',
    'research',
    'prompt_plan',
    'page_edits',
    'link_plan',
    'technical_fix',
    'diagnosis',
    'earned_brief',
    'content',
    'page',
  ],
  format_kinds: ['content'],
  fetched_kinds: ['page'],
  description_max_chars: 320,
  body_max_chars: 14000,
  vocabularies: {
    buyer_stages: promptGeneration.stages,
    prompt_intents: Object.keys(promptGeneration.intent_legacy),
  },
};
