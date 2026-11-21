import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';

import { Labelled } from '@/components/ui/reading-page';
import { Checkbox } from '@/components/ui/checkbox';
import { LinkRow, LinkRows } from '@/components/ui/link-rows';
import { textRole } from '@/components/ui/typography';
import { WorkRowsMore } from '@/components/ui/work-rows';
import type { FromAction } from '@/lib/agent/action-crumbs';
import { actionTarget } from '@/lib/agent/action-title';
import { HANDOFF_URLS_MAX } from '@/lib/agent/handoff';
import { actionsQueries, type ActionDetail } from '@/lib/api/actions';
import { ACTIONS_GROUPING_PAGE_SIZE } from '@/lib/config/agent';
import { formatCount, pluralCount } from '@/lib/format';
import { pageKindLabel } from '@/lib/site-health/page-kinds';

export function ActionUrls({
  action,
  workspaceId,
  from,
  ticked,
  onTick,
}: Readonly<{
  action: ActionDetail;
  workspaceId: string;
  from: FromAction;
  ticked: ReadonlySet<string>;
  onTick: (siteUrlId: string) => void;
}>) {
  const first = action.urls;
  const cursor = first.next_cursor;
  const [more, setMore] = useState(false);
  const extra = useInfiniteQuery({
    ...actionsQueries.urls(workspaceId, action.id, cursor ?? ''),
    enabled: more && cursor !== null,
  });
  if (first.whole_site || first.total === 0) return null;
  const seen = new Set(first.items.map((url) => url.site_url_id));
  const rows = [
    ...first.items,
    ...(extra.data?.pages.flatMap((page) => page.items) ?? []).filter(
      (url) => !seen.has(url.site_url_id),
    ),
  ];
  const rest = first.total - rows.length;
  // The total can drift from the pages; the last page ends "Show more".
  const exhausted = extra.isSuccess && !extra.hasNextPage;
  const full = ticked.size >= HANDOFF_URLS_MAX;
  const showMore = () => {
    if (!more) setMore(true);
    else void extra.fetchNextPage();
  };
  return (
    <Labelled title={`URLs · ${formatCount(first.total)}`}>
      <LinkRows
        label="URLs"
        more={
          rest > 0 && cursor !== null && !exhausted ? (
            <WorkRowsMore onClick={showMore} disabled={extra.isFetching}>
              {extra.isFetching
                ? 'Loading…'
                : `Show ${formatCount(Math.min(rest, ACTIONS_GROUPING_PAGE_SIZE))} more`}
            </WorkRowsMore>
          ) : null
        }
      >
        {rows.map((url) => {
          const on = ticked.has(url.site_url_id);
          return (
            <LinkRow
              key={url.site_url_id}
              tick={
                <Checkbox
                  aria-label={`Select ${url.url}`}
                  checked={on}
                  disabled={!on && full}
                  onCheckedChange={() => onTick(url.site_url_id)}
                />
              }
              href={`/actions/urls/${url.site_url_id}`}
              state={{ fromAction: from }}
              name={<UrlPath url={url.url} />}
              facts={[
                url.page_kind ? pageKindLabel(url.page_kind) : 'Not classified',
                pluralCount(url.open_action_count, 'action'),
              ]}
            />
          );
        })}
      </LinkRows>
    </Labelled>
  );
}

function UrlPath({ url }: Readonly<{ url: string }>) {
  const path = actionTarget({ target_kind: 'page', target_label: url });
  const home = !path.startsWith('/');
  const cut = path.lastIndexOf('/') + 1;
  return (
    <span className={textRole('caption', 'block truncate')} title={url}>
      {home ? null : path.slice(0, cut)}
      <b className={textRole('emphasis', 'text-ink')}>{home ? '/' : path.slice(cut)}</b>
    </span>
  );
}
