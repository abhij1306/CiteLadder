/**
 * Prompt Builder defaults. The API's request bounds (generation count, import
 * rows, persona and run-context lengths, personas, seed queries, context
 * lists) are not restated here: they arrive in the prompt-set list's `limits`.
 */
export const PROMPT_BUILDER = {
  defaultCount: 10,
  /** 80% unbranded, 20% branded, no competitor-alternative prompts. */
  defaultBrandedPercent: 20,
  defaultComparisonPercent: 0,
  defaultIntentMix: { informational: 25, commercial: 50, transactional: 25 },
} as const;
