import { surfaceKindOf } from '../../providers/config.ts';
import type { SurfaceAdapter } from './adapter.ts';
import { llmSurface } from './llm.ts';
import { llmScraperAdapter } from './llm-scraper.ts';
import { searchAiAdapter } from './search-ai.ts';

const adapters = {
  llm: llmSurface,
  search_ai: searchAiAdapter,
  llm_scraper: llmScraperAdapter,
} satisfies Record<NonNullable<ReturnType<typeof surfaceKindOf>>, SurfaceAdapter>;

/**
 * The adapter for a task's route surface kind. An engine no route serves has no
 * surface to observe: it fails before any call, as an unavailable answer route does.
 */
export const surfaceAdapter = (logicalEngine: string): SurfaceAdapter =>
  adapters[surfaceKindOf(logicalEngine) ?? 'llm'];
