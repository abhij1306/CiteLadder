/**
 * The AI Traffic overview: crawler activity, AI referrals and owned citations
 * observed in tracked answers, for one reporting window.
 *
 * The three persisted reads are independent and run concurrently on the pool;
 * the window is resolved once, in the project's reporting timezone.
 */
import type { z } from 'zod';
import type { aiTrafficOverviewSchema } from '@citeladder/contracts/ai-traffic';
import { sql } from 'kysely';

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

const TRACKED_CITATIONS_LABEL = "Observed in CiteLadder's tracked answers";

/**
 * Owned citations in each audit scope's newest completed audit inside the
 * window; `null` when no audit completed there, which is not zero.
 */
async function trackedCitations(
  db: Database,
  scope: CrawlScope,
  bounds: ReturnType<typeof windowBounds>,
): Promise<number | null> {
  const audits = await db
    .selectFrom('audits')
    .select('id')
    .distinctOn('audit_scope')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('status', '=', 'completed')
    .where('created_at', '>=', bounds.from)
    .where('created_at', '<', bounds.to)
    .orderBy('audit_scope')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  if (!audits.length) return null;
  const { count } = await db
    .selectFrom('citations')
    .select(sql<number>`count(*)::integer`.as('count'))
    .where('workspace_id', '=', scope.workspaceId)
    .where(
      'audit_id',
      'in',
      audits.map((audit) => audit.id),
    )
    .where('is_owned', '=', true)
    .executeTakeFirstOrThrow();
  return count;
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
  return {
    crawl,
    referrals,
    citations: { unit: 'tracked_citations', count: citations, label: TRACKED_CITATIONS_LABEL },
  };
}
