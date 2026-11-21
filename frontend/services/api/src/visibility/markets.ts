import type { NetSentiment, VisibilityMarkets } from '@citeladder/contracts/visibility';
import type { PerceptionResponse } from '@citeladder/contracts/visibility-perception';

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
    if (error instanceof AnalysisNotFoundError) return error.reason;
    throw error;
  });
  if (typeof view === 'string')
    return {
      market,
      state: view === 'metrics_pending' ? 'metrics_pending' : 'no_run',
      audit_id: null,
      measured_at: null,
      mention_rate: null,
      share_of_voice: null,
      sentiment: null,
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
    sentiment: brandSentiment(perception.brand),
    comparison_status: view.comparison?.status ?? null,
    mention_rate_delta: comparable ? (view.comparison?.deltas.visibility ?? null) : null,
    share_of_voice_delta: comparable ? (view.comparison?.deltas.sov ?? null) : null,
  };
}

function brandSentiment(brand: PerceptionResponse['brand']): NetSentiment | null {
  if (!brand) return null;
  const { classified, positive, negative, net_sentiment } = brand.score;
  return { mentions: brand.coverage.mentions, classified, positive, negative, net_sentiment };
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
