'use client';

import { Check, Link2, Minus, Users } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { DisplayTime } from '@/components/ui/display-time';
import { Icon } from '@/components/ui/icon';
import { Inline, Stack } from '@/components/ui/layout';
import { panelClasses } from '@/components/ui/panel';
import { QueryState } from '@/components/ui/query-state';
import { StatRow } from '@/components/ui/stat-row';
import { ClampText, TableCell, TableRow, TableRowHeader } from '@/components/ui/table';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import {
  ledgerClasses,
  ledgerItemClasses,
  MetaFooter,
  SubsectionHeader,
} from '@/components/ui/workspace';
import type { SearchSurfaceEvidence, SurfaceEntity } from '@/lib/api/types';
import { cn } from '@/lib/utils';

/**
 * What one Google AI Overview actually showed.
 *
 * The presence table is the point of this panel. Mentioned, linked and cited
 * are three INDEPENDENT observations — the answer text named you, an inline
 * link pointed at you, a root reference cited you — and they come apart in
 * both directions. A brand can be linked without being cited and cited
 * without being named. Collapsing them into one "appeared" column would
 * delete the finding a reader came here for, so each has its own column and
 * none is derived from another.
 */

/** Three states, because the surface has three, and only one is a finding. */
function presenceCaption(evidence: SearchSurfaceEvidence): string {
  if (evidence.aio_present === true) return 'Google showed an AI Overview for this search.';
  if (evidence.aio_present === false) return 'Google showed no AI Overview for this search.';
  return 'This search was never successfully retrieved, so nothing was observed.';
}

/** The same tri-state as `presenceCaption`, as a stat value rather than prose. */
function presenceLabel(evidence: SearchSurfaceEvidence): string {
  if (evidence.aio_present === true) return 'Shown';
  if (evidence.aio_present === false) return 'Not shown';
  return 'Not observed';
}

/** One yes/no cell. Never colour alone: the icon carries a text label too. */
function SignalCell({ present, label }: Readonly<{ present: boolean; label: string }>) {
  return (
    <TableCell>
      <Inline
        as="span"
        className={cn('type-body inline-flex', present ? 'text-success-text' : 'text-muted')}
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
          <ClampText>{entity.name}</ClampText>
          {entity.kind === 'brand' ? <Badge variant="neutral">Your brand</Badge> : null}
        </Inline>
      </TableRowHeader>
      <SignalCell present={entity.mentioned} label="Named in the answer" />
      <SignalCell present={entity.linked} label="Linked from the answer" />
      <SignalCell present={entity.cited} label="Cited in the references" />
      <TableCell numeric>
        {/* Null is "never named", which is not last place, so it says so
            rather than taking a number one position behind everyone else. */}
        {entity.mention_order === null ? (
          <span className="text-muted">Not named</span>
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
  { key: 'order', label: 'Mention order', width: 'status', numeric: true },
];

function PresenceTable({ entities }: Readonly<{ entities: readonly SurfaceEntity[] }>) {
  return (
    <DataTable
      label="Who appeared, and how"
      columns={PRESENCE_COLUMNS}
      minWidth="sm"
      state={
        entities.length === 0
          ? {
              kind: 'empty',
              headingLevel: 3,
              icon: Users,
              heading: 'No tracked brands were configured for this run.',
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
        trailing={
          <span className="type-caption">
            {links.length} {links.length === 1 ? 'link' : 'links'}
          </span>
        }
        description={
          <>
            Links inside the overview&rsquo;s own text. Separate from its references, which are
            listed as citations.
          </>
        }
      />
      {links.length === 0 ? (
        <QueryState
          kind="empty"
          headingLevel={3}
          icon={Link2}
          heading="The overview’s text carried no inline links."
        />
      ) : (
        <ul className={ledgerClasses('boxed')}>
          {links.map((link) => {
            const href = safeLinkUrl(link.url);
            const title = link.title || link.domain || link.url;
            return (
              // An overview can point at the same URL from two places in its
              // own text, so the URL alone is not unique among siblings. The
              // element it was drawn from is what separates them.
              <Stack
                as="li"
                gap="tight"
                key={`${link.element_index}-${link.url}`}
                className={ledgerItemClasses()}
              >
                {href ? (
                  <TextLink variant="external" text="itemTitle" href={href} className="max-w-full">
                    <span className="truncate">{title}</span>
                  </TextLink>
                ) : (
                  <p className={textRole('itemTitle', 'truncate')}>{title}</p>
                )}
                <p className="type-caption truncate">{link.domain}</p>
              </Stack>
            );
          })}
        </ul>
      )}
    </Stack>
  );
}

/**
 * When Google captured the page, kept apart from when we collected it.
 *
 * The two differ by however long the task sat in the provider's queue, and a
 * reader comparing overviews across days needs the capture time, not ours.
 */
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

export function SurfaceEvidence({ evidence }: Readonly<{ evidence: SearchSurfaceEvidence }>) {
  const shown = evidence.aio_present === true;
  return (
    <Stack as="section" gap="workspace" className="min-w-0">
      <SubsectionHeader title="AI Overview details" description={presenceCaption(evidence)} />
      <StatRow
        segments={[
          { key: 'overview', label: 'Overview', value: presenceLabel(evidence) },
          {
            key: 'position',
            label: 'Block position',
            value:
              evidence.aio_serp_position === null
                ? 'Not recorded'
                : `#${evidence.aio_serp_position}`,
            sub: 'On the results page',
          },
          { key: 'elements', label: 'Elements', value: evidence.element_count },
          { key: 'references', label: 'References', value: evidence.reference_count },
        ]}
      />
      {shown ? (
        <>
          <Stack as="section" gap="compact">
            <SubsectionHeader
              title="Who appeared, and how"
              description="Three independent observations. A brand can be linked without being cited, and cited without being named."
            />
            <PresenceTable entities={evidence.entities} />
          </Stack>
          <InlineLinks links={evidence.links} />
        </>
      ) : (
        <div className={panelClasses({ tone: 'well' }, 'type-body min-w-0')}>
          {evidence.aio_present === false
            ? 'There was nothing to compose: no overview appeared, so no brand could appear in one.'
            : 'No presence can be reported for a search that was never retrieved. This is a gap in our measurement, not an absence of the brand.'}
        </div>
      )}
      <SurfaceFooter evidence={evidence} />
    </Stack>
  );
}
