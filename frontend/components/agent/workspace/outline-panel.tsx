import { JUMP_LINK } from '@/components/agent/jump-link';
import { Stack } from '@/components/ui/layout';
import { Pressable } from '@/components/ui/pressable';
import { textRole } from '@/components/ui/typography';
import { treeBranchClasses } from '@/components/ui/workspace';
import { pageOutline, type OutlineHeading } from '@/lib/agent/page-workspace';

type OutlineNode = { heading: OutlineHeading; children: OutlineNode[] };

function nest(headings: readonly OutlineHeading[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const open: OutlineNode[] = [];
  for (const heading of headings) {
    const node: OutlineNode = { heading, children: [] };
    while ((open.at(-1)?.heading.level ?? 0) >= heading.level) open.pop();
    (open.at(-1)?.children ?? roots).push(node);
    open.push(node);
  }
  return roots;
}

function Branch({
  nodes,
  nested,
  onJump,
}: Readonly<{ nodes: readonly OutlineNode[]; nested: boolean; onJump: (from: number) => void }>) {
  return (
    <Stack as="ol" gap="tight" className={nested ? treeBranchClasses() : undefined}>
      {nodes.map((node) => (
        <Stack as="li" gap="tight" key={node.heading.from}>
          <Pressable
            className={textRole('body', `${JUMP_LINK} w-auto text-start`)}
            onClick={() => onJump(node.heading.from)}
          >
            {node.heading.text}
          </Pressable>
          {node.children.length > 0 ? (
            <Branch nodes={node.children} nested onJump={onJump} />
          ) : null}
        </Stack>
      ))}
    </Stack>
  );
}

export function OutlinePanel({
  body,
  onJump,
}: Readonly<{ body: string; onJump: (from: number) => void }>) {
  const tree = nest(pageOutline(body));
  if (tree.length === 0)
    return <p className={textRole('body', 'text-ink-2')}>This page has no headings yet.</p>;
  return (
    <nav aria-label="Page outline">
      <Branch nodes={tree} nested={false} onJump={onJump} />
    </nav>
  );
}
