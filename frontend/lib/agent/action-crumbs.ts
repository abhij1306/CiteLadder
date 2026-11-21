import { z } from 'zod';
import {
  actionGoalSchema,
  actionGroupingSchema,
  actionStatusSchema,
} from '@citeladder/contracts/actions';

import { ACTION_GOAL_LABEL, ACTION_GROUPING_LABEL } from '@/lib/agent/vocabulary';

export const listJumpSchema = z.object({
  status: actionStatusSchema,
  goal: actionGoalSchema,
  grouping: actionGroupingSchema.optional(),
});
export type ListJump = z.infer<typeof listJumpSchema>;

export const fromActionSchema = z.object({
  fromAction: listJumpSchema.required().extend({ id: z.uuid(), title: z.string() }),
});
export type FromAction = z.infer<typeof fromActionSchema>['fromAction'];

export function listCrumbs(
  at: Required<ListJump>,
): { label: string; href: string; state?: ListJump }[] {
  return [
    { label: 'Actions', href: '/actions' },
    {
      label: ACTION_GOAL_LABEL[at.goal],
      href: '/actions',
      state: { status: at.status, goal: at.goal } satisfies ListJump,
    },
    {
      label: ACTION_GROUPING_LABEL[at.grouping],
      href: '/actions',
      state: { status: at.status, goal: at.goal, grouping: at.grouping } satisfies ListJump,
    },
  ];
}
