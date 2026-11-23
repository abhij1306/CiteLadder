import type { z } from 'zod';

import { Absence } from '@/components/ui/absence';
import { BrandMark } from '@/components/ui/brand-mark';
import { Button } from '@/components/ui/button';
import { ClampText } from '@/components/ui/clamp-text';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Inline } from '@/components/ui/layout';
import { ProjectLink } from '@/components/ui/project-link';
import { Skeleton } from '@/components/ui/skeleton';
import { TableCell, TableRow } from '@/components/ui/table';
import type { visibilitySourceUrlSchema } from '@citeladder/contracts/visibility-evidence';
import { urlTypeLabel } from '@citeladder/contracts/page-labels';
import { agentHandoffHref } from '@/lib/agent/handoff';
import { useActiveProject } from '@/lib/project/project-scope';
import {
  pageRows,
  presenceLabel,
  quoteParts,
  readableQuote,
  unreadReason,
  type PageEntity,
} from '@/lib/visibility/source-pages';
import { sinceLabel } from '@/lib/visibility/sources';

type Page = NonNullable<z.infer<typeof visibilitySourceUrlSchema>['page']>;
type Mark = { logoUrl: string | null; websiteUrl: string | null };

const COLUMNS: readonly DataTableColumn[] = [
  { key: 'brand', label: 'Brand', width: 'name' },
  { key: 'mentions', label: 'Mentions', width: 'figure', kind: 'number' },
  { key: 'quote', label: 'Quote' },
];

export function SourceUrlPageCard({
  url,
  page,
  loading,
}: Readonly<{ url: string; page: Page | null | undefined; loading: boolean }>) {
  const marks = useBrandMarks();
  if (loading) return <Skeleton variant="facts" />;
  if (page === undefined) return null;
  const standing = page?.standing ?? 'untracked';
  if (standing === 'competitor') return null;
  const rows = pageRows(page?.entities, Boolean(page?.read_at));
  return (
    <DataTable
      title="On this page"
      description={unreadReason(standing) ?? pageMeta(page)}
      actions={
        standing === 'gap' ? <GetListed url={url} actionId={page?.action_id ?? null} /> : null
      }
      label="Tracked brands on this page"
      columns={COLUMNS}
      state={
        rows.length
          ? undefined
          : { kind: 'empty', inline: true, message: 'No tracked brand on this page' }
      }
    >
      {rows.map((entity) => (
        <EntityRow
          key={`${entity.entity_kind}:${entity.entity_name}`}
          entity={entity}
          mark={marks(entity)}
        />
      ))}
    </DataTable>
  );
}

function pageMeta(page: Page | null): string | undefined {
  if (!page) return undefined;
  const type = page.page_format === 'unresolved' ? null : urlTypeLabel(page.page_format);
  const read = sinceLabel(page.read_at);
  const parts = [type, read ? `Read ${read.toLowerCase()}` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

function useBrandMarks() {
  const project = useActiveProject();
  return (entity: PageEntity): Mark => {
    if (!project) return { logoUrl: null, websiteUrl: null };
    if (entity.entity_kind === 'brand')
      return { logoUrl: project.brand.logo_url ?? null, websiteUrl: project.website_url || null };
    const rival = project.competitors.find(
      (competitor) => competitor.name.toLowerCase() === entity.entity_name.toLowerCase(),
    );
    const domain = rival?.domains[0];
    return { logoUrl: rival?.logo_url ?? null, websiteUrl: domain ? `https://${domain}` : null };
  };
}

function EntityRow({ entity, mark }: Readonly<{ entity: PageEntity; mark: Mark }>) {
  const present = entity.presence === 'present';
  const passage = entity.passages.find((text) => text.trim());
  return (
    <TableRow>
      <TableCell>
        <Inline as="span" gap="compact" className="min-w-0">
          <BrandMark
            name={entity.entity_name}
            logoUrl={mark.logoUrl}
            websiteUrl={mark.websiteUrl}
          />
          <span className="min-w-0 truncate">{entity.entity_name}</span>
        </Inline>
      </TableCell>
      <TableCell numeric>
        {present || entity.presence === 'not_detected' ? (
          entity.match_count
        ) : (
          <Absence label={presenceLabel(entity.presence) ?? undefined} />
        )}
      </TableCell>
      <TableCell>
        {passage ? (
          <Quote text={readableQuote(passage)} name={entity.entity_name} />
        ) : (
          <Absence state="not_applicable" />
        )}
      </TableCell>
    </TableRow>
  );
}

function Quote({ text, name }: Readonly<{ text: string; name: string }>) {
  const { before, match, after } = quoteParts(text, name);
  return (
    <ClampText lines={2} tooltip={text}>
      {before}
      {match ? <mark className="cl-mark">{match}</mark> : null}
      {after}
    </ClampText>
  );
}

function GetListed({ url, actionId }: Readonly<{ url: string; actionId: string | null }>) {
  if (actionId)
    return (
      <>
        <Button variant="secondary" asChild>
          <ProjectLink href={agentHandoffHref({ actionId })}>Draft the request</ProjectLink>
        </Button>
        <Button variant="primary" asChild>
          <ProjectLink href={`/actions/${actionId}`}>Open the Action</ProjectLink>
        </Button>
      </>
    );
  return (
    <Button variant="secondary" asChild>
      <ProjectLink
        href={agentHandoffHref({
          targetUrl: url,
          skillId: 'earned_authority',
          prompt: 'Draft a request to be listed on this page alongside the competitors on it.',
        })}
      >
        Draft a request to be listed
      </ProjectLink>
    </Button>
  );
}
