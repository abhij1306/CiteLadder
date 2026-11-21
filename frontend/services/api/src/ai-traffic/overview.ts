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
} from '../crawl-logs/reads.ts';
import type { CrawlScope } from '../crawl-logs/state.ts';
import { citationCoverage, citationRuns } from './citation-runs.ts';

const TRACKED_CITATIONS_LABEL = "Observed in CiteLadder's tracked answers";

type TrackedCitations = z.input<typeof trackedCitationsSchema>;

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
