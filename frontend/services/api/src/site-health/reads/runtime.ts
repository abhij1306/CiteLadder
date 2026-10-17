/**
 * The workspace's Site Health runtime: full discovery bounded by the
 * operator's monitored-URL limit (`SITE_HEALTH_MONITORED_URL_LIMIT`).
 */
import { policy, resolveSettingSpec } from '../../config.ts';
import type { Database } from '../../db/database.ts';

/** The runtime projection crawl admission persists and reads resolve. */
export function siteHealthRuntime() {
  const cfg = policy.site_health_runtime;
  const setting = (key: keyof typeof cfg.settings) =>
    resolveSettingSpec(cfg.settings[key]) as number;
  const allowance = setting('monitored_url_limit');
  return {
    discovery_mode: cfg.full_mode,
    discovery_url_cap: Math.min(
      setting('automatic_page_limit'),
      Math.max(cfg.full_minimum, allowance * cfg.full_headroom),
    ),
    sample_url_limit: 0,
    monitored_url_limit: allowance,
    count_disclosure: true,
  };
}

/** Active monitored URLs across the workspace against its monitored allowance. */
export async function monitoredQuota(db: Database, workspaceId: string) {
  const used = await db
    .selectFrom('monitored_site_urls')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .where('workspace_id', '=', workspaceId)
    .where('active', '=', true)
    .executeTakeFirstOrThrow();
  return { used: Number(used.count), limit: siteHealthRuntime().monitored_url_limit };
}
