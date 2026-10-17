/** Narrow persisted facts only; bot labels and purposes arrive from the catalog writer. */
import { robotsFactsSchema } from '@citeladder/contracts/site-health';
import { z } from 'zod';

const schema = z.object({
  robots: robotsFactsSchema,
  llms_txt: z.object({
    fetched: z.boolean(),
    present: z.boolean(),
    url: z.string(),
    status_code: z.number().nullable(),
  }),
});
export type SiteFactsView = z.infer<typeof schema>;
export function readSiteFacts(facts: unknown): SiteFactsView | null {
  const parsed = schema.safeParse(facts);
  return parsed.success ? parsed.data : null;
}

type Robots = SiteFactsView['robots'];
type Bot = Robots['bots'][number];
export const crawlerPurposeLabels: Record<Bot['purpose'], string> = {
  ai_training: 'AI training',
  ai_search: 'AI search',
  ai_user_fetch: 'AI user fetch',
  search_engine: 'Search engine',
  other: 'Other',
};
export const crawlerPolicyLabels: Record<Bot['policy'], string> = {
  all_allowed: 'All allowed',
  restricted: 'Restricted',
  all_disallowed: 'All disallowed',
  unknown: 'Unknown',
};
export const crawlerMatchedLabels: Record<Bot['matched'], string> = {
  no_rules: 'Not specified',
  specific_group: 'Specific group',
  wildcard_group: 'Wildcard group',
};
export const crawlerRootAccessLabels: Record<Bot['root_access'], string> = {
  allowed: 'Allowed',
  disallowed: 'Disallowed',
  unknown: 'Unknown',
};
export const robotsStatusLabels: Record<Robots['status'], string> = {
  fetched: 'fetched',
  not_found: 'not found',
  fetch_failed: 'fetch failed',
  access_blocked: 'access blocked',
};
