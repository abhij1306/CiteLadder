import { z } from 'zod';
import { ProviderError } from '../answer-engines/contracts.ts';
import { providerCharge, searchPolicy, type Envelope, type SearchEngine } from './dataforseo.ts';

export type ReconciliationState = {
  offset: number;
  matches: Record<string, number | null>;
  upper: string;
};
export type Reconciliation = {
  state: ReconciliationState;
  match: { id: string; chargeMicrousd: number | null } | null;
  ambiguous: boolean;
};
const rowSchema = z.object({
  id: z.string().min(1),
  cost: z.number().nonnegative().nullable().optional(),
  metadata: z.object({
    tag: z.string(),
    api: z.string().optional(),
    se: z.string().optional(),
    function: z.string().optional(),
  }),
});

/** A sweep freezes its upper bound and accumulates matches across persisted pages. */
export function reconcilePage(
  envelope: Envelope,
  engine: SearchEngine,
  submissionRef: string,
  state: ReconciliationState,
): Reconciliation {
  if (
    envelope.status_code !== searchPolicy.constants.status_ok ||
    !envelope.tasks?.length ||
    envelope.tasks.some((task) => task.status_code !== searchPolicy.constants.status_ok)
  )
    throw new ProviderError('reconciliation_unavailable', true);
  const rows = envelope.tasks.flatMap((task) => task.result ?? []);
  const matches = { ...state.matches };
  for (const value of rows) {
    const row = rowSchema.safeParse(value).data;
    if (!row || !submissionRef || row.metadata.tag !== submissionRef) continue;
    if (
      engine !== 'google_ai_overview' &&
      (row.metadata.api !== 'ai_optimization' ||
        row.metadata.se !== searchPolicy.scraper.products[engine] ||
        row.metadata.function !== 'llm_scraper')
    )
      continue;
    matches[row.id] = providerCharge(row.cost);
  }
  const entries = Object.entries(matches);
  if (entries.length > 1) return { state: { ...state, matches }, ambiguous: true, match: null };
  const offset = state.offset + searchPolicy.constants.reconcile_page_size;
  const done =
    rows.length < searchPolicy.constants.reconcile_page_size ||
    offset >= searchPolicy.scraper.reconcile_max_pages * searchPolicy.constants.reconcile_page_size;
  if (done) {
    const entry = entries[0];
    return {
      state: { offset: 0, matches: {}, upper: '' },
      ambiguous: false,
      match: entry ? { id: entry[0], chargeMicrousd: entry[1] } : null,
    };
  }
  return { state: { ...state, offset, matches }, match: null, ambiguous: false };
}
