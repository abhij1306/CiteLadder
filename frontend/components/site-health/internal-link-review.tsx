import type { InternalLink } from '@citeladder/contracts/site-health';
import { useState } from 'react';

import { ProjectLink } from '@/components/ui/project-link';
import { ActionButton } from '@/components/ui/actions';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

import { ClampText } from '@/components/ui/clamp-text';
import { CopyButton } from '@/components/ui/copy-button';
import { Drawer } from '@/components/ui/drawer';
import { Icon } from '@/components/ui/icon';
import { Inline, Stack } from '@/components/ui/layout';
import { TextLink } from '@/components/ui/text-link';
import { EditorialSectionHeader } from '@/components/ui/workspace';
import { MarkActionImplemented } from '@/components/agent/action-declaration';
import { FileSearch } from '@/lib/icons';
import { formatCount, readableUrl } from '@/lib/format';
import { useWorkspaceCapability } from '@/lib/project/project-context';

const escapeHtml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

function PageSummary({
  heading,
  page,
}: Readonly<{ heading: string; page: InternalLink['source'] }>) {
  return (
    <Stack as="section" className="justify-items-start">
      <EditorialSectionHeader title={heading} />
      <TextLink variant="external" text="body" className="block max-w-full min-w-0" href={page.url}>
        <ClampText tooltip={page.url}>{page.title || readableUrl(page.url)}</ClampText>
      </TextLink>
      {page.description || page.excerpt ? (
        <p className="type-body text-ink-2">{page.description || page.excerpt}</p>
      ) : null}
    </Stack>
  );
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
          <PageSummary heading="Source page" page={link.source} />
          <Stack as="section">
            <EditorialSectionHeader title="Source passage" />
            {link.placement ? (
              <p className="type-body text-ink">
                {link.placement.text.slice(0, link.placement.anchor_start)}
                <mark>{link.anchor}</mark>
                {link.placement.text.slice(link.placement.anchor_start + link.anchor.length)}
              </p>
            ) : (
              <p className="type-caption">No captured placement.</p>
            )}
          </Stack>
          <PageSummary heading="Add a link to" page={link.target} />
          <Stack as="section">
            {link.placement ? null : (
              <>
                <EditorialSectionHeader title="Suggested anchor text" />
                <p className="type-body text-ink">{link.anchor}</p>
              </>
            )}
            <p className="type-caption">
              {link.target.contextual_inbound === null
                ? 'Contextual inbound links not counted'
                : `${formatCount(link.target.contextual_inbound)} contextual inbound links`}
            </p>
          </Stack>
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
            <Button asChild variant="secondary">
              <ProjectLink href={`/site/crawls/${crawlId}/pages/${link.source.site_url_id}`}>
                <Icon icon={FileSearch} />
                View source page evidence
              </ProjectLink>
            </Button>
            {link.action_id ? (
              <ActionButton action="openAction" href={`/actions/${link.action_id}`} />
            ) : null}
          </Inline>
          <p className="type-caption">Copying does not mark it implemented.</p>
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
