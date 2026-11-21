import type { AnswerFormat } from '@citeladder/contracts/audits';

export const answerEvidence = {
  format_markers: {
    shopping: ['chat_gpt_products'],
    map: ['chat_gpt_local_businesses'],
    comparison: ['chat_gpt_table', 'gemini_table'],
    image: ['chat_gpt_images', 'gemini_images'],
  } satisfies Record<AnswerFormat, readonly string[]>,
  ad_item_types: ['chat_gpt_ad'],
  max_item_depth: 32,
} as const;
