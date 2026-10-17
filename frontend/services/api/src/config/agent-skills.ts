/** Packaged Agent skill metadata and vocabularies. */
import { promptTargetingKeys } from '@citeladder/contracts/prompt-proposal';

import { promptGeneration } from './prompt-generation.ts';

export const agentSkills = {
  groups: ['strategy', 'demand', 'owned_site', 'visibility', 'content'],
  output_kinds: [
    'plan',
    'measurement',
    'research',
    'prompt_portfolio',
    'page_edits',
    'link_plan',
    'technical_fix',
    'diagnosis',
    'earned_brief',
    'content',
  ],
  outline_first_kinds: ['content', 'prompt_portfolio'],
  format_kinds: ['content'],
  description_max_chars: 320,
  body_max_chars: 14000,
  vocabularies: {
    buyer_stages: promptGeneration.stages,
    prompt_intents: Object.keys(promptGeneration.intent_legacy),
    prompt_targeting_keys: promptTargetingKeys,
  },
};
