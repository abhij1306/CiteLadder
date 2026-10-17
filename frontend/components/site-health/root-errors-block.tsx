'use client';

import { UnavailableValue } from '@/components/ui/unavailable-value';
import type { RootError } from '@/lib/api/types';
import { textRole } from '@/components/ui/typography';
import { ledgerClasses } from '@/components/ui/workspace';

/**
 * Root-failure block for the Errors & Blocked tab.
 *
 * When the crawl's START URL itself failed, no page row exists to list — the
 * failure's only evidence is the terminal root-target fetch attempts the
 * worker persisted, one per REAL network call. These rows are deliberately
 * NON-clickable and carry no `site_url_id`: the URL was never admitted into
 * the inventory, so there is no PageDetail behind them.
 */
export function RootErrorsBlock({ errors }: Readonly<{ errors: RootError[] }>) {
  if (errors.length === 0) return null;
  const keyOccurrences = new Map<string, number>();
  return (
    <div className="grid gap-2" data-testid="root-errors-block">
      <p className={textRole('body')}>
        The start URL could not be fetched — the crawl never reached any page. Each row is one
        network call the crawler made.
      </p>
      <ul className={ledgerClasses('open')}>
        {errors.map((error) => {
          const signature = JSON.stringify([
            error.method,
            error.target,
            error.outcome,
            error.error_code,
            error.status_code,
            error.latency_ms,
          ]);
          const occurrence = keyOccurrences.get(signature) ?? 0;
          keyOccurrences.set(signature, occurrence + 1);
          return (
            <li
              key={`${signature}:${occurrence}`}
              data-testid="root-error-row"
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
            >
              <span className={textRole('itemTitle', 'tabular-nums')}>{error.method}</span>
              <span className="type-body min-w-0 flex-1 truncate tabular-nums">{error.target}</span>
              {error.error_code ? (
                <span className="type-body text-danger-text tabular-nums">{error.error_code}</span>
              ) : null}
              <span className="type-body tabular-nums">
                {error.status_code !== null ? (
                  `HTTP ${error.status_code}`
                ) : (
                  <UnavailableValue state="not_measured" />
                )}
              </span>
              <span className="type-body tabular-nums">
                {/* 0 ms is an unmeasured hop (DNS failure never reached the
                  wire), not an instant response — show the placeholder. */}
                {error.latency_ms !== null && error.latency_ms > 0 ? (
                  `${error.latency_ms} ms`
                ) : (
                  <UnavailableValue state="not_measured" />
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
