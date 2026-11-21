import { Inline, Stack } from '@/components/ui/layout';
import { Absence } from '@/components/ui/absence';
import { StatusMark } from '@/components/ui/status-mark';
import { ClampText } from '@/components/ui/clamp-text';
import { formatCount } from '@/lib/format';
import type { RootError } from '@citeladder/contracts';
import { textRole } from '@/components/ui/typography';
import { ledgerClasses, ledgerItemClasses } from '@/components/ui/workspace';

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
    <Stack gap="item" data-testid="root-errors-block">
      <p className={textRole('body', 'text-ink-2')}>The start URL could not be fetched.</p>
      <ul className={ledgerClasses()}>
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
            <Inline
              as="li"
              gap="meta"
              key={`${signature}:${occurrence}`}
              data-testid="root-error-row"
              className={ledgerItemClasses()}
            >
              <span className="type-code">{error.method}</span>
              <ClampText className="type-body text-ink-2 flex-1">{error.target}</ClampText>
              {error.error_code ? (
                <StatusMark tone="negative">{error.error_code}</StatusMark>
              ) : null}
              <span className="type-body text-ink-2 tabular-nums">
                {error.status_code !== null ? (
                  `HTTP ${error.status_code}`
                ) : (
                  <Absence state="not_measured" />
                )}
              </span>
              <span className="type-body text-ink-2 tabular-nums">
                {/* 0 ms is an unmeasured hop (DNS failure never reached the
                  wire), not an instant response — show the placeholder. */}
                {error.latency_ms !== null && error.latency_ms > 0 ? (
                  `${formatCount(error.latency_ms)} ms`
                ) : (
                  <Absence state="not_measured" />
                )}
              </span>
            </Inline>
          );
        })}
      </ul>
    </Stack>
  );
}
