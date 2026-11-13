/**
 * The one crawl action (SH-B7). Starting a crawl and a scheduled crawl admit
 * the same request: every full crawl audits the project's tracked pages, so
 * there is no earlier crawl's scope to rerun. Only the robots choice carries
 * over: a request that names none keeps the shown crawl's choice and who
 * confirmed it. Admission is ordinary: the configured limits and the
 * one-active-crawl rule are unchanged.
 */
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import {
  robotsDecisionSchema,
  type CrawlAdmission,
  type RobotsDecision,
} from './planner-policy.ts';
import { dashboardCrawl } from './reads/crawl.ts';

/**
 * The crawl to admit for a project. `choice` is the operator's robots
 * choice, with their confirmation for `ignore`; without one the crawl keeps
 * the choice of the crawl the Site Health screen shows (`dashboardCrawl`: the
 * current crawl, else the newest site crawl; `respect` before any crawl), so
 * the crawl button's robots note is what it runs, and a scheduled crawl or a
 * page re-audit ignores robots.txt only where a person chose to.
 */
export async function crawlRequest(
  db: Database,
  workspaceId: string,
  projectId: string,
  choice: { robots: 'respect' } | { robots: 'ignore'; decision: RobotsDecision } | null = null,
): Promise<CrawlAdmission> {
  if (choice)
    return {
      project_id: projectId,
      robots: choice.robots,
      robots_decision: choice.robots === 'ignore' ? choice.decision : null,
    };
  const latest = await dashboardCrawl(db, workspaceId, projectId, null);
  const frozen = record(latest?.configuration);
  if (frozen.robots !== 'ignore') return { project_id: projectId, robots: 'respect' };
  return {
    project_id: projectId,
    robots: 'ignore',
    robots_decision: robotsDecisionSchema.parse(frozen.robots_decision),
  };
}
