import { Fragment, useState } from 'react';
import { choiceFilter, type FilterDefinition } from '@/components/ui/all-filters';
import { Tag } from '@/components/ui/tag';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Disclosure } from '@/components/ui/disclosure';
import { Inline, Stack } from '@/components/ui/layout';
import { ClampText } from '@/components/ui/clamp-text';
import { TableCell, TableHead, TableRow } from '@/components/ui/table';
import { textRole } from '@/components/ui/typography';
import { ProjectLink } from '@/components/ui/project-link';
import type { SiteCrawl, SiteHealthDashboard } from '@citeladder/contracts';
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
import { Notice } from '@/components/ui/notice';
import {
  Section,
  SectionContent,
  SectionDescription,
  SectionHeader,
  SectionTitle,
} from '@/components/ui/section';

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
          prompt: 'Explain the selected crawl’s AI crawlability and robots policy.',
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
    <Section className="min-w-0">
      <SectionHeader
        actions={
          <Button variant="secondary" asChild>
            <ProjectLink
              projectId={crawl.project_id}
              href={agentHandoffHref({
                siteFacts: { crawlId: crawl.id },
                prompt: `Explain the AI crawlability and robots policy for crawl ${crawl.id}. Use read_ai_crawlability and distinguish robots permission from observed retrieval.`,
              })}
            >
              Ask agent
            </ProjectLink>
          </Button>
        }
      >
        <SectionTitle>AI crawler robots policy</SectionTitle>
        <SectionDescription>
          robots.txt: {robotsStatusLabels[view.robots.status]}
          {view.robots.status_code !== null ? ` (HTTP ${view.robots.status_code})` : ''} · llms.txt:{' '}
          {llmsStatus}
        </SectionDescription>
      </SectionHeader>
      <SectionContent>
        <Stack gap="workspace" className="min-w-0">
          {unknown ? <Notice tone="warning">robots.txt could not be read.</Notice> : null}
          <Disclosure title={crawlerSummary(view)}>
            <CrawlerTable
              view={view}
              purposes={purposes}
              purpose={purpose}
              filter={choiceFilter({
                id: 'purpose',
                label: 'Purpose',
                value: purpose,
                defaultValue: 'all',
                groups: [
                  {
                    options: [
                      { value: 'all', label: 'All purposes' },
                      ...purposes.map((value) => ({ value, label: crawlerPurposeLabels[value] })),
                    ],
                  },
                ],
                onChange: setPurpose,
              })}
            />
          </Disclosure>
          <Disclosure title="robots.txt history" onOpenChange={setHistoryOpen}>
            {historyOpen ? (
              <RobotsHistory workspaceId={crawl.workspace_id} projectId={crawl.project_id} />
            ) : null}
          </Disclosure>
        </Stack>
      </SectionContent>
    </Section>
  );
}

function crawlerSummary(view: SiteFactsView): string {
  const bots = view.robots.bots;
  const policies = Object.entries(crawlerPolicyLabels)
    .map(([policy, label]) => ({
      label,
      count: bots.filter((bot) => bot.policy === policy).length,
    }))
    .filter(({ count }) => count > 0);
  const total = pluralCount(bots.length, 'crawler');
  const [only, ...others] = policies;
  if (!only) return total;
  if (!others.length) return `${total}: ${only.label.toLowerCase()}`;
  return `${total}: ${policies
    .map(({ label, count }) => `${formatCount(count)} ${label.toLowerCase()}`)
    .join(', ')}`;
}

type CrawlerBot = SiteFactsView['robots']['bots'][number];

const CRAWLER_COLUMNS: readonly DataTableColumn[] = [
  { key: 'bot', label: 'Bot', kind: 'identity' },
  { key: 'operator', label: 'Operator', kind: 'text', width: 'status' },
  { key: 'matched', label: 'Matched group', kind: 'text', width: 'status' },
  { key: 'root', label: 'Root access', kind: 'status' },
  { key: 'policy', label: 'Robots policy', kind: 'status', width: 'name' },
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
  filter: FilterDefinition;
}>) {
  return (
    <DataTable
      label="Crawler robots policy by purpose"
      columns={CRAWLER_COLUMNS}
      toolbar={{ filters: [filter] }}
    >
      {purposes
        .filter((value) => purpose === 'all' || value === purpose)
        .map((group) => (
          <Fragment key={group}>
            <TableRow>
              <TableHead scope="colgroup" colSpan={5} className="static">
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
                    <Tag>{crawlerRootAccessLabels[bot.root_access]}</Tag>
                  </TableCell>
                  <TableCell>
                    <Inline className="whitespace-nowrap">
                      <Tag>{crawlerPolicyLabels[bot.policy]}</Tag>
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
      ? 'Unknown'
      : `${formatCount(bot.disallowed_url_count)} of ${formatCount(bot.evaluated_url_count)} known URLs disallowed`;
  return (
    <ClampText lines={1} className={textRole('caption')}>
      {sample}
    </ClampText>
  );
}
