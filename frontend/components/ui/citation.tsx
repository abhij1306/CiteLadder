import { BrandMark } from '@/components/ui/brand-mark';
import { ExternalHttpLink } from '@/components/ui/external-http-link';
import { cn } from '@/lib/utils';

export function Citation({
  domain,
  index,
  title,
  favicon,
  href,
  own = false,
}: Readonly<{
  domain: string;
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
            'inline-grid min-h-5 min-w-5 place-items-center rounded-full px-1 text-eyebrow tabular-nums font-normal tracking-normal',
            'bg-surface',
            own ? 'text-accent-ink' : 'text-ink-secondary',
          )}
        >
          {index}
        </span>
      )}
      {favicon ? (
        <BrandMark
          name={host}
          logoUrl={favicon}
          websiteUrl={`https://${host}`}
          placement="inline"
          entity="site"
        />
      ) : null}
      <span className="whitespace-nowrap">{host}</span>
      {title ? <span className="text-ink-muted min-w-0 truncate">{title}</span> : null}
    </>
  );
  const classes = cn(
    'text-ink inline-flex min-h-[var(--control-sm)] max-w-full items-center gap-1 rounded-sm ps-1 pe-3 align-middle text-body-sm no-underline',
    own ? 'bg-accent-soft' : 'bg-state-selected',
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
