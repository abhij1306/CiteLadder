'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { ResizableSplitPane } from '@/components/ui/split-pane';
import { COMMERCE_TARGETS_MAX, type CommerceTarget } from '@citeladder/contracts/commerce-suite';
import { humanizeApiError } from '@/lib/api/errors';
import { useCompetitorDiscovery } from '@/lib/products/competitor-discovery';
import {
  DEFAULT_PANE_WIDTH,
  MAX_PANE_WIDTH,
  MIN_PANE_WIDTH,
  useResizablePane,
} from '@/lib/products/use-resizable-pane';
import { targetKey, useCommerceTarget } from '@/lib/products/use-commerce-target';
import { useCommerceQueries } from '@/lib/products/use-products-screen';

import { useCatalogHeader } from './catalog-header';
import { CatalogList, catalogEntries } from './catalog-list';
import { TargetDetail } from './target-detail';
import { textRole } from '@/components/ui/typography';
import { Stack } from '@/components/ui/layout';
import { PageShell } from '@/components/layout/page-shell';
import { useActiveWorkspaceId } from '@/lib/project/project-context';

/** Selection-only bulk actions, including stale keys that still need a clear path. */
export function BulkActions({
  count,
  pending,
  error,
  onDiscover,
  onClear,
}: Readonly<{
  count: number;
  pending: boolean;
  error: unknown;
  onDiscover: () => void;
  onClear: () => void;
}>) {
  const noun = count === 1 ? 'target' : 'targets';
  const tooMany = count > COMMERCE_TARGETS_MAX;
  let hint = 'Check categories or products to use bulk actions.';
  if (tooMany)
    hint = `Competitors can be found for up to ${COMMERCE_TARGETS_MAX} targets at a time.`;
  else if (count) hint = 'Find competitors for every checked target.';
  return (
    <Card className="flex min-h-16 flex-wrap items-center justify-between gap-3 px-3 py-2">
      <div className="grid gap-0.5">
        <span aria-live="polite" className={textRole('itemTitle')}>
          {count ? `${count} ${noun} selected` : 'No targets selected'}
        </span>
        <span className="type-caption">{hint}</span>
        {error ? (
          <span role="alert" className="type-caption text-danger-text">
            {humanizeApiError(error, 'Competitor discovery could not start.').message}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Button
          size="sm"
          disabled={!count || tooMany}
          pending={pending}
          pendingLabel="Finding…"
          onClick={onDiscover}
        >
          Find competitors
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={onClear}>
          Clear selection
        </Button>
      </div>
    </Card>
  );
}

export function CommerceWorkspace({ projectId }: Readonly<{ projectId: string }>) {
  const workspaceId = useActiveWorkspaceId();
  const { target, selectTarget } = useCommerceTarget();
  const queries = useCommerceQueries(projectId, target);
  const discovery = useCompetitorDiscovery(projectId);
  const [checked, setChecked] = useState<string[]>([]);
  // The stored width is the reader's (`useResizablePane`, per browser); the
  // width mid-drag stays inside the split pane until the separator settles.
  const pane = useResizablePane();
  const header = useCatalogHeader({
    workspaceId: workspaceId ?? '',
    projectId,
    query: queries.catalog,
  });
  const { categories, products } = catalogEntries(queries.catalog);
  const entries = [...categories, ...products];
  const selectedKey = target ? targetKey(target) : undefined;
  const label = entries.find((entry) => entry.key === selectedKey)?.label ?? '';
  const checkedSet = new Set(checked);
  const checkedTargets = entries.reduce<CommerceTarget[]>((targets, entry) => {
    if (checkedSet.has(entry.key)) targets.push(entry.target);
    return targets;
  }, []);
  const toggle = (keys: string[]) =>
    setChecked((current) => {
      const next = new Set(current);
      const remove = keys.every((key) => next.has(key));
      keys.forEach((key) => (remove ? next.delete(key) : next.add(key)));
      return [...next];
    });
  return (
    <PageShell actions={header.actions}>
      <Stack gap="workspace">
        {header.stats}
        {header.notices}
        {checked.length ? (
          <BulkActions
            count={checkedTargets.length}
            pending={discovery.discover.isPending}
            error={discovery.discover.error}
            onDiscover={() => discovery.discover.mutate(checkedTargets)}
            onClear={() => setChecked([])}
          />
        ) : null}
        <ResizableSplitPane
          listId="commerce-catalog-pane"
          separatorLabel="Resize the catalog pane"
          defaultWidth={DEFAULT_PANE_WIDTH}
          minWidth={MIN_PANE_WIDTH}
          maxWidth={MAX_PANE_WIDTH}
          width={pane.width}
          onWidthCommit={pane.commit}
          stickyList
          list={
            <Card className="min-w-0">
              <CardContent flush>
                <CatalogList
                  query={queries.catalog}
                  selectedKey={selectedKey}
                  checkedKeys={checkedSet}
                  onSelect={(next: CommerceTarget) => selectTarget(next)}
                  onToggle={toggle}
                />
              </CardContent>
            </Card>
          }
        >
          {target ? (
            // Rendered as soon as a target exists, not once the catalog has
            // loaded a label for it: a reload with `?target=` in the URL used
            // to show "select a category" until the catalog landed.
            <TargetDetail
              projectId={projectId}
              target={target}
              label={label || `Selected ${target.kind}`}
              queries={queries}
              discovery={discovery}
            />
          ) : (
            <InlineEmpty>
              Select a category or product to see its shelf position, its competitors, and the
              prompts that measure it.
            </InlineEmpty>
          )}
        </ResizableSplitPane>
      </Stack>
    </PageShell>
  );
}
