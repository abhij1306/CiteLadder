/**
 * The AI Traffic overview: crawler activity, AI referrals and owned citations
 * observed in tracked answers, for one reporting window.
 *
 * The three persisted reads are independent and run concurrently on the pool;
 * the window is resolved once, in the project's reporting timezone.
 */
import type { z } from 'zod';
import type {
  aiTrafficOverviewSchema,
  trackedCitationsSchema,
} from '@citeladder/contracts/ai-traffic';

import { AiReferralsQueryError, getAiReferrals } from '../analytics/ai-referrals.ts';
import type { Database } from '../db/database.ts';
import { ApiError } from '../errors.ts';
import {
  crawlSummary,
  crawlWindow,
  windowBounds,
  withReportingTimezone,
  type CrawlReadOptions,
} from './reads.ts';
import type { CrawlScope } from './state.ts';
import { citationCoverage, citationRuns } from './citation-runs.ts';

const TRACKED_CITATIONS_LABEL = "Observed in CiteLadder's tracked answers";

type TrackedCitations = z.input<typeof trackedCitationsSchema>;

/**
 * The owned-citation facts that audit finalization persisted on each audit
 * scope's newest completed run inside the window, summed across scopes. The
 * read never counts citation rows: a selected run without its fact is
 * `not_computed`, and a window without a completed run is
 * `no_completed_run`; neither becomes zero.
 */
async function trackedCitations(
  db: Database,
  scope: CrawlScope,
  bounds: ReturnType<typeof windowBounds>,
): Promise<TrackedCitations> {
  const runs = await citationRuns(db, scope, bounds).execute();
  const base = { unit: 'tracked_citations', label: TRACKED_CITATIONS_LABEL } as const;
  const coverage = citationCoverage(runs);
  if (coverage !== 'measured')
    return { ...base, state: 'not_available', reason: coverage, count: null };
  const sources: { audit_id: string; analyzer_version: string; count: number }[] = [];
  for (const run of runs) {
    if (run.owned_citation_count === null || run.analyzer_version === null) continue;
    sources.push({
      audit_id: run.audit_id,
      analyzer_version: run.analyzer_version,
      count: run.owned_citation_count,
    });
  }
  return {
    ...base,
    state: 'measured',
    count: sources.reduce((sum, source) => sum + source.count, 0),
    sources: sources.map(({ audit_id, analyzer_version }) => ({ audit_id, analyzer_version })),
  };
}

export async function aiTrafficOverview(
  db: Database,
  scope: CrawlScope,
  query: CrawlReadOptions,
): Promise<z.input<typeof aiTrafficOverviewSchema>> {
  const options = await withReportingTimezone(db, scope, query);
  // One window for all three reads, resolved before any starts (an invalid
  // one is the caller's 422): explicit dates win over a preset, as
  // `crawlWindow` decides, so referrals never read a preset beside them.
  const window = crawlWindow(options);
  const explicit = Boolean(options.start_date && options.end_date);
  const [crawl, referrals, citations] = await Promise.all([
    crawlSummary(db, scope, options),
    getAiReferrals(db, {
      ...scope,
      rangeToken: explicit ? null : (options.range ?? null),
      fromDate: explicit ? window.start : null,
      toDate: explicit ? window.end : null,
      granularity: 'day',
    }).catch((error: unknown) => {
      if (error instanceof AiReferralsQueryError) throw new ApiError(422, error.message);
      throw error;
    }),
    trackedCitations(db, scope, windowBounds(window, options)),
  ]);
  return { crawl, referrals, citations };
}
