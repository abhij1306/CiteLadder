import { Badge } from '@/components/ui/badge';
import { QueryState } from '@/components/ui/query-state';
import { StatRow } from '@/components/ui/stat-row';
import { TextLink } from '@/components/ui/text-link';
import { Label, textRole } from '@/components/ui/typography';
import type { PageDetail } from '@/lib/api/types';
import { Inline, Stack } from '@/components/ui/layout';
import { ledgerClasses, ledgerItemClasses, splitPaneClasses } from '@/components/ui/workspace';

/**
 * Internal links — the crawl's persisted link-graph projection for this page.
 *
 * Two numbers that look alike and are not: `Inbound` counts every internal
 * link, navigation included; `Main-content inbound` counts only the ones the
 * DOM placed inside the page's primary region. A page with a large first number
 * and a zero second one is in the menu and nowhere else. `Depth from home` is
 * shortest path over all followable links, because a nav link is a real click.
 *
 * The caller distinguishes absent crawl measurements from an observed zero.
 */
export function InternalLinksCard({
  links,
  crawlId,
}: Readonly<{ links: NonNullable<PageDetail['internal_links']>; crawlId: string }>) {
  const diagnosticCounts = {
    generic: links.anchor_diagnostics.filter((item) => item.kind === 'generic').length,
    repeated_destination: links.anchor_diagnostics.filter(
      (item) => item.kind === 'repeated_destination',
    ).length,
    low_lexical_alignment: links.anchor_diagnostics.filter(
      (item) => item.kind === 'low_lexical_alignment',
    ).length,
  };
  const metrics = [
    { label: 'Inbound', value: links.inbound_count },
    { label: 'Main-content inbound', value: links.main_content_inbound_count },
    { label: 'Outbound', value: links.outbound_count },
    { label: 'Main-content outbound', value: links.main_content_outbound_count },
    { label: 'Nofollow inbound', value: links.nofollow_inbound_count },
    {
      label: 'Internal authority',
      value: `${(links.authority_share * 100).toFixed(2)}%`,
    },
    { label: 'Authority rank', value: links.authority_rank },
    { label: 'Generic anchor patterns', value: diagnosticCounts.generic },
    {
      label: 'Repeated destination patterns',
      value: diagnosticCounts.repeated_destination,
    },
    {
      label: 'Low lexical alignment',
      value: diagnosticCounts.low_lexical_alignment,
    },
    {
      label: 'Depth from home',
      value: links.depth_from_home,
    },
  ];
  return (
    <Stack gap="workspace" className="min-w-0">
      <p className={textRole('caption')}>
        {`Modelled over ${links.source_page_count} observed crawl page${links.source_page_count === 1 ? '' : 's'}${links.observed_crawl_incomplete ? '; this crawl is incomplete or sampled' : ''}`}
      </p>
      <StatRow segments={metrics.map((metric) => ({ key: metric.label, ...metric }))} />
      <div className={splitPaneClasses('peers')}>
        <NeighbourList
          heading="Top linking pages"
          neighbours={links.top_inbound}
          crawlId={crawlId}
          emptyMessage="No crawled page links here."
        />
        <NeighbourList
          heading="Top linked pages"
          neighbours={links.top_outbound}
          crawlId={crawlId}
          emptyMessage="This page links to no other crawled page."
        />
      </div>
    </Stack>
  );
}

function NeighbourList({
  heading,
  neighbours,
  crawlId,
  emptyMessage,
}: Readonly<{
  heading: string;
  neighbours: NonNullable<PageDetail['internal_links']>['top_inbound'];
  crawlId: string;
  emptyMessage: string;
}>) {
  return (
    <Stack as="section" gap="item" className="min-w-0 content-start overflow-hidden">
      <Label>{heading}</Label>
      {neighbours.length === 0 ? (
        <QueryState kind="empty" inline message={emptyMessage} />
      ) : (
        <ul className={ledgerClasses()}>
          {neighbours.map((neighbour) => (
            <Inline
              as="li"
              gap="compact"
              key={`${neighbour.site_url_id ?? neighbour.url}`}
              className={ledgerItemClasses('items-start justify-between')}
            >
              {/* An off-crawl target is counted but was never a node, so it has
                  no detail route to link to. */}
              {neighbour.site_url_id ? (
                <TextLink
                  text="caption"
                  className="min-w-0 [overflow-wrap:anywhere] tabular-nums"
                  href={`/site/crawls/${crawlId}/pages/${neighbour.site_url_id}`}
                  title={neighbour.url}
                >
                  {neighbour.url}
                </TextLink>
              ) : (
                <span
                  className="type-caption min-w-0 [overflow-wrap:anywhere] tabular-nums"
                  title={neighbour.url}
                >
                  {neighbour.url}
                </span>
              )}
              <Inline as="span" className="shrink-0">
                {neighbour.main_content ? <Badge>Main</Badge> : null}
                {neighbour.nofollow ? <Badge className="text-muted">nofollow</Badge> : null}
                <span className="type-caption tabular-nums">×{neighbour.anchor_count}</span>
              </Inline>
            </Inline>
          ))}
        </ul>
      )}
    </Stack>
  );
}
