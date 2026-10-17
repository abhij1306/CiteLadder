/**
 * Ads in ChatGPT Search answers: parsed from the stored Task GET envelope in
 * the derive transaction and kept apart from citations, mentions and scoring.
 */
import { randomUUID } from 'node:crypto';

import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import { policy } from '../config.ts';
import { getLogger } from '../logging.ts';
import { parseAds, type AdItem } from '../search-surfaces/parsing.ts';
import { domainIn, type ScoringConfig } from './scoring.ts';

const logger = getLogger('citeladder.analysis.ads');

type AdOwnership =
  | { ownership: 'owned' | 'other'; competitor_id: null }
  | { ownership: 'competitor'; competitor_id: string | null };

/** The ads a successful answer was parsed for, or null when ads do not apply or cannot be read. */
export function answerAds(task: {
  id: string;
  logical_engine: string;
  providerMetadata: unknown;
}): AdItem[] | null {
  if (task.logical_engine !== policy.audits.ads_engine) return null;
  const parsed = parseAds(record(task.providerMetadata).raw_response);
  if (parsed?.skipped)
    logger.warning('ads.items_skipped', { task_id: task.id, skipped: parsed.skipped });
  return parsed?.ads ?? null;
}

/** Owned beats competitor; a competitor carries its frozen id. */
function adOwnership(advertiserDomain: string, config: ScoringConfig): AdOwnership {
  if (domainIn(advertiserDomain, config.ownedDomains))
    return { ownership: 'owned', competitor_id: null };
  const competitor = config.competitors.find((item) => domainIn(advertiserDomain, item.domains));
  return competitor
    ? { ownership: 'competitor', competitor_id: competitor.id }
    : { ownership: 'other', competitor_id: null };
}

/** Caller holds the derive transaction; one row per ad rank in this artifact. */
export async function persistAds(
  db: Database,
  context: {
    workspaceId: string;
    projectId: string;
    auditId: string;
    taskId: string;
    artifactId: string;
    config: ScoringConfig;
    ads: readonly AdItem[];
    at: Date;
  },
): Promise<void> {
  if (!context.ads.length) return;
  await db
    .insertInto('answer_ad_observations')
    .values(
      context.ads.map((ad) => ({
        ...ad,
        ...adOwnership(ad.advertiser_domain, context.config),
        id: randomUUID(),
        workspace_id: context.workspaceId,
        project_id: context.projectId,
        audit_id: context.auditId,
        task_id: context.taskId,
        artifact_id: context.artifactId,
        parser_version: policy.audits.ads_versions.parser_version,
        created_at: context.at,
      })),
    )
    .execute();
}
