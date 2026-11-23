import type { ComponentPropsWithRef, ReactNode } from 'react';
import { Slot, Slottable } from '@radix-ui/react-slot';
import { ProjectLink } from '@/components/ui/project-link';
import { ExternalHttpLink } from '@/components/ui/external-http-link';
import { textRole, type TextRole } from '@/components/ui/typography';
import { ArrowRight, ArrowUpRight } from '@/lib/icons';
import { parseAbsoluteHttpUrl } from '@/lib/safe-http-url';
import { cn } from '@/lib/utils';

/**
 * TextLink — the text link, with the 2px focus ring.
 *
 * Where it stands decides its underline (decision D13). A link set at a type
 * role stands on its own in a list, table, row or card (an item title, a
 * URL, "Ask agent about this page"): its place says it is a link, so it is
 * underlined only on hover and keyboard focus. A link inside a sentence
 * (`text="inherit"`) is underlined at rest, so it never depends on colour
 * alone.
 *
 *   tone `ink` (default, the app): `ink`; in a sentence a `line-control`
 *     underline that turns `ink` on hover.
 *   tone `prose` (long reading copy): `accent-ink` with a solid
 *     underline that thickens on hover.
 *   tone `muted` (footers, metadata): `ink-secondary`, underlined on hover.
 *
 *   variant `internal` — an app route, scoped to the active project (or
 *     `projectId`) through `ProjectLink`.
 *   variant `external` — an API-supplied http(s) URL: a new tab, `noopener
 *     noreferrer`, a 14px `arrow-up-right` and "(opens in a new tab)" for
 *     assistive tech. An unsafe or missing URL renders as plain text.
 *
 * `text` is the type role the link sits at (`control` by default; `inherit`
 * only inside a sentence: a link in a list or table cell takes the role of
 * its text). `asChild` keeps the recipe on a link the caller owns.
 */
type TextLinkVariant = 'internal' | 'external';
export type TextLinkText = TextRole | 'inherit';
export type TextLinkTone = 'ink' | 'prose' | 'muted';

const TONE: Record<TextLinkTone, string> = {
  ink: 'text-ink',
  prose: 'text-accent-text',
  muted: 'text-ink-2 hover:text-ink',
};

const APP_REST =
  '[:root:not([data-public-surface])_&]:hover:decoration-current [:root:not([data-public-surface])_&]:focus-visible:decoration-current';

const UNDERLINE = {
  prose: cn('decoration-current hover:decoration-2', APP_REST),
  ink: cn(
    'decoration-control-line hover:decoration-current focus-visible:decoration-current',
    APP_REST,
  ),
  hover:
    'text-ink decoration-transparent hover:decoration-current focus-visible:decoration-current',
} as const;

export type TextLinkUnderline = 'always' | 'hover';

function lineClasses(tone: TextLinkTone, underline: TextLinkUnderline) {
  if (underline === 'hover') return UNDERLINE.hover;
  return cn(TONE[tone], tone === 'prose' ? UNDERLINE.prose : UNDERLINE.ink);
}

function textLinkClasses({
  tone,
  text,
  underline,
}: Readonly<{ tone: TextLinkTone; text: TextLinkText; underline: TextLinkUnderline }>) {
  const recipe = cn(
    'focus-ring rounded-mark underline decoration-1 underline-offset-3 transition-[color,text-decoration-color]',
    lineClasses(tone, underline),
  );
  return text === 'inherit' ? recipe : textRole(text, recipe);
}

type TextLinkTarget =
  | {
      variant?: 'internal';
      href?: string | null;
      projectId?: string | null;
      asChild?: false;
    }
  | {
      variant: 'external';
      href?: string | null;
      projectId?: never;
      asChild?: false;
    }
  | {
      variant?: TextLinkVariant;
      href?: never;
      projectId?: never;
      asChild: true;
    };

type TextLinkProps = Readonly<
  Omit<ComponentPropsWithRef<'a'>, 'href'> &
    TextLinkTarget & {
      tone?: TextLinkTone;
      text?: TextLinkText;
      underline?: TextLinkUnderline;
      children: ReactNode;
    }
>;

function withGlyphs(variant: TextLinkVariant, children: ReactNode): ReactNode[] {
  const label = <Slottable key="label">{children}</Slottable>;
  if (variant === 'external') {
    const glyph = (
      <ArrowUpRight
        key="glyph"
        className="ms-0.5 inline size-3.5 align-[-2px] [:root:not([data-public-surface])_&]:ms-2"
        aria-hidden
      />
    );
    const split = typeof children === 'string' ? /^(.*\s)?(\S+)\s*$/su.exec(children) : null;
    return [
      ...(split
        ? [
            split[1] ?? '',
            <span key="tail" className="whitespace-nowrap">
              {split[2]}
              {glyph}
            </span>,
          ]
        : [label, glyph]),
      ' ',
      <span key="note" className="sr-only">
        (opens in a new tab)
      </span>,
    ];
  }
  return [label];
}

export function TextLink({
  variant = 'internal',
  tone = 'ink',
  text = 'body',
  underline = 'always',
  href,
  projectId,
  asChild = false,
  className,
  children,
  ...props
}: TextLinkProps) {
  if (variant === 'external' && !asChild && !parseAbsoluteHttpUrl(href)) {
    return (
      <span
        className={cn(text === 'inherit' ? className : textRole(text, className), 'no-underline')}
        title={props.title}
      >
        {children}
      </span>
    );
  }
  const classes = cn(textLinkClasses({ tone, text, underline }), className);
  const content = withGlyphs(variant, children);
  if (asChild) {
    return (
      <Slot {...props} className={classes}>
        {content}
      </Slot>
    );
  }
  if (variant === 'external') {
    return (
      <ExternalHttpLink {...props} href={href} className={classes}>
        {content}
      </ExternalHttpLink>
    );
  }
  return (
    <ProjectLink {...props} href={href ?? ''} projectId={projectId} className={classes}>
      {content}
    </ProjectLink>
  );
}

export function ArrowLink({
  href,
  projectId,
  children,
}: Readonly<{ href?: string; projectId?: string | null; children: ReactNode }>) {
  const content = (
    <>
      <span className="decoration-control-line underline decoration-1 underline-offset-4 transition-[text-decoration-color] [@media(hover:hover)_and_(pointer:fine)]:group-hover:decoration-current">
        {children}
      </span>
      <ArrowRight
        aria-hidden
        className="size-3.5 shrink-0 transition-transform motion-reduce:transition-none motion-safe:[@media(hover:hover)_and_(pointer:fine)]:group-hover:translate-x-0.5"
      />
    </>
  );
  const classes = 'text-ink inline-flex items-center gap-2 rounded-mark text-label-lg no-underline';
  if (!href) return <span className={classes}>{content}</span>;
  return (
    <ProjectLink href={href} projectId={projectId} className={cn(classes, 'group focus-ring')}>
      {content}
    </ProjectLink>
  );
}
