import { policy } from '../../config.ts';
import { ActionTargetError, type AgentNamedTargetModule } from './kind.ts';
import { plainTarget } from './shared.ts';

const p = policy.opportunity.actions;

export function plannedPageKey(topic: string): string | null {
  const slug = topic
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-|-$/gu, '');
  return slug ? `planned:${[...slug].slice(0, p.PLANNED_PAGE_TOPIC_MAX_CHARS).join('')}` : null;
}

export const plannedPageTarget: AgentNamedTargetModule<'planned_page'> = {
  ...plainTarget('planned_page'),
  async named({ text }) {
    const key = plannedPageKey(text);
    if (!key) throw new ActionTargetError('A planned page needs a topic');
    return { key, url: null };
  },
};
