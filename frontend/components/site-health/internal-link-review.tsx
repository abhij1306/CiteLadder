import type { InternalLink } from '@citeladder/contracts/site-health';
import { useState } from 'react';

import { ProjectLink } from '@/components/ui/project-link';
import { ActionButton } from '@/components/ui/actions';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

import { settingRowsClasses } from '@/components/ui/setting-row';
import { wellClasses } from '@/components/ui/slip';
import { ClampText } from '@/components/ui/clamp-text';
import { CopyButton } from '@/components/ui/copy-button';
import { Drawer } from '@/components/ui/drawer';
import { Icon } from '@/components/ui/icon';
import { Inline, Stack } from '@/components/ui/layout';
import { TextLink } from '@/components/ui/text-link';
import { EditorialSectionHeader } from '@/components/ui/workspace';
import { MarkActionImplemented } from '@/components/agent/action-declaration';
import { FileSearch } from '@/lib/icons';
import { pluralCount, readableUrl } from '@/lib/format';
import { useWorkspaceCapability } from '@/lib/project/project-context';

const escapeHtml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

function LinkEnd({
  label,
  page,
  note,
}: Readonly<{ label: string; page: InternalLink['source']; note?: string }>) {
  const summary = page.description || page.excerpt;
  return (
    <div className="grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3">
      <span className="type-caption pt-0.5">{label}</span>
      <div className="grid min-w-0 gap-1">
        <TextLink
          variant="external"
          text="body"
          className="flex w-fit max-w-full min-w-0 items-center"
          href={page.url}
        >
          <ClampText tooltip={page.url} className="min-w-0">
            {page.title || readableUrl(page.url)}
          </ClampText>
        </TextLink>
        {summary ? (
          <ClampText lines={2} className="type-caption">
            {summary}
          </ClampText>
        ) : null}
        {note ? <span className="type-caption">{note}</span> : null}
      </div>
    </div>
  );
}

function inboundNote(count: number | null) {
  return count === null
    ? 'Contextual inbound links not counted'
    : pluralCount(count, 'contextual inbound link');
}

export function InternalLinkReview({
  link,
  links,
  workspaceId,
  crawlId,
  stale,
  onClose,
}: Readonly<{
  link: InternalLink | undefined;
  links: InternalLink[];
  workspaceId: string;
  crawlId: string;
  stale: boolean;
  onClose: () => void;
}>) {
  return (
    <Drawer
      open={Boolean(link)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Review internal link"
    >
      {link ? (
        <Stack gap="section">
          <div className={settingRowsClasses()}>
            <LinkEnd label="From" page={link.source} />
            <LinkEnd
              label="To"
              page={link.target}
              note={inboundNote(link.target.contextual_inbound)}
            />
          </div>
          <Stack as="section">
            <EditorialSectionHeader title={link.placement ? 'Where it goes' : 'Anchor text'} />
            <p className={wellClasses('type-body text-ink')}>
              {link.placement ? (
                <>
                  {link.placement.text.slice(0, link.placement.anchor_start)}
                  <mark className="bg-accent-soft text-accent-text rounded-mark px-0.5">
                    {link.anchor}
                  </mark>
                  {link.placement.text.slice(link.placement.anchor_start + link.anchor.length)}
                </>
              ) : (
                link.anchor
              )}
            </p>
          </Stack>
          <Stack gap="item">
            <Inline className="flex-wrap">
              <CopyButton
                variant="primary"
                value={`<a href="${escapeHtml(link.target.url)}">${escapeHtml(link.anchor)}</a>`}
              >
                Copy HTML
              </CopyButton>
              <CopyButton variant="secondary" value={link.anchor}>
                Copy anchor
              </CopyButton>
              <CopyButton variant="secondary" value={link.target.url}>
                Copy URL
              </CopyButton>
            </Inline>
            <Inline className="flex-wrap">
              <Button asChild variant="quiet">
                <ProjectLink href={`/site/crawls/${crawlId}/pages/${link.source.site_url_id}`}>
                  <Icon icon={FileSearch} />
                  Source page evidence
                </ProjectLink>
              </Button>
              {link.action_id ? (
                <ActionButton action="openAction" href={`/actions/${link.action_id}`} />
              ) : null}
            </Inline>
          </Stack>
          <LinkDeclaration
            key={`${link.source.analysis_id}:${links.map((item) => item.id).join(',')}`}
            link={link}
            links={links}
            workspaceId={workspaceId}
            stale={stale}
          />
        </Stack>
      ) : null}
    </Drawer>
  );
}

function LinkDeclaration({
  link,
  links,
  workspaceId,
  stale,
}: Readonly<{
  link: InternalLink;
  links: InternalLink[];
  workspaceId: string;
  stale: boolean;
}>) {
  const canWrite = useWorkspaceCapability('write');
  const [selected, setSelected] = useState<string[]>([]);
  if (
    !canWrite ||
    !link.action_id ||
    stale ||
    !['open', 'in_progress'].includes(link.action_status ?? '')
  )
    return null;
  const related = links.filter((item) => item.source.site_url_id === link.source.site_url_id);
  const selectedIds = new Set(selected);
  return (
    <Stack as="section">
      <EditorialSectionHeader title="Which links are live on this page?" />
      {related.map((item) => (
        <Checkbox
          key={item.id}
          checked={selectedIds.has(item.id)}
          onCheckedChange={(checked) =>
            setSelected((ids) =>
              checked === true ? [...ids, item.id] : ids.filter((id) => id !== item.id),
            )
          }
          label={`${item.anchor} → ${item.target.title || item.target.url}`}
        />
      ))}
      <MarkActionImplemented
        workspaceId={workspaceId}
        actionId={link.action_id}
        revision={null}
        recommendationIds={selected}
        disabled={!selected.length}
      />
    </Stack>
  );
}
