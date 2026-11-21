import {
  actionGoalSchema,
  type ActionGoal,
  type ActionGrouping,
  type ActionTreeGroupBy,
} from '@citeladder/contracts/actions';
import { sql, type RawBuilder } from 'kysely';

import { policy } from '../config.ts';

const a = policy.opportunity.actions;

export function goalOf(grouping: ActionGrouping): ActionGoal {
  const groupings: Record<ActionGoal, readonly ActionGrouping[]> = a.ACTION_GOALS;
  return actionGoalSchema.options.find((goal) => groupings[goal].includes(grouping))!;
}

export const FALLBACK_GOAL: ActionGoal = goalOf(a.ACTION_GROUPING_FALLBACK);

export const GROUPING_ORDER: readonly ActionGrouping[] = Object.values(a.ACTION_GOALS).flat();

export const goalSql = sql<ActionGoal>`coalesce(actions.goal, ${FALLBACK_GOAL})`;
export const groupingSql = sql<ActionGrouping>`coalesce(actions.goal_grouping, ${a.ACTION_GROUPING_FALLBACK})`;

export const ownershipSql = sql<string>`(case when ${goalSql} = 'mentions' then 'earned' else 'owned' end)`;

export const impactSql = sql<string>`(case
  when actions.priority_score >= ${a.ACTION_PRIORITY_BANDS.high} then 'high'
  when actions.priority_score >= ${a.ACTION_PRIORITY_BANDS.medium} then 'medium'
  else 'low' end)`;

export const topicSql = sql<string>`coalesce((select o.target_theme from opportunities o
  where o.workspace_id = actions.workspace_id and o.action_id = actions.id
    and o.superseded_at is null and o.target_theme is not null
    and o.rule_id <> ${policy.opportunity.opportunities.SITE_ISSUE_FAMILY.RULE_ID}
  order by o.priority_score desc nulls last, o.id limit 1), '')`;

const approachSql = sql<string>`actions.approach`;

export function groupKeySql(groupBy: ActionTreeGroupBy): RawBuilder<string> {
  switch (groupBy) {
    case 'goal':
      return goalSql;
    case 'what_to_do':
      return approachSql;
    case 'impact':
      return impactSql;
    case 'ownership':
      return ownershipSql;
    case 'topic':
      return topicSql;
    default: {
      const unknown: never = groupBy;
      return unknown;
    }
  }
}
