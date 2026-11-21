import type { Topic } from '@citeladder/contracts';

export type RailTopic = { topic: Topic; nested: boolean; label: string };

export function orderTopicsForRail(topics: readonly Topic[]): RailTopic[] {
  const byId = new Map(topics.map((topic) => [topic.id, topic]));
  const children = new Map<string, Topic[]>();
  const roots: Topic[] = [];
  for (const topic of topics) {
    const parent = topic.parent_id ? byId.get(topic.parent_id) : undefined;
    if (parent) children.set(parent.id, [...(children.get(parent.id) ?? []), topic]);
    else roots.push(topic);
  }
  return roots.flatMap((root) => [
    { topic: root, nested: false, label: root.name },
    ...(children.get(root.id) ?? []).map((child) => ({
      topic: child,
      nested: true,
      label: `${root.name} › ${child.name}`,
    })),
  ]);
}
