import { Absence } from '@/components/ui/absence';
import type { InternalLink, InternalLinkAnalysis } from '@citeladder/contracts/site-health';

import { ActionStatusBadge } from '@/components/agent/action-status-badge';
import { isOneOf } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Section } from '@/components/ui/section';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Stack } from '@/components/ui/layout';
import { pageNumberControls, useResizableTablePage } from '@/components/ui/pager';
import { TableCell, TableCellLines, TableRow, UrlText } from '@/components/ui/table';
import { TextLink } from '@/components/ui/text-link';
import { ICONS, PanelRightOpen } from '@/lib/icons';
import { actionStatusSchema } from '@citeladder/contracts/action-status';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { formatCount, readableUrl } from '@/lib/format';
import { internalLinkStateNotice } from '@/lib/site-health/status';
import { useWorkspaceCapability } from '@/lib/project/project-context';
import { InternalLinkReview } from './internal-link-review';
import {
  filterLinks,
  isRunning,
  useLinkParams,
  type LinksRead,
} from './internal-links-panel-bands';
import { Notice } from '@/components/ui/notice';
import { READ_FAILED, StateBlock } from '@/components/ui/state-block';

export function InternalLinksPanel({
  read,
  workspaceId,
}: Readonly<{ read: LinksRead; workspaceId: string }>) {
  const { params, update } = useLinkParams();
  const analysis = read.data?.analysis;
  const links = filterLinks(
    analysis?.recommendations ?? [],
    params.links_q ?? '',
    params.links_status ?? '',
  );
  const selected = analysis?.recommendations.find((link) => link.id === params.link);
  return (
    <Stack gap="workspace" className="min-w-0">
      <Notices read={read} />
      {analysis ? (
        <LinksResult analysis={analysis} links={links} onSelect={(id) => update('link', id)} />
      ) : (
        <StartState read={read} />
      )}
      {analysis ? (
        <InternalLinkReview
          link={selected}
          links={analysis.recommendations}
          workspaceId={workspaceId}
          crawlId={analysis.crawl_id}
          stale={analysis.stale}
          onClose={() => update('link', '')}
        />
      ) : null}
    </Stack>
  );
}

function Notices({ read }: Readonly<{ read: LinksRead }>) {
  const mutationError = read.analyze.error || read.cancel.error;
  const failure = mutationError
    ? mutationNoticeForError(mutationError, {
        action: read.analyze.error ? 'start the analysis' : 'cancel the analysis',
      })
    : null;
  return (
    <>
      {read.query.isError ? (
        <StateBlock
          kind="error"
          error={read.query.error}
          fallback={READ_FAILED}
          title="Couldn't load internal links"
          onRetry={() => void read.query.refetch()}
        />
      ) : null}
      {failure ? <Notice kind="mutation" notice={failure} /> : null}
      {read.query.isPending ? (
        <Section>
          <StateBlock
            kind="loading"
            label="Loading internal links…"
            shape={{ kind: 'table', columns: 5 }}
          />
        </Section>
      ) : null}
    </>
  );
}

function StartState({ read }: Readonly<{ read: LinksRead }>) {
  const canRun = useWorkspaceCapability('run');
  const data = read.data;
  if (!data) return null;
  if (!data.crawl_id)
    return (
      <Section>
        <StateBlock kind="not_measured" description="Available once the crawl finishes." />
      </Section>
    );
  return (
    <Section>
      <StateBlock
        kind="empty"
        icon={ICONS.site}
        heading="Find missing internal links"
        action={
          canRun ? (
            <Button pending={read.analyze.isPending} onClick={read.startAnalysis}>
              Analyze internal links
            </Button>
          ) : undefined
        }
      />
    </Section>
  );
}

function LinksResult({
  analysis,
  links,
  onSelect,
}: Readonly<{
  analysis: InternalLinkAnalysis;
  links: InternalLink[];
  onSelect: (id: string) => void;
}>) {
  const summary = analysis.diagnostics;
  const notice = internalLinkStateNotice(analysis);
  if (isRunning(analysis.state) && !analysis.recommendations.length)
    return (
      <Section>
        <output className="type-body text-ink-2">
          {summary
            ? `Checking related pages… ${formatCount(summary.candidates - summary.pending)} of ${formatCount(summary.candidates)} page pairs done.`
            : 'Checking related pages…'}
        </output>
      </Section>
    );
  return (
    <>
      {analysis.stale ? <Notice tone="warning">From an earlier crawl.</Notice> : null}
      {notice ? <Notice tone="info">{notice}</Notice> : null}
      {['unavailable', 'failed', 'cancelled'].includes(analysis.state) &&
      !analysis.recommendations.length ? null : (
        <LinksBody analysis={analysis} links={links} onSelect={onSelect} />
      )}
    </>
  );
}

function LinksBody({
  analysis,
  links,
  onSelect,
}: Readonly<{
  analysis: InternalLinkAnalysis;
  links: InternalLink[];
  onSelect: (id: string) => void;
}>) {
  const summary = analysis.diagnostics;
  return (
    <>
      {isRunning(analysis.state) && summary ? (
        <output className="type-caption">
          {formatCount(summary.candidates - summary.pending)} of {formatCount(summary.candidates)}{' '}
          page pairs checked
        </output>
      ) : null}
      <LinksTable
        links={links}
        crawlId={analysis.crawl_id}
        emptyReason={emptyReason(analysis)}
        onSelect={onSelect}
      />
    </>
  );
}

const LINK_COLUMNS: readonly DataTableColumn[] = [
  { key: 'source', label: 'Source page', kind: 'identity' },
  { key: 'target', label: 'Add link to', kind: 'text' },
  { key: 'anchor', label: 'Anchor text', kind: 'text', width: 'name', priority: 'low' },
  { key: 'action', label: 'Action', kind: 'status' },
  { key: 'review', label: 'Review', kind: 'actions', width: 'button', hideLabel: true },
];

function emptyReason(analysis: InternalLinkAnalysis): string {
  const summary = analysis.diagnostics;
  if (analysis.recommendations.length) return 'No matches.';
  if (!summary?.candidates) return 'No candidate placements.';
  return `${formatCount(summary.completed)} page pairs checked, none qualified`;
}

function LinksTable({
  links,
  crawlId,
  emptyReason,
  onSelect,
}: Readonly<{
  links: InternalLink[];
  crawlId: string;
  emptyReason: string;
  onSelect: (id: string) => void;
}>) {
  const pagination = useResizableTablePage(links.length, { urlKey: 'links_page' });
  const { pageSize } = pagination;
  const paged = links.slice(pagination.from - 1, pagination.to);
  return (
    <DataTable
      label="Internal link suggestions"
      columns={LINK_COLUMNS}
      pageSize={links.length > pageSize ? pageSize : undefined}
      rowCount={paged.length}
      state={
        links.length
          ? undefined
          : { kind: 'empty', icon: ICONS.site, heading: emptyReason, headingLevel: 3 }
      }
      pager={
        links.length
          ? {
              range: {
                from: pagination.from,
                to: pagination.to,
                total: links.length,
                noun: 'suggestions',
              },
              pageSize: pagination.pageSizeControl,
              ...pageNumberControls(pagination.page, pagination.pageCount, pagination.setPage),
            }
          : undefined
      }
    >
      {paged.map((link) => (
        <TableRow key={link.id}>
          <TableCell>
            <PageCell
              page={link.source}
              href={`/site/crawls/${crawlId}/pages/${link.source.site_url_id}`}
            />
          </TableCell>
          <TableCell>
            <PageCell page={link.target} />
          </TableCell>
          <TableCell>{link.anchor}</TableCell>
          <TableCell className="whitespace-nowrap">
            <LinkActionStatus status={link.action_status} />
          </TableCell>
          <TableCell>
            <Button
              variant="secondary"
              onClick={() => onSelect(link.id)}
              aria-label={`Review link from ${link.source.title || link.source.url} to ${link.target.title || link.target.url}`}
            >
              <Icon icon={PanelRightOpen} />
              Review
            </Button>
          </TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}

function LinkActionStatus({ status }: Readonly<{ status: string | null }>) {
  if (status === null) return <NoAction />;
  if (isOneOf(actionStatusSchema.options, status)) return <ActionStatusBadge status={status} />;
  return <Absence state="unavailable" label="Unknown status" />;
}

function NoAction() {
  return <Absence state="not_set" label="No Action yet" />;
}

function PageCell({
  page,
  href,
}: Readonly<{ page: Pick<InternalLink['source'], 'title' | 'url'>; href?: string }>) {
  const name = page.title || readableUrl(new URL(page.url).pathname);
  return (
    <TableCellLines
      primary={
        href ? (
          <TextLink text="inherit" underline="hover" href={href}>
            {name}
          </TextLink>
        ) : (
          name
        )
      }
      secondary={<UrlText url={page.url} origin={new URL(page.url).origin} />}
    />
  );
}
