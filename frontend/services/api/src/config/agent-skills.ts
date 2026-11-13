/** Packaged Agent skill metadata and vocabularies. */
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
  /**
   * Kinds whose document is a fetched page: a workflow of such a skill starts
   * with a page fetch instead of a turn, and `save_document` never writes one.
   */
  fetched_kinds: ['page'],
  description_max_chars: 320,
  body_max_chars: 14000,
  vocabularies: {
    buyer_stages: promptGeneration.stages,
    prompt_intents: Object.keys(promptGeneration.intent_legacy),
  },
};
