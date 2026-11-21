import { useMemo, useState } from 'react';

import { PageKindBadge } from '@/components/site-health/page-kind-badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Inline, Stack } from '@/components/ui/layout';
import { UrlText } from '@/components/ui/table';
import { TextLink } from '@/components/ui/text-link';
import { treeBranchClasses } from '@/components/ui/workspace';
import type { ArchitectureNode } from '@citeladder/contracts';
import { StateBlock } from '@/components/ui/state-block';
import { SectionContent, TitledSection } from '@/components/ui/section';
import { ChevronDown } from '@/lib/icons';
import { formatCount, readableUrl, sharedOrigin } from '@/lib/format';

const PARENT_SOURCE_LABELS: Record<ArchitectureNode['parent_source'], string | null> = {
  breadcrumb: 'Breadcrumb',
  explicit_structure: 'Site structure',
  url_parent: null,
  unknown: 'No known parent',
};

const HIERARCHY_PREVIEW_ROWS = 10;

function nodesByParent(nodes: ArchitectureNode[]): Map<string | null, ArchitectureNode[]> {
  const nodeIds = new Set(nodes.map((node) => node.site_url_id));
  const grouped = new Map<string | null, ArchitectureNode[]>();
  for (const node of nodes) {
    const parentId =
      node.parent_site_url_id &&
      node.parent_site_url_id !== node.site_url_id &&
      nodeIds.has(node.parent_site_url_id)
        ? node.parent_site_url_id
        : null;
    const siblings = grouped.get(parentId);
    if (siblings) siblings.push(node);
    else grouped.set(parentId, [node]);
  }
  for (const siblings of grouped.values()) {
    siblings.sort((left, right) => left.url.localeCompare(right.url));
  }
  return grouped;
}

/** The first `limit` nodes in reading order; a prefix, so every shown node's parent is shown. */
function previewIds(
  roots: readonly ArchitectureNode[],
  grouped: Map<string | null, ArchitectureNode[]>,
  limit: number,
): Set<string> {
  const shown = new Set<string>();
  const visit = (nodes: readonly ArchitectureNode[]) => {
    for (const node of nodes) {
      if (shown.size >= limit) return;
      shown.add(node.site_url_id);
      visit(grouped.get(node.site_url_id) ?? []);
    }
  };
  visit(roots);
  return shown;
}

export function HierarchyCard({
  nodes,
  crawlId,
}: Readonly<{ nodes: ArchitectureNode[]; crawlId: string | null }>) {
  const grouped = useMemo(() => nodesByParent(nodes), [nodes]);
  const origin = useMemo(() => sharedOrigin(nodes.map((node) => node.url)), [nodes]);
  const [expanded, setExpanded] = useState(false);
  const roots = useMemo(() => grouped.get(null) ?? [], [grouped]);
  const cut = !expanded && nodes.length > HIERARCHY_PREVIEW_ROWS;
  const shown = useMemo(
    () => (cut ? previewIds(roots, grouped, HIERARCHY_PREVIEW_ROWS) : null),
    [cut, roots, grouped],
  );
  return (
    <TitledSection
      title="Observed hierarchy"
      description={origin ? readableUrl(origin) : undefined}
    >
      <SectionContent>
        {roots.length === 0 ? (
          <StateBlock kind="empty" inline message="No hierarchy nodes were measured." />
        ) : (
          <Stack>
            <section aria-label="Observed hierarchy pages">
              <HierarchyList
                nodes={roots}
                grouped={grouped}
                crawlId={crawlId}
                origin={origin}
                shown={shown}
              />
            </section>
            {cut ? (
              <Inline>
                <Button variant="secondary" onClick={() => setExpanded(true)}>
                  <Icon icon={ChevronDown} />
                  {`Show all ${formatCount(nodes.length)}`}
                </Button>
              </Inline>
            ) : null}
          </Stack>
        )}
      </SectionContent>
    </TitledSection>
  );
}

function HierarchyList({
  nodes,
  grouped,
  crawlId,
  origin,
  shown,
}: Readonly<{
  nodes: ArchitectureNode[];
  grouped: Map<string | null, ArchitectureNode[]>;
  crawlId: string | null;
  origin: string | null;
  shown: Set<string> | null;
}>) {
  const visible = shown ? nodes.filter((node) => shown.has(node.site_url_id)) : nodes;
  return (
    <ul className={treeBranchClasses()}>
      {visible.map((node) => {
        const children = grouped.get(node.site_url_id) ?? [];
        const home = node.depth_from_home === 0;
        const source = home ? null : PARENT_SOURCE_LABELS[node.parent_source];
        const childShown = children.some((child) => !shown || shown.has(child.site_url_id));
        return (
          <Stack as="li" gap="item" key={node.site_url_id} className="min-w-0">
            <Inline>
              {crawlId ? (
                <TextLink
                  text="body"
                  className="flex min-w-0"
                  aria-label={readableUrl(node.url)}
                  href={`/site/crawls/${crawlId}/pages/${node.site_url_id}`}
                >
                  <UrlText url={node.url} origin={origin} />
                </TextLink>
              ) : (
                <span className="type-body text-ink flex min-w-0">
                  <UrlText url={node.url} origin={origin} />
                </span>
              )}
              <PageKindBadge pageKind={node.page_kind} />
              {source ? <span className="type-caption whitespace-nowrap">{source}</span> : null}
            </Inline>
            {childShown ? (
              <HierarchyList
                nodes={children}
                grouped={grouped}
                crawlId={crawlId}
                origin={origin}
                shown={shown}
              />
            ) : null}
          </Stack>
        );
      })}
    </ul>
  );
}
