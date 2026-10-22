'use client';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { Select } from '@/components/ui/select';
import {
  ClampText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
      <CardContent className="grid min-w-0 gap-3">
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
          <Select
            className="w-48 max-w-full"
            ariaLabel="Filter crawlers by purpose"
            value={purpose}
            onValueChange={setPurpose}
            options={[
              { value: 'all', label: 'All purposes' },
              ...purposes.map((value) => ({ value, label: crawlerPurposeLabels[value] })),
            ]}
          />
          <CrawlerTable view={view} purposes={purposes} purpose={purpose} />
        </Disclosure>
        <Disclosure title="robots.txt history" onOpenChange={setHistoryOpen}>
          {historyOpen ? (
            <RobotsHistory workspaceId={crawl.workspace_id} projectId={crawl.project_id} />
          ) : null}
        </Disclosure>
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

function CrawlerTable({
  view,
  purposes,
  purpose,
}: Readonly<{ view: SiteFactsView; purposes: CrawlerBot['purpose'][]; purpose: string }>) {
  return (
    <Table minWidth="md" className="table-fixed">
      <caption className="sr-only">Crawler robots policy by purpose</caption>
      <colgroup>
        <col className="w-1/5" />
        <col className="w-[16%]" />
        <col className="w-[18%]" />
        <col className="w-[14%]" />
        <col className="w-[32%]" />
      </colgroup>
      <TableHeader>
        <TableRow>
          <TableHead>Bot</TableHead>
          <TableHead>Operator</TableHead>
          <TableHead>Matched group</TableHead>
          <TableHead>Root access</TableHead>
          <TableHead>Robots policy</TableHead>
        </TableRow>
      </TableHeader>
      {purposes
        .filter((value) => purpose === 'all' || value === purpose)
        .map((group) => (
          <TableBody key={group}>
            <TableRow>
              <TableHead scope="rowgroup" colSpan={5} className="bg-panel-tonal static">
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
                    <span className="flex min-w-0 items-center gap-2 whitespace-nowrap">
                      <Badge>{crawlerPolicyLabels[bot.policy]}</Badge>
                      <PolicySample bot={bot} />
                    </span>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        ))}
    </Table>
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
