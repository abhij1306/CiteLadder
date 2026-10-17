import type { InternalLink } from '@citeladder/contracts/site-health';
import { useState } from 'react';

import { ProjectLink } from '@/components/layout/scoped-link';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CopyButton } from '@/components/ui/copy-button';
import { Drawer } from '@/components/ui/drawer';
import { Stack } from '@/components/ui/layout';
import { TextLink } from '@/components/ui/text-link';
import { EditorialSectionHeader } from '@/components/ui/workspace';
import { MarkActionImplemented } from '@/components/agent/action-declaration';
import { formatCount } from '@/lib/format';
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
      <TextLink variant="external" text="body" className="break-all" href={page.url}>
        {page.title || page.url}
      </TextLink>
      {page.description || page.excerpt ? (
        <p className="type-body">{page.description || page.excerpt}</p>
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
      description="Add a contextual link from the source page to the destination."
    >
      {link ? (
        <Stack gap="section">
          <PageSummary heading="Source page" page={link.source} />
          <Stack as="section">
            <EditorialSectionHeader title="Source passage" />
            {link.placement ? (
              <p className="type-body">
                {link.placement.text.slice(0, link.placement.anchor_start)}
                <mark>{link.anchor}</mark>
                {link.placement.text.slice(link.placement.anchor_start + link.anchor.length)}
              </p>
            ) : (
              <p className="type-caption">
                This saved suggestion has no captured placement. Run a new analysis to check it.
              </p>
            )}
          </Stack>
          <PageSummary heading="Add a link to" page={link.target} />
          <Stack as="section">
            <EditorialSectionHeader title="Suggested anchor text" />
            <p className="type-body">{link.anchor}</p>
            <p className="type-caption">
              {link.target.contextual_inbound === null
                ? 'Existing contextual links to the destination were not measured.'
                : `The destination currently has ${formatCount(link.target.contextual_inbound)} contextual links from other pages.`}{' '}
              {link.placement
                ? 'Link the highlighted phrase in the captured passage. Check the current page before editing.'
                : 'Verify the source text before using this historical suggestion.'}
            </p>
          </Stack>
          <div className="flex flex-wrap gap-2">
            <CopyButton value={link.anchor}>Copy anchor</CopyButton>
            <CopyButton value={link.target.url}>Copy URL</CopyButton>
            <CopyButton
              value={`<a href="${escapeHtml(link.target.url)}">${escapeHtml(link.anchor)}</a>`}
            >
              Copy HTML
            </CopyButton>
            <Button asChild variant="secondary" size="sm">
              <ProjectLink href={`/site/crawls/${crawlId}/pages/${link.source.site_url_id}`}>
                View source page evidence
              </ProjectLink>
            </Button>
            {link.action_id ? (
              <Button asChild variant="secondary" size="sm">
                <ProjectLink href={`/agent/actions/${link.action_id}`}>Open Action</ProjectLink>
              </Button>
            ) : null}
          </div>
          <p className="type-caption">
            Make the edit in your site editor. Copying does not mark it implemented.
          </p>
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
      <EditorialSectionHeader
        title="Which links are live on this page?"
        description="Select every link you have added before declaring this page Action."
      />
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
        selectionDescription="Declare that the selected internal links are live on this source page."
      />
    </Stack>
  );
}
