/**
 * The Prompt Builder's "Review topics" step as data: the project's topics
 * plus proposals, edited locally and written only as one confirmed plan.
 * Proposals fill gaps beside the existing topics and never replace them.
 */
import type { TopicConfirmInput } from '@/lib/api/topics';
import type { Topic, TopicPreview } from '@/lib/api/types';
import { orderTopicsForRail } from '@/lib/prompts/topic-tree';

type Proposal = TopicPreview['topics'][number];

export type TopicRow =
  | {
      kind: 'existing';
      key: string;
      name: string;
      savedName: string;
      nested: boolean;
      removed: boolean;
    }
  | { kind: 'proposed'; key: string; name: string; offerings: string[] }
  | { kind: 'added'; key: string; name: string };

/** Every existing topic, in rail order, unedited. */
export function topicRows(topics: readonly Topic[]): TopicRow[] {
  return orderTopicsForRail(topics).map(({ topic, nested }) => ({
    kind: 'existing',
    key: topic.id,
    name: topic.name,
    savedName: topic.name,
    nested,
    removed: false,
  }));
}

/** The rows with a fresh set of proposals in place of any earlier ones. */
export function withProposals(
  rows: readonly TopicRow[],
  proposals: readonly Proposal[],
): TopicRow[] {
  const kept = rows.filter((row) => row.kind !== 'proposed');
  return [
    ...kept,
    ...proposals.map((proposal, index) => ({
      kind: 'proposed' as const,
      key: `proposal:${index}:${proposal.name}`,
      name: proposal.name,
      offerings: proposal.offerings,
    })),
  ];
}

/** The rows with more proposals appended (the "+N more" overflow). */
export function addProposals(
  rows: readonly TopicRow[],
  proposals: readonly Proposal[],
): TopicRow[] {
  const offset = rows.length;
  return [
    ...rows,
    ...proposals.map((proposal, index) => ({
      kind: 'proposed' as const,
      key: `proposal:${offset + index}:${proposal.name}`,
      name: proposal.name,
      offerings: proposal.offerings,
    })),
  ];
}

/** The plan the rows describe: removed and renamed existing topics, and every new one. */
export function topicPlan(rows: readonly TopicRow[]): TopicConfirmInput {
  const plan: TopicConfirmInput = { create: [], rename: [], delete: [] };
  for (const row of rows) {
    const name = row.name.trim();
    if (row.kind === 'existing') {
      if (row.removed) plan.delete.push(row.key);
      else if (name !== row.savedName) plan.rename.push({ id: row.key, name });
    } else {
      plan.create.push({ name, offerings: row.kind === 'proposed' ? row.offerings : [] });
    }
  }
  return plan;
}

export const planIsEmpty = (plan: TopicConfirmInput) =>
  !plan.create.length && !plan.rename.length && !plan.delete.length;

/** Why the rows cannot be confirmed as they stand, or null when they can. */
export function planProblem(rows: readonly TopicRow[]): string | null {
  const live = rows.filter((row) => !(row.kind === 'existing' && row.removed));
  if (live.some((row) => !row.name.trim())) return 'Every topic needs a name.';
  const names = live.map((row) => row.name.trim().toLowerCase());
  return new Set(names).size === names.length ? null : 'Two topics share a name.';
}
