import type { ReactNode } from 'react';
import { ProjectLink } from '@/components/layout/scoped-link';
import { Button } from '@/components/ui/button';
import { cardClasses } from '@/components/ui/card-variants';
import { ScoreRing } from '@/components/ui/score-ring';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import { hairlineBandClasses, hairlineBandItemClasses } from '@/components/ui/workspace';
import { textRole } from '@/components/ui/typography';
import { ICONS } from '@/lib/icons';
import { cn } from '@/lib/utils';

export type AuditMetric = {
  title: string;
  value: number | null;
  valueUnit?: 'score' | 'percent';
  caveat: string | null;
  href?: string;
  icon: typeof ICONS.site;
  unavailable?: ReactNode;
};

/** Overview geometry shared by crawl and page measurements. */
export function AuditMetricStrip({
  metrics,
  testId,
}: Readonly<{ metrics: AuditMetric[]; testId?: string }>) {
  return (
    <div
      data-testid={testId}
      className={cn(
        cardClasses(),
        // One hairline band inside the one box recipe: stacked below the
        // desktop breakpoint, one row on desktop.
        hairlineBandClasses,
        'overflow-hidden',
        metrics.length === 3 ? 'desktop:grid-cols-3' : 'desktop:grid-cols-4',
      )}
    >
      {metrics.map(
        ({ title, value, valueUnit = 'score', caveat, href, icon: Icon, unavailable }) => (
          <div
            key={title}
            className={cn(
              'grid grid-rows-[auto_1fr_auto] gap-2',
              hairlineBandItemClasses,
              'first:pt-0 last:pb-0 desktop:py-0',
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Icon aria-hidden className="text-muted size-4 shrink-0" />
                <p className={textRole('itemTitle')}>{title}</p>
              </div>
              <div className="flex min-h-12 min-w-12 shrink-0 items-center justify-center">
                {value === null ? (
                  (unavailable ?? <UnavailableValue state="not_measured" />)
                ) : (
                  <ScoreRing
                    value={value}
                    size={48}
                    strokeWidth={4}
                    label={
                      valueUnit === 'percent'
                        ? `${title}: ${Math.round(value)}%`
                        : `${title} score: ${Math.round(value)}`
                    }
                  />
                )}
              </div>
            </div>
            <div className="type-caption">{caveat === 'Not measured' ? null : caveat}</div>
            <div className="min-h-[var(--control-height-md)]">
              {href ? (
                <Button asChild variant="ghost" className="-ms-3">
                  <ProjectLink href={href}>View details</ProjectLink>
                </Button>
              ) : null}
            </div>
          </div>
        ),
      )}
    </div>
  );
}
