import { z } from 'zod';

const uuid = () => z.uuid();

const AGENT_VIEW_TRAFFIC_RANGES = ['30d', '90d', '1y'] as const;
export const AGENT_VIEW_VISIBILITY_RANGES = [...AGENT_VIEW_TRAFFIC_RANGES, 'all'] as const;

const visibilityScope = {
  market_id: uuid().nullable(),
  topic_id: uuid().nullable(),
};

export const agentViewSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('visibility_trend'),
    ...visibilityScope,
    range: z.enum(AGENT_VIEW_VISIBILITY_RANGES),
  }),
  z.object({ kind: z.literal('visibility_ranking'), ...visibilityScope }),
  z.object({ kind: z.literal('visibility_sources'), ...visibilityScope }),
  z.object({ kind: z.literal('site_health_summary'), crawl_id: uuid().nullable() }),
  z.object({ kind: z.literal('ai_traffic_overview'), range: z.enum(AGENT_VIEW_TRAFFIC_RANGES) }),
  z.object({ kind: z.literal('keyword_research_rows'), dataset_id: uuid() }),
]);
export type AgentView = z.infer<typeof agentViewSchema>;
