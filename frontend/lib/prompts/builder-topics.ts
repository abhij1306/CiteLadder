import type { TopicConfirmPlan } from '@citeladder/contracts/prompt-requests';
import type { Topic, TopicPreview } from '@citeladder/contracts';
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

export function topicPlan(rows: readonly TopicRow[]): TopicConfirmPlan {
  const plan: TopicConfirmPlan = { create: [], rename: [], delete: [] };
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

export const planIsEmpty = (plan: TopicConfirmPlan) =>
  !plan.create.length && !plan.rename.length && !plan.delete.length;

export function planProblem(rows: readonly TopicRow[]): string | null {
  const live = rows.filter((row) => !(row.kind === 'existing' && row.removed));
  if (live.some((row) => !row.name.trim())) return 'Every topic needs a name.';
  const names = live.map((row) => row.name.trim().toLowerCase());
  return new Set(names).size === names.length ? null : 'Two topics share a name.';
}
