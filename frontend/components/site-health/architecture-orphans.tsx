/**
 * Orphan evidence for the Architecture tab: the count, and the pages behind it.
 *
 * Split from `architecture-panel.tsx` so neither file carries a second
 * concern. The count is the summary the card shows; the drawer is where the
 * URLs live, because a list of twenty inside a three-metric summary pushed
 * Structure depth off the fold to say what the number already said.
 */
'use client';

import { Drawer } from '@/components/ui/drawer';
import { Stack } from '@/components/ui/layout';
import { StatItem } from '@/components/ui/stat-grid';
import { TextLink } from '@/components/ui/text-link';
import type { SiteArchitecture } from '@/lib/api/types';
import { pluralCount } from '@/lib/format';

// Scope, in the metric's own words. The count is a fact about the pages this
// crawl fetched; it is not the stronger claim that nothing anywhere links to
// them, which stays behind the coverage-gated rule.
export const ORPHAN_SCOPE_NOTE = 'not linked from any page this crawl fetched';

export function OrphanMetric({
  pages,
  total,
  onOpen,
}: Readonly<{
  pages: SiteArchitecture['internal_linking']['orphan_pages'];
  total: number | null;
  onOpen: () => void;
}>) {
  if (total === null) return <StatItem label="Orphaned pages" value={null} />;
  // The count opens the evidence rather than listing it in place. A list of
  // twenty URLs inside a three-metric summary card pushed Structure depth off
  // the fold to say something the number already said; the drawer is where
  // every other Site Health surface puts its supporting rows. The visible
  // label is the bare number, which as an accessible name says only "1", so
  // the target is named by the action instead.
  const action =
    pages.length > 0
      ? {
          onSelect: onOpen,
          actionLabel: `View ${pluralCount(total, 'orphaned page')}`,
        }
      : {};
  return <StatItem label="Orphaned pages" value={total} detail={ORPHAN_SCOPE_NOTE} {...action} />;
}

export function OrphanPageDrawer({
  pages,
  total,
  crawlId,
  open,
  onOpenChange,
}: Readonly<{
  pages: SiteArchitecture['internal_linking']['orphan_pages'];
  total: number | null;
  crawlId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  const undisclosed = (total ?? pages.length) - pages.length;
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Orphaned pages"
      description={ORPHAN_SCOPE_NOTE}
      closeLabel="Close orphaned pages"
    >
      <Stack gap="section">
        <ul className="grid gap-3">
          {pages.map((page) => (
            <li key={page.site_url_id} className="grid min-w-0 gap-0.5">
              {/* Openable, like every other page reference in this tab. A count
                nobody can act on is the failure this whole change is undoing. */}
              {crawlId ? (
                <TextLink
                  text="body"
                  className="truncate"
                  href={`/site/crawls/${crawlId}/pages/${page.site_url_id}`}
                >
                  {page.title || page.url}
                </TextLink>
              ) : (
                <span className="type-body truncate">{page.title || page.url}</span>
              )}
              <span className="type-caption truncate">{page.url}</span>
            </li>
          ))}
        </ul>
        {undisclosed > 0 ? <p className="type-caption">and {undisclosed} more</p> : null}
      </Stack>
    </Drawer>
  );
}
