import { useQuery } from '@tanstack/react-query';
import { useLocation, useParams } from 'react-router-dom';

import { DetailsFacts, Labelled, ReadingColumn } from '@/components/ui/reading-page';
import { Impact } from '@/components/agent/actions-rows';
import { PageFrame } from '@/components/templates/page-frame';
import type { Crumb } from '@/components/ui/breadcrumb';
import { Button, buttonClasses } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { LinkRow, LinkRows } from '@/components/ui/link-rows';
import { ProjectLink } from '@/components/ui/project-link';
import { PageDock } from '@/components/ui/selection-dock';
import { StateBlock } from '@/components/ui/state-block';
import { readErrorProps } from '@/components/ui/notice';
import { Sparkles } from '@/lib/icons';
import { fromActionSchema, listCrumbs, type FromAction } from '@/lib/agent/action-crumbs';
import { actionTarget, pathTail } from '@/lib/agent/action-title';
import { agentHandoffHref } from '@/lib/agent/handoff';
import { ACTION_GROUPING_LABEL } from '@/lib/agent/vocabulary';
import { actionsApi, actionsQueries } from '@/lib/api/actions';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { formatDisplayDate, formatCount } from '@/lib/format';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { pageKindLabel } from '@/lib/site-health/page-kinds';

type UrlActions = Awaited<ReturnType<typeof actionsApi.urlActions>>;

export function ActionUrlScreen() {
  const { siteUrlId = '' } = useParams();
  const scope = useProjectScope();
  const parsed = fromActionSchema.safeParse(useLocation().state);
  const from = parsed.success ? parsed.data.fromAction : null;
  const query = useQuery({
    ...actionsQueries.urlActions(scope, siteUrlId),
    enabled: Boolean(siteUrlId),
  });
  const path = query.data
    ? actionTarget({ target_kind: 'page', target_label: query.data.url })
    : 'URL';
  let body = <StateBlock kind="loading" shape={{ kind: 'facts', rows: 3 }} />;
  if (query.isError)
    body = (
      <StateBlock
        kind="error"
        {...readErrorProps(query)}
        title="Couldn't load this URL"
        fallback="This URL could not be loaded."
      />
    );
  else if (query.data) body = <UrlBody data={query.data} />;
  return (
    <PageFrame title={path} trail={trail(from)} crumb={{ label: pathTail(path) }}>
      <ReadingColumn>{body}</ReadingColumn>
      <UrlDock siteUrlId={siteUrlId} unreadable={query.isError} />
    </PageFrame>
  );
}

function UrlBody({ data }: Readonly<{ data: UrlActions }>) {
  const timeZone = useDisplayTimeZone();
  const open = data.items.filter((item) => item.status === 'open' || item.status === 'in_progress');
  return (
    <>
      <DetailsFacts
        facts={[
          {
            label: 'Page type',
            value: data.page_kind ? pageKindLabel(data.page_kind) : 'Not classified',
          },
          { label: 'Last crawled', value: formatDisplayDate(data.last_crawled_at, timeZone) },
          { label: 'Open actions', value: `${formatCount(open.length)} on this URL` },
        ]}
      />
      <Labelled title="Actions on this URL">
        {data.items.length === 0 ? (
          <StateBlock kind="empty" inline message="No action touches this URL." />
        ) : (
          <LinkRows label="Actions on this URL">
            {data.items.map((item) => (
              <LinkRow
                key={item.id}
                href={`/actions/${item.id}`}
                name={actionTarget(item)}
                facts={[
                  ACTION_GROUPING_LABEL[item.grouping],
                  <Impact key="impact" band={item.priority_band} />,
                ]}
              />
            ))}
          </LinkRows>
        )}
      </Labelled>
    </>
  );
}

/** "Fix this URL with Agent"; a URL that could not be read is not handed over, as the Agent would refuse it. */
function UrlDock({ siteUrlId, unreadable }: Readonly<{ siteUrlId: string; unreadable: boolean }>) {
  return (
    <PageDock label="Work on this URL">
      {unreadable ? (
        <Button variant="primary" disabled>
          <Icon icon={Sparkles} />
          Fix this URL with Agent
        </Button>
      ) : (
        <ProjectLink
          href={agentHandoffHref({ urlActionsSiteUrlId: siteUrlId, prompt: URL_ASK })}
          className={buttonClasses('primary')}
        >
          <Icon icon={Sparkles} />
          Fix this URL with Agent
        </ProjectLink>
      )}
    </PageDock>
  );
}

const URL_ASK = 'Fix every action on this URL, starting with the shared ones.';

function trail(from: FromAction | null): Crumb[] {
  if (!from) return [{ label: 'Actions', href: '/actions' }];
  return [...listCrumbs(from), { label: from.title, href: `/actions/${from.id}` }];
}
