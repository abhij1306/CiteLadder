import { Tag } from '@/components/ui/tag';
import { BrandMark } from '@/components/ui/brand-mark';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { DisplayTime } from '@/components/ui/display-time';
import { Icon } from '@/components/ui/icon';
import { Inline, Stack } from '@/components/ui/layout';
import { ClampText } from '@/components/ui/clamp-text';
import { TableCell, TableRow, TableRowHeader } from '@/components/ui/table';
import { TextLink } from '@/components/ui/text-link';
import { MetaFooter, SubsectionHeader } from '@/components/ui/workspace';
import { LedgerItem, LedgerList } from '@/components/ui/ledger-list';
import type { SearchSurfaceEvidence, SurfaceEntity } from '@citeladder/contracts';
import { Check, Link2, Minus, Users } from '@/lib/icons';
import { cn } from '@/lib/utils';
import { pluralCount } from '@/lib/format';
import { StateBlock } from '@/components/ui/state-block';
import { wellClasses } from '@/components/ui/slip';
import { FigureStrip } from '@/components/ui/figure-strip';
import { useEngineCatalog } from '@/lib/providers/engines';

function presenceLabel(evidence: SearchSurfaceEvidence): string {
  if (evidence.aio_present === true) return 'Shown';
  if (evidence.aio_present === false) return 'Not shown';
  return 'Not observed';
}

function SignalCell({ present, label }: Readonly<{ present: boolean; label: string }>) {
  return (
    <TableCell>
      <Inline
        as="span"
        className={cn('type-body inline-flex', present ? 'text-positive' : 'text-ink-2')}
      >
        <Icon icon={present ? Check : Minus} />
        <span className="sr-only">{label}: </span>
        {present ? 'Yes' : 'No'}
      </Inline>
    </TableCell>
  );
}

function EntityRow({ entity }: Readonly<{ entity: SurfaceEntity }>) {
  return (
    <TableRow>
      <TableRowHeader>
        <Inline as="span">
          <BrandMark name={entity.name} logoUrl={entity.logo_url} websiteUrl={entity.website_url} />
          <ClampText>{entity.name}</ClampText>
          {entity.kind === 'brand' ? <Tag>Your brand</Tag> : null}
        </Inline>
      </TableRowHeader>
      <SignalCell present={entity.mentioned} label="Named in the answer" />
      <SignalCell present={entity.linked} label="Linked from the answer" />
      <SignalCell present={entity.cited} label="Cited in the references" />
      <TableCell numeric>
        {entity.mention_order === null ? (
          <span className="text-ink-2">Not named</span>
        ) : (
          `#${entity.mention_order}`
        )}
      </TableCell>
    </TableRow>
  );
}

const PRESENCE_COLUMNS: readonly DataTableColumn[] = [
  { key: 'brand', label: 'Brand' },
  { key: 'named', label: 'Named', width: 'figure' },
  { key: 'linked', label: 'Linked', width: 'figure' },
  { key: 'cited', label: 'Cited', width: 'figure' },
  { key: 'order', label: 'Mention order', width: 'status', kind: 'number' },
];

function PresenceTable({ entities }: Readonly<{ entities: readonly SurfaceEntity[] }>) {
  return (
    <DataTable
      label="Who appeared, and how"
      columns={PRESENCE_COLUMNS}
      state={
        entities.length === 0
          ? {
              kind: 'empty',
              headingLevel: 3,
              icon: Users,
              heading: 'No brand presence recorded for this response',
            }
          : undefined
      }
    >
      {entities.map((entity) => (
        <EntityRow key={`${entity.kind}-${entity.name}`} entity={entity} />
      ))}
    </DataTable>
  );
}

function safeLinkUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function InlineLinks({ links }: Readonly<{ links: SearchSurfaceEvidence['links'] }>) {
  return (
    <Stack as="section" gap="compact">
      <SubsectionHeader
        title="Inline links"
        trailing={<span className="type-caption">{pluralCount(links.length, 'link')}</span>}
      />
      {links.length === 0 ? (
        <StateBlock
          kind="empty"
          headingLevel={3}
          icon={Link2}
          heading="The overview’s text carried no inline links"
        />
      ) : (
        <LedgerList label="Inline links">
          {links.map((link) => {
            const href = safeLinkUrl(link.url);
            const title = link.title || link.domain || link.url;
            return (
              <LedgerItem
                key={`${link.element_index}-${link.url}`}
                title={
                  href ? (
                    <TextLink variant="external" text="body" href={href}>
                      {title}
                    </TextLink>
                  ) : (
                    title
                  )
                }
                caption={link.domain}
              />
            );
          })}
        </LedgerList>
      )}
    </Stack>
  );
}

function SurfaceFooter({ evidence }: Readonly<{ evidence: SearchSurfaceEvidence }>) {
  return (
    <MetaFooter>
      <span>
        Captured <DisplayTime value={evidence.observed_at} fallback="Not recorded" />
      </span>
      <span>
        Retrieved <DisplayTime value={evidence.retrieved_at} fallback="Not recorded" />
      </span>
      <span>Location {evidence.location_code}</span>
      <span>{evidence.language_code}</span>
      <span>{evidence.device}</span>
    </MetaFooter>
  );
}

export function SurfaceEvidence({
  evidence,
  engine,
}: Readonly<{ evidence: SearchSurfaceEvidence; engine: string }>) {
  const label = useEngineCatalog().label(engine);
  const shown = evidence.aio_present === true;
  return (
    <Stack as="section" gap="workspace" className="min-w-0">
      <SubsectionHeader title={`${label} details`} />
      <FigureStrip
        segments={[
          { key: 'overview', label: 'Overview', value: presenceLabel(evidence) },
          {
            key: 'position',
            label: 'Block position',
            value:
              evidence.aio_serp_position === null
                ? 'Not recorded'
                : `#${evidence.aio_serp_position}`,
          },
          { key: 'elements', label: 'Elements', value: evidence.element_count },
          { key: 'references', label: 'References', value: evidence.reference_count },
        ]}
      />
      {shown ? (
        <>
          <Stack as="section" gap="compact">
            <SubsectionHeader title="Who appeared, and how" />
            <PresenceTable entities={evidence.entities} />
          </Stack>
          <InlineLinks links={evidence.links} />
        </>
      ) : (
        <div className={wellClasses('type-body text-ink-2 min-w-0')}>
          {evidence.aio_present === false
            ? `No ${label} appeared.`
            : 'Search not retrieved: a measurement gap, not brand absence.'}
        </div>
      )}
      <SurfaceFooter evidence={evidence} />
    </Stack>
  );
}
