import { Drawer } from '@/components/ui/drawer';
import { Stack } from '@/components/ui/layout';
import { TextLink } from '@/components/ui/text-link';
import type { SiteArchitecture } from '@citeladder/contracts';
import { ClampText } from '@/components/ui/clamp-text';
import { formatCount, pluralCount, readableUrl } from '@/lib/format';
import { type FigureSegment } from '@/components/ui/figure-strip';

const ORPHAN_SCOPE_NOTE = 'within this crawl';

export function orphanSegment({
  pages,
  total,
  onOpen,
}: Readonly<{
  pages: SiteArchitecture['internal_linking']['orphan_pages'];
  total: number | null;
  onOpen: () => void;
}>): FigureSegment {
  const base = { key: 'orphans', label: 'Orphaned pages' };
  if (total === null) return { ...base, value: null };
  if (pages.length === 0) return { ...base, value: total, sub: ORPHAN_SCOPE_NOTE };
  return {
    ...base,
    value: total,
    sub: ORPHAN_SCOPE_NOTE,
    onSelect: onOpen,
    actionLabel: `View ${pluralCount(total, 'orphaned page')}`,
  };
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
      closeLabel="Close orphaned pages"
    >
      <Stack gap="section">
        <Stack as="ul">
          {pages.map((page) => (
            <Stack as="li" gap="tight" key={page.site_url_id} className="min-w-0">
              {crawlId ? (
                <TextLink
                  text="body"
                  className="block min-w-0"
                  href={`/site/crawls/${crawlId}/pages/${page.site_url_id}`}
                >
                  <ClampText>{page.title || page.url}</ClampText>
                </TextLink>
              ) : (
                <ClampText className="type-body text-ink">{page.title || page.url}</ClampText>
              )}
              <ClampText className="type-caption">{readableUrl(page.url)}</ClampText>
            </Stack>
          ))}
        </Stack>
        {undisclosed > 0 ? (
          <p className="type-caption">and {formatCount(undisclosed)} more</p>
        ) : null}
      </Stack>
    </Drawer>
  );
}
