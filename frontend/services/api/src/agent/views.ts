import {
  AGENT_VIEW_VISIBILITY_RANGES,
  agentViewSchema,
  type AgentView,
} from '@citeladder/contracts/agent-views';
import { z } from 'zod';
import type { Database } from '../db/database.ts';
import { argumentProblem } from '../mcp/tools.ts';
import type { BuiltinOutcome } from './builtin-tools.ts';
import { agentPolicy, type Scope } from './contracts.ts';
import type { TurnState } from './turn-budget.ts';
import { readView } from './view-reads.ts';

export const SHOW_VIEW = 'show_view';

const VIEW_KINDS = agentViewSchema.options.map((option) => option.shape.kind.value);

export const showViewArguments = z.strictObject({
  kind: z
    .enum(VIEW_KINDS)
    .describe(
      'visibility_trend: the brand’s visibility over time; visibility_ranking: the brand against its competitors in the latest run; visibility_sources: the domains AI answers cited in the latest run; site_health_summary: a crawl’s scores; ai_traffic_overview: AI crawler requests and AI referrals; keyword_research_rows: a Keyword research dataset’s rows.',
    ),
  market_id: z
    .uuid()
    .nullish()
    .describe('Visibility views: a market id a read returned; omit for the default market.'),
  topic_id: z
    .uuid()
    .nullish()
    .describe('Visibility views: a topic id a read returned; omit for every topic.'),
  range: z
    .enum(AGENT_VIEW_VISIBILITY_RANGES)
    .nullish()
    .describe(
      'visibility_trend and ai_traffic_overview: the window (all is visibility_trend only); 90d when omitted.',
    ),
  crawl_id: z
    .uuid()
    .nullish()
    .describe('site_health_summary: a crawl id a read returned; omit for the latest crawl.'),
  dataset_id: z
    .uuid()
    .nullish()
    .describe('keyword_research_rows, required there: a dataset id a read returned.'),
});

export const SHOW_VIEW_DESCRIPTION =
  'Place one of the app’s charts or tables under your reply, read live from saved data when the person opens it. Use it when the person asks to see data or when a chart answers better than prose, never more than the answer needs, and still state the finding in words.';

const DEFAULT_RANGE = '90d';

function selection(input: z.infer<typeof showViewArguments>) {
  return {
    kind: input.kind,
    market_id: input.market_id ?? null,
    topic_id: input.topic_id ?? null,
    range: input.range ?? DEFAULT_RANGE,
    crawl_id: input.crawl_id ?? null,
    dataset_id: input.dataset_id,
  };
}

const sameView = (left: AgentView, right: AgentView) =>
  JSON.stringify(left) === JSON.stringify(right);

function placementRefusal(state: Pick<TurnState, 'views'>, view: AgentView) {
  if (state.views.some((placed) => sameView(placed, view)))
    return { ok: false, text: 'This view is already placed under your reply.' };
  if (state.views.length >= agentPolicy.max_views_per_turn)
    return {
      ok: false,
      text: `At most ${agentPolicy.max_views_per_turn} views go under one reply. Answer with the ones placed.`,
    };
  return null;
}

export async function showView(
  db: Database,
  scope: Scope,
  state: Pick<TurnState, 'views'>,
  input: unknown,
): Promise<BuiltinOutcome> {
  const parsed = showViewArguments.safeParse(input);
  if (!parsed.success) return { ok: false, text: argumentProblem(parsed.error) };
  const view = agentViewSchema.safeParse(selection(parsed.data));
  if (!view.success) return { ok: false, text: argumentProblem(view.error) };
  const refusal = placementRefusal(state, view.data);
  if (refusal) return refusal;
  const read = await readView(db, scope, view.data);
  switch (read.kind) {
    case 'invalid':
      return { ok: false, text: read.text };
    case 'unavailable':
      return {
        ok: true,
        text: `unavailable: ${read.reason}. Nothing was placed; say the data is not available yet, never that it is zero or empty.`,
      };
    case 'available': {
      const raced = placementRefusal(state, view.data);
      if (raced) return raced;
      state.views.push(view.data);
      return {
        ok: true,
        text: 'Placed: the view shows under your reply with an Open in app link. State the finding in words; do not describe the chart.',
      };
    }
    default: {
      const exhaustive: never = read;
      return exhaustive;
    }
  }
}
