import { useMemo } from 'react';

import { PageKindBadge } from '@/components/site-health/page-kind-badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Inline, Stack } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';
import { TextLink } from '@/components/ui/text-link';
import { treeBranchClasses } from '@/components/ui/workspace';
import type { ArchitectureNode } from '@citeladder/contracts';

/**
 * Where a page's parent came from. Most pages sit under their URL parent, so
 * that default goes unlabelled and only the exceptions say where they came
 * from: a caption on every row said nothing.
 */
const PARENT_SOURCE_LABELS: Record<ArchitectureNode['parent_source'], string | null> = {
  breadcrumb: 'Breadcrumb',
  explicit_structure: 'Site structure',
  url_parent: null,
  unknown: 'No known parent',
};

/**
 * Group nodes under the parent the crawl actually resolved.
 *
 * A parent id that is missing from this crawl's node set, or that points at
 * the node itself, is treated as no parent: rendering it would either drop the
 * page from the tree entirely or recurse forever.
 */
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

export function HierarchyCard({
  nodes,
  crawlId,
}: Readonly<{ nodes: ArchitectureNode[]; crawlId: string | null }>) {
  const grouped = useMemo(() => nodesByParent(nodes), [nodes]);
  const roots = grouped.get(null) ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Observed hierarchy</CardTitle>
        <CardDescription>
          Each page sits under its parent in the URL path unless its breadcrumb or the site’s
          structure says otherwise. Pages with no known parent sit at the top.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {roots.length === 0 ? (
          <QueryState kind="empty" inline message="No hierarchy nodes were measured." />
        ) : (
          <section
            className="content-scroll max-h-96 overflow-y-auto overscroll-contain"
            aria-label="Observed hierarchy pages"
          >
            <HierarchyList nodes={roots} grouped={grouped} crawlId={crawlId} />
          </section>
        )}
      </CardContent>
    </Card>
  );
}

function HierarchyList({
  nodes,
  grouped,
  crawlId,
}: Readonly<{
  nodes: ArchitectureNode[];
  grouped: Map<string | null, ArchitectureNode[]>;
  crawlId: string | null;
}>) {
  return (
    <ul className={treeBranchClasses()}>
      {nodes.map((node) => {
        const children = grouped.get(node.site_url_id) ?? [];
        // The home page is the root by definition, not a page missing a parent.
        const home = node.depth_from_home === 0;
        const source = home ? null : PARENT_SOURCE_LABELS[node.parent_source];
        return (
          <Stack as="li" gap="item" key={node.site_url_id} className="min-w-0">
            <Inline className="flex-wrap">
              {crawlId ? (
                <TextLink
                  text="body"
                  className="min-w-0 [overflow-wrap:anywhere]"
                  href={`/site/crawls/${crawlId}/pages/${node.site_url_id}`}
                >
                  {node.url}
                </TextLink>
              ) : (
                <span className="type-body text-ink min-w-0 [overflow-wrap:anywhere]">
                  {node.url}
                </span>
              )}
              <PageKindBadge pageKind={node.page_kind} />
              {source ? <span className="type-caption">{source}</span> : null}
            </Inline>
            {children.length > 0 ? (
              <HierarchyList nodes={children} grouped={grouped} crawlId={crawlId} />
            ) : null}
          </Stack>
        );
      })}
    </ul>
  );
}
