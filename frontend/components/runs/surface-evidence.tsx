'use client';

import { Check, Link2, Minus, Users } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { DisplayTime } from '@/components/ui/display-time';
import { EmptyState } from '@/components/ui/empty-state';
import { panelClasses } from '@/components/ui/panel';
import { StatGrid, StatItem } from '@/components/ui/stat-grid';
import {
  ClampText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TextLink } from '@/components/ui/text-link';
import { Label, textRole } from '@/components/ui/typography';
import { ledgerClasses } from '@/components/ui/workspace';
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
  const Icon = present ? Check : Minus;
  return (
    <TableCell>
      <span
        className={cn(
          'type-body inline-flex items-center gap-2',
          present ? 'text-success-text' : 'text-muted',
        )}
      >
        <Icon className="size-3.5 shrink-0" aria-hidden />
        <span className="sr-only">{label}: </span>
        {present ? 'Yes' : 'No'}
      </span>
    </TableCell>
  );
}

function EntityRow({ entity }: Readonly<{ entity: SurfaceEntity }>) {
  return (
    <TableRow>
      <th
        scope="row"
        className="border-border-subtle border-b px-[var(--table-cell-padding-x)] py-[var(--table-cell-padding-y)] text-left align-middle [tr:last-child>&]:border-b-0"
      >
        <span className="flex min-w-0 items-center gap-2">
          <ClampText className={textRole('itemTitle')}>{entity.name}</ClampText>
          {entity.kind === 'brand' ? <Badge variant="neutral">Your brand</Badge> : null}
        </span>
      </th>
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

function PresenceTable({ entities }: Readonly<{ entities: readonly SurfaceEntity[] }>) {
  if (entities.length === 0) {
    return (
      <EmptyState
        variant="compact"
        headingLevel={3}
        icon={Users}
        heading="No tracked brands were configured for this run."
      />
    );
  }
  return (
    <Table minWidth="sm">
      <TableHeader>
        <tr>
          <TableHead scope="col">Brand</TableHead>
          <TableHead scope="col">Named</TableHead>
          <TableHead scope="col">Linked</TableHead>
          <TableHead scope="col">Cited</TableHead>
          <TableHead scope="col" numeric>
            Mention order
          </TableHead>
        </tr>
      </TableHeader>
      <TableBody>
        {entities.map((entity) => (
          <EntityRow key={`${entity.kind}-${entity.name}`} entity={entity} />
        ))}
      </TableBody>
    </Table>
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
    <section className="grid gap-3">
      <div className="grid gap-0.5">
        <div className="flex items-center justify-between gap-2">
          <Label>Inline links</Label>
          <span className="type-caption">
            {links.length} {links.length === 1 ? 'link' : 'links'}
          </span>
        </div>
        <p className="type-caption">
          Links inside the overview&rsquo;s own text. Separate from its references, which are listed
          as citations.
        </p>
      </div>
      {links.length === 0 ? (
        <EmptyState
          variant="compact"
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
              <li key={`${link.element_index}-${link.url}`} className="grid gap-0.5 p-4">
                {href ? (
                  <TextLink variant="external" text="itemTitle" href={href} className="max-w-full">
                    <span className="truncate">{title}</span>
                  </TextLink>
                ) : (
                  <p className={textRole('itemTitle', 'truncate')}>{title}</p>
                )}
                <p className="type-caption truncate">{link.domain}</p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
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
    <footer className="type-caption border-border-subtle flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3">
      <span>
        Captured <DisplayTime value={evidence.observed_at} fallback="Not recorded" />
      </span>
      <span>
        Retrieved <DisplayTime value={evidence.retrieved_at} fallback="Not recorded" />
      </span>
      <span>Location {evidence.location_code}</span>
      <span>{evidence.language_code}</span>
      <span>{evidence.device}</span>
    </footer>
  );
}

export function SurfaceEvidence({ evidence }: Readonly<{ evidence: SearchSurfaceEvidence }>) {
  const shown = evidence.aio_present === true;
  return (
    <section className="grid min-w-0 gap-[var(--workspace-gap)]">
      <div className="grid gap-0.5">
        <Label>AI Overview details</Label>
        <p className="type-caption">{presenceCaption(evidence)}</p>
      </div>
      <StatGrid surface="well" columns={4}>
        <StatItem label="Overview" value={presenceLabel(evidence)} />
        <StatItem
          label="Block position"
          value={
            evidence.aio_serp_position === null ? 'Not recorded' : `#${evidence.aio_serp_position}`
          }
          detail="On the results page"
        />
        <StatItem label="Elements" value={evidence.element_count} />
        <StatItem label="References" value={evidence.reference_count} />
      </StatGrid>
      {shown ? (
        <>
          <section className="grid gap-3">
            <div className="grid gap-0.5">
              <Label>Who appeared, and how</Label>
              <p className="type-caption">
                Three independent observations. A brand can be linked without being cited, and cited
                without being named.
              </p>
            </div>
            <PresenceTable entities={evidence.entities} />
          </section>
          <InlineLinks links={evidence.links} />
        </>
      ) : (
        <div className={panelClasses({ tone: 'well', pad: 'compact' }, 'type-body min-w-0')}>
          {evidence.aio_present === false
            ? 'There was nothing to compose: no overview appeared, so no brand could appear in one.'
            : 'No presence can be reported for a search that was never retrieved. This is a gap in our measurement, not an absence of the brand.'}
        </div>
      )}
      <SurfaceFooter evidence={evidence} />
    </section>
  );
}
