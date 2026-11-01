/** UI generation ceiling; the API additionally enforces its runtime allowance. */
export const MAX_GENERATION_COUNT = 50;
/** Rows per import request; mirrors the API's `import_max_rows`, which rejects the whole upload above it. */
export const PROMPT_IMPORT_MAX_ROWS = 500;
/** Longest persona tag; mirrors the API's `persona_max_chars`. */
export const PERSONA_MAX_CHARS = 120;

/**
 * Prompt Builder defaults and request bounds. The bounds mirror the API's
 * generation policy (`run_context_max_chars`, `distribution_personas_max`,
 * `seed_query_ids_max`) and its brand-identity list limits
 * (`context_list_max_entries`), which reject a larger request.
 */
export const PROMPT_BUILDER = {
  defaultCount: 10,
  /** 80% unbranded, 20% branded, no competitor-alternative prompts. */
  defaultBrandedPercent: 20,
  defaultComparisonPercent: 0,
  defaultIntentMix: { informational: 25, commercial: 50, transactional: 25 },
  runContextMaxChars: 280,
  personasMax: 8,
  seedQueryIdsMax: 200,
  contextListMax: 20,
} as const;
