import { BrandMark } from '@/components/ui/brand-mark';
import { ExternalHttpLink } from '@/components/ui/external-http-link';
import { cn } from '@/lib/utils';

/**
 * Citation — the pill for one source an AI answer cited: footnote number,
 * favicon, domain and page title. 28px, `radius-sm` (the footnote number
 * alone is a count pill), `surface` with the xs
 * ring; the tracked brand's own pages (`own`) turn `accent-soft` with a Flare
 * number. The title truncates; the full URL belongs in the detail view.
 */
export function Citation({
  domain,
  index,
  title,
  favicon,
  href,
  own = false,
}: Readonly<{
  domain: string;
  /** The footnote number in the answer. */
  index?: number;
  title?: string;
  favicon?: string | null;
  href?: string | null;
  own?: boolean;
}>) {
  const host = domain.replace(/^www\./, '');
  const content = (
    <>
      {index === undefined ? null : (
        <span
          className={cn(
            'inline-grid h-5 min-w-5 place-items-center rounded-full px-1 font-mono text-eyebrow font-normal tracking-normal',
            own ? 'bg-surface text-accent-ink' : 'bg-surface-sunken text-ink-secondary',
          )}
        >
          {index}
        </span>
      )}
      <BrandMark name={host} logoUrl={favicon} websiteUrl={`https://${host}`} placement="inline" />
      <span className="whitespace-nowrap">{host}</span>
      {title ? <span className="text-ink-muted min-w-0 truncate">{title}</span> : null}
    </>
  );
  const classes = cn(
    'text-ink border-line border inline-flex h-[var(--control-sm)] max-w-full items-center gap-1 rounded-sm ps-1 pe-3 align-middle text-body-sm no-underline',
    own ? 'bg-accent-soft' : 'bg-surface',
    index === undefined && 'ps-2',
  );
  return href ? (
    <ExternalHttpLink href={href} className={cn(classes, 'focus-ring hover:overlay-hover')}>
      {content}
    </ExternalHttpLink>
  ) : (
    <span className={classes}>{content}</span>
  );
}
