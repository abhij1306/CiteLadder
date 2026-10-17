'use client';

import type { Shelf } from '@citeladder/contracts/commerce-suite';

import { ActionStatusBadge } from '@/components/agent/action-status-badge';
import { ProjectLink } from '@/components/layout/scoped-link';
import { Badge } from '@/components/ui/badge';
import type { StatusValue } from '@/components/ui/badge-variants';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { textRole } from '@/components/ui/typography';
import { ledgerClasses } from '@/components/ui/workspace';
import { pluralCount } from '@/lib/format';

type Holder = Shelf['holders'][number];

const HOLDER_KIND: Record<Holder['kind'], { label: string; tone: StatusValue }> = {
  owned: { label: 'You', tone: 'success' },
  approved_competitor: { label: 'Competitor', tone: 'danger' },
  ai_observed_competitor: { label: 'Seen in AI answers', tone: 'info' },
};

/** "In 3 of 5 answers · best #2", from the folded recommendation counts. */
function holderReach(holder: Holder, answers: number): string {
  const reach = `In ${holder.appearances} of ${pluralCount(answers, 'answer')}`;
  return holder.best_rank === null ? reach : `${reach} · best #${holder.best_rank}`;
}

/**
 * Who AI answers recommended for this target in its latest measurement, and
 * the Actions that would change it.
 *
 * The numbers above say how the target did; this says who took the slots and
 * what to do about it, from exactly the answers those numbers were computed on.
 */
export function TargetShelfEvidence({ shelf }: Readonly<{ shelf: Shelf }>) {
  const { snapshot, holders, unresolved_count: unresolved, actions } = shelf;
  const answers = snapshot?.successful_execution_count ?? 0;
  return (
    <>
      {actions.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Actions for this target</CardTitle>
            <CardDescription>Open work that can raise its AI visibility.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className={ledgerClasses()}>
              {actions.map((action) => (
                <li key={action.id} className="flex flex-wrap items-center gap-3 py-2">
                  <ProjectLink
                    href={`/agent/actions/${action.id}`}
                    className={textRole('emphasis', 'text-link min-w-0 flex-1')}
                  >
                    {action.title}
                  </ProjectLink>
                  <ActionStatusBadge status={action.status} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
      {snapshot && answers ? (
        <Card>
          <CardHeader>
            <CardTitle>Who held the shelf</CardTitle>
            <CardDescription>
              What AI answers recommended for this target in the latest audit.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {holders.length ? (
              <ol className={ledgerClasses()}>
                {holders.map((holder) => (
                  <li
                    key={`${holder.kind}:${holder.name}:${holder.merchant_domain}`}
                    className="flex flex-wrap items-center gap-3 py-2"
                  >
                    <div className="grid min-w-0 flex-1 gap-0.5">
                      <span className={textRole('emphasis', 'truncate')}>{holder.name}</span>
                      <span className="type-caption truncate">
                        {[holder.brand, holder.merchant_domain, holderReach(holder, answers)]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </div>
                    <Badge variant="status" value={HOLDER_KIND[holder.kind].tone}>
                      {HOLDER_KIND[holder.kind].label}
                    </Badge>
                  </li>
                ))}
              </ol>
            ) : (
              <p className={textRole('body')}>
                No answer recommended you or an approved competitor.
              </p>
            )}
            {unresolved ? (
              <p className="type-caption">
                {pluralCount(unresolved, 'other recommendation')} named products outside your
                catalog and approved competitors. Approving competitors lets the next audit count
                them.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
