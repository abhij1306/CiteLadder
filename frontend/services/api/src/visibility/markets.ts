/**
 * Visibility → By market: every project market's latest dashboard-ready run,
 * each read on its own through the canonical dashboard and perception owners.
 * Markets are compared side by side, never pooled; a market without a run is
 * `no_run`, never zero.
 */
import type { VisibilityMarkets } from '@citeladder/contracts/visibility';

import type { Database } from '../db/database.ts';
import { listMarkets } from '../projects/markets.ts';
import { getVisibility } from './dashboard.ts';
import { getPerception } from './perception.ts';
import type { RunScope } from './runs.ts';
import { AnalysisNotFoundError, validateCohort } from './selection.ts';

type MarketRow = VisibilityMarkets['markets'][number];

async function marketRow(
  db: Database,
  scope: RunScope,
  market: MarketRow['market'],
  cohort: string,
): Promise<MarketRow> {
  const measured = { ...scope, marketId: market.id };
  const view = await getVisibility(db, measured, {
    auditId: null,
    logicalEngine: null,
    baselineId: null,
    selectionMode: 'latest',
    fromAt: null,
    toAt: null,
    configurationKey: null,
    cohort,
  }).catch((error: unknown) => {
    if (error instanceof AnalysisNotFoundError) return null;
    throw error;
  });
  if (view === null)
    return {
      market,
      state: 'no_run',
      audit_id: null,
      measured_at: null,
      mention_rate: null,
      share_of_voice: null,
      net_sentiment: null,
      comparison_status: null,
      mention_rate_delta: null,
      share_of_voice_delta: null,
    };
  const perception = await getPerception(db, {
    ...measured,
    auditId: view.audit_id,
    auditIds: null,
    logicalEngine: null,
    cohort,
    fromAt: null,
    toAt: null,
  });
  const comparable = view.comparison?.status === 'comparable';
  return {
    market,
    state: 'measured',
    audit_id: view.audit_id,
    measured_at: view.created_at,
    mention_rate: view.visibility_rate ?? null,
    share_of_voice: view.rankings.find((row) => row.is_brand)?.share_of_voice ?? null,
    net_sentiment: perception.brand?.score.net_sentiment ?? null,
    comparison_status: view.comparison?.status ?? null,
    mention_rate_delta: comparable ? (view.comparison?.deltas.visibility ?? null) : null,
    share_of_voice_delta: comparable ? (view.comparison?.deltas.sov ?? null) : null,
  };
}

export async function getMarketVisibility(
  db: Database,
  scope: RunScope,
  cohort: VisibilityMarkets['cohort'],
): Promise<VisibilityMarkets> {
  validateCohort(cohort);
  const markets = await listMarkets(db, scope);
  return {
    cohort,
    markets: await Promise.all(markets.map((market) => marketRow(db, scope, market, cohort))),
  };
}
