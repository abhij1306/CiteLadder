import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';

import { Checkbox } from '@/components/ui/checkbox';
import { StatusMark } from '@/components/ui/status-mark';
import { WorkRow, WorkRows, WorkRowsMore } from '@/components/ui/work-rows';
import { actionTarget } from '@/lib/agent/action-title';
import { groupingParams, type GroupingRef, type TreeGrouping } from '@/lib/agent/action-tree';
import { approachLabel, familyLabel, IMPACT_LABEL, targetKindLabel } from '@/lib/agent/vocabulary';
import { actionsQueries, type Action } from '@/lib/api/actions';
import { ACTIONS_GROUPING_PAGE_SIZE } from '@/lib/config/agent';
import { formatCount, pluralCount } from '@/lib/format';
import { firstSentence } from '@/lib/site-health/issues';

import { useActionsPageContext } from './actions-page-context';

const SCOPE_BY_KIND: Readonly<Record<string, string>> = {
  prompt: '1 prompt',
  planned_page: 'New page',
  page: '1 URL',
  earned_page: 'Outreach',
  query: '1 query',
  product: '1 product',
  category: '1 category',
};

export function scopeLabel(action: Pick<Action, 'target_kind' | 'page_count'>): string {
  if (action.target_kind === 'issue_family') {
    if (action.page_count === null) return 'Not stated';
    return action.page_count > 0 ? pluralCount(action.page_count, 'URL') : 'Whole site';
  }
  return SCOPE_BY_KIND[action.target_kind] ?? 'Not stated';
}

export function sourceLabel(action: Pick<Action, 'families' | 'origin'>): string {
  return (
    familyLabel(action.families[0] ?? '') ?? (action.origin === 'agent' ? 'Agent' : 'Not stated')
  );
}

export function Impact({ band }: Readonly<{ band: Action['priority_band'] }>) {
  if (!band) return <span>Not scored</span>;
  return (
    <StatusMark variant="priority" value={band}>
      {IMPACT_LABEL[band]}
    </StatusMark>
  );
}

export function GroupingRows({
  refOf,
  grouping,
}: Readonly<{ refOf: GroupingRef; grouping: TreeGrouping }>) {
  const { scope, view } = useActionsPageContext();
  const [more, setMore] = useState(false);
  const cursor = grouping.next_cursor;
  const extra = useInfiniteQuery({
    ...actionsQueries.groupingRows(
      scope,
      groupingParams({ ref: refOf, groupBy: view.groupBy, filters: view.filters }),
      cursor ?? '',
    ),
    enabled: more && cursor !== null,
  });
  const seen = new Set(grouping.items.map((item) => item.id));
  const rows = [
    ...grouping.items,
    ...(extra.data?.pages.flatMap((page) => page.items) ?? []).filter((item) => !seen.has(item.id)),
  ];
  const rest = grouping.count - rows.length;
  const exhausted = extra.isSuccess && !extra.hasNextPage;
  const showMore = () => {
    if (!more) setMore(true);
    else void extra.fetchNextPage();
  };
  return (
    <WorkRows
      label={pluralCount(grouping.count, 'action')}
      heads={['Action', 'Scope', 'Impact', 'Source']}
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
      {rows.map((action) => (
        <ActionRow key={action.id} action={action} refOf={refOf} />
      ))}
    </WorkRows>
  );
}

function ActionRow({ action, refOf }: Readonly<{ action: Action; refOf: GroupingRef }>) {
  const { selection } = useActionsPageContext();
  const title = actionTarget(action);
  const whole = selection.hasGrouping(refOf);
  const caption = [
    action.summary
      ? firstSentence(action.summary)
      : (approachLabel(action.approach) ?? targetKindLabel(action.target_kind)),
    action.origin === 'agent' ? 'From agent work' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <WorkRow
      tick={
        <Checkbox
          aria-label={`Select ${title}`}
          checked={whole || selection.hasRow(action.id)}
          disabled={whole}
          onCheckedChange={() => selection.toggleRow(action.id, refOf)}
        />
      }
      href={`/actions/${action.id}`}
      title={title}
      caption={caption}
      scope={scopeLabel(action)}
      impact={<Impact band={action.priority_band} />}
      source={sourceLabel(action)}
    />
  );
}
