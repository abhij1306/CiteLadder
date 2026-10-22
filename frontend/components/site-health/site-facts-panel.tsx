'use client';
import { Fragment, useState, type ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Disclosure } from '@/components/ui/disclosure';
import { Inline, Stack } from '@/components/ui/layout';
import { Select } from '@/components/ui/select';
import { ClampText, TableCell, TableHead, TableRow } from '@/components/ui/table';
import { textRole } from '@/components/ui/typography';
import { ProjectLink } from '@/components/layout/scoped-link';
import type { SiteCrawl, SiteHealthDashboard } from '@/lib/api/types';
import { agentHandoffHref } from '@/lib/agent/handoff';
import { formatCount, pluralCount } from '@/lib/format';
import { useAgentPanelSeed } from '@/lib/agent/panel-context';
import {
  crawlerMatchedLabels,
  crawlerPolicyLabels,
  crawlerPurposeLabels,
  crawlerRootAccessLabels,
  readSiteFacts,
  robotsStatusLabels,
  type SiteFactsView,
} from '@/lib/site-health/site-facts';
import { RobotsHistory } from './robots-history';

export function SiteFactsPanel({
  crawl,
  dashboard,
}: Readonly<{
  crawl: SiteCrawl | null;
  dashboard: SiteHealthDashboard | undefined;
}>) {
  const current = dashboard?.crawl ?? crawl;
  useAgentPanelSeed(
    current
      ? {
          siteFacts: { crawlId: current.id },
          prompt: 'Explain the selected crawl’s persisted AI crawlability and robots policy.',
        }
      : null,
  );
  const view = readSiteFacts(current?.site_facts);
  if (!current || !view) return null;
  return <SiteFactsViewPanel key={current.id} crawl={current} view={view} />;
}
function SiteFactsViewPanel({ crawl, view }: Readonly<{ crawl: SiteCrawl; view: SiteFactsView }>) {
  const [purpose, setPurpose] = useState('all');
  const [historyOpen, setHistoryOpen] = useState(false);
  const purposes = [...new Set(view.robots.bots.map((bot) => bot.purpose))];
  const unknown = view.robots.status === 'fetch_failed' || view.robots.status === 'access_blocked';
  let llmsStatus = 'not fetched';
  if (view.llms_txt.fetched) llmsStatus = view.llms_txt.present ? 'present' : 'absent';
  return (
    <Card className="min-w-0">
      <CardHeader
        actions={
          <Button variant="secondary" asChild>
            <ProjectLink
              projectId={crawl.project_id}
              href={agentHandoffHref({
                siteFacts: { crawlId: crawl.id },
                prompt: `Explain the persisted AI crawlability and robots policy for crawl ${crawl.id}. Use read_ai_crawlability and distinguish robots permission from observed retrieval.`,
              })}
            >
              Ask agent
            </ProjectLink>
          </Button>
        }
      >
        <CardTitle>AI crawler robots policy</CardTitle>
        <p className={textRole('caption')}>
          What robots.txt permits over known URLs. This does not prove that a crawler retrieved a
          page.
        </p>
        <p className={textRole('caption')}>
          robots.txt: {robotsStatusLabels[view.robots.status]}
          {view.robots.status_code !== null ? ` (HTTP ${view.robots.status_code})` : ''} · llms.txt:{' '}
          {llmsStatus}
        </p>
      </CardHeader>
      <CardContent>
        <Stack className="min-w-0">
          {unknown ? (
            <Alert tone="warning">
              robots.txt could not be read. Root access and robots policy are unknown.
            </Alert>
          ) : null}
          {view.robots.status === 'not_found' ? (
            <Alert tone="info">
              No robots.txt was found. No robots rules restrict these known URLs.
            </Alert>
          ) : null}
          <Disclosure title={crawlerSummary(view)}>
            <CrawlerTable
              view={view}
              purposes={purposes}
              purpose={purpose}
              filter={
                <Select
                  ariaLabel="Filter crawlers by purpose"
                  value={purpose}
                  onValueChange={setPurpose}
                  options={[
                    { value: 'all', label: 'All purposes' },
                    ...purposes.map((value) => ({ value, label: crawlerPurposeLabels[value] })),
                  ]}
                />
              }
            />
          </Disclosure>
          <Disclosure title="robots.txt history" onOpenChange={setHistoryOpen}>
            {historyOpen ? (
              <RobotsHistory workspaceId={crawl.workspace_id} projectId={crawl.project_id} />
            ) : null}
          </Disclosure>
        </Stack>
      </CardContent>
    </Card>
  );
}

/** One line for the closed crawler list: the total, then each policy that occurs. */
function crawlerSummary(view: SiteFactsView): string {
  const bots = view.robots.bots;
  // The label table lists every policy in display order, so a new one is counted.
  const policies = Object.entries(crawlerPolicyLabels)
    .map(([policy, label]) => ({
      label,
      count: bots.filter((bot) => bot.policy === policy).length,
    }))
    .filter(({ count }) => count > 0)
    .map(({ label, count }) => `${formatCount(count)} ${label.toLowerCase()}`)
    .join(', ');
  const total = pluralCount(bots.length, 'crawler');
  return policies ? `${total}: ${policies}` : total;
}

type CrawlerBot = SiteFactsView['robots']['bots'][number];

const CRAWLER_COLUMNS: readonly DataTableColumn[] = [
  { key: 'bot', label: 'Bot' },
  { key: 'operator', label: 'Operator', width: 'status' },
  { key: 'matched', label: 'Matched group', width: 'status' },
  { key: 'root', label: 'Root access', width: 'status' },
  { key: 'policy', label: 'Robots policy', width: 'name' },
];

function CrawlerTable({
  view,
  purposes,
  purpose,
  filter,
}: Readonly<{
  view: SiteFactsView;
  purposes: CrawlerBot['purpose'][];
  purpose: string;
  filter: ReactNode;
}>) {
  return (
    <DataTable
      label="Crawler robots policy by purpose"
      columns={CRAWLER_COLUMNS}
      minWidth="md"
      toolbar={{ filters: filter }}
    >
      {purposes
        .filter((value) => purpose === 'all' || value === purpose)
        .map((group) => (
          <Fragment key={group}>
            <TableRow>
              <TableHead scope="colgroup" colSpan={5} className="bg-panel-tonal static">
                {crawlerPurposeLabels[group]}
              </TableHead>
            </TableRow>
            {view.robots.bots
              .filter((bot) => bot.purpose === group)
              .map((bot) => (
                <TableRow key={bot.bot_id}>
                  <TableCell>{bot.label}</TableCell>
                  <TableCell>{bot.operator}</TableCell>
                  <TableCell>{crawlerMatchedLabels[bot.matched]}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Badge>{crawlerRootAccessLabels[bot.root_access]}</Badge>
                  </TableCell>
                  <TableCell>
                    <Inline className="whitespace-nowrap">
                      <Badge>{crawlerPolicyLabels[bot.policy]}</Badge>
                      <PolicySample bot={bot} />
                    </Inline>
                  </TableCell>
                </TableRow>
              ))}
          </Fragment>
        ))}
    </DataTable>
  );
}

function PolicySample({ bot }: Readonly<{ bot: CrawlerBot }>) {
  const sample =
    bot.policy === 'unknown'
      ? 'No complete policy sample is available.'
      : `${bot.disallowed_url_count} of ${bot.evaluated_url_count} known URLs disallowed`;
  // One line per crawler: the sample truncates in a narrow column and keeps its full text.
  return (
    <ClampText lines={1} className={textRole('caption')}>
      {sample}
    </ClampText>
  );
}
