/** A page to create: one planned page per topic, whether the Agent or evidence names it first. */
import { policy } from '../../config.ts';
import { ActionTargetError, type AgentNamedTargetModule } from './kind.ts';
import { plainTarget } from './shared.ts';

const p = policy.opportunity.actions;

/**
 * A topic's planned-page key, its Action's identity; null for a topic with no
 * letters or digits. A producer that must keep its Action when a label is
 * renamed stores this key once (a content-gap lineage's `planned_page_key`).
 */
export function plannedPageKey(topic: string): string | null {
  // Letters in any script, so a keyword in Hindi or Japanese still names a page.
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
