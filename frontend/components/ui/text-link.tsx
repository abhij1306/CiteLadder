import type { ComponentPropsWithRef, ReactNode } from 'react';
import { Slot, Slottable } from '@radix-ui/react-slot';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { ProjectLink } from '@/components/layout/scoped-link';
import { ExternalHttpLink } from '@/components/ui/external-http-link';
import { textRole, type TextRole } from '@/components/ui/typography';
import { parseAbsoluteHttpUrl } from '@/lib/safe-http-url';
import { cn } from '@/lib/utils';

/**
 * TextLink — the one text link.
 *
 * Accent ink (links are actions), underline on hover, the shared focus ring,
 * and the text role the link sits at (`control` by default; `inherit` inside a
 * sentence).
 *
 *   - `internal` — an app route, scoped to the active project (or `projectId`)
 *     through `ProjectLink`.
 *   - `external` — an API-supplied http(s) URL: new tab, `noopener
 *     noreferrer`, a trailing external glyph and "(opens in a new tab)" for
 *     assistive tech. An unsafe or missing URL renders as plain text at the
 *     text role: no link ink, glyph or new-tab note.
 *   - `back` — the detail route's way up, scoped like `internal`: an arrow
 *     glyph and the label ("Back to runs"); never a typed "←".
 *
 * `asChild` keeps the recipe (and glyphs) on a foreign link element the
 * caller must own.
 */
export type TextLinkVariant = 'internal' | 'external' | 'back';
export type TextLinkText = TextRole | 'inherit';

function textLinkClasses({
  variant,
  text,
}: Readonly<{ variant: TextLinkVariant; text: TextLinkText }>) {
  const recipe = cn(
    'focus-ring text-accent-text rounded-xs underline-offset-2 hover:underline',
    variant !== 'internal' && 'inline-flex items-center gap-1',
  );
  return text === 'inherit' ? recipe : textRole(text, recipe);
}

/**
 * Where the link goes. Each variant takes only the props it reads: a project
 * scope means nothing to an external URL, and under `asChild` the child link
 * owns its destination, so an `href` there would be silently dropped.
 */
type TextLinkTarget =
  | {
      variant?: 'internal' | 'back';
      /** An app route. */
      href?: string | null;
      /** The project the route belongs to, when not the active one. */
      projectId?: string | null;
      asChild?: false;
    }
  | {
      variant: 'external';
      /** An http(s) URL. */
      href?: string | null;
      projectId?: never;
      asChild?: false;
    }
  | {
      variant?: TextLinkVariant;
      href?: never;
      projectId?: never;
      /** Apply the recipe (and glyphs) to the single child link instead. */
      asChild: true;
    };

type TextLinkProps = Readonly<
  Omit<ComponentPropsWithRef<'a'>, 'href'> &
    TextLinkTarget & {
      text?: TextLinkText;
      children: ReactNode;
    }
>;

/**
 * The link's content with its glyphs, as a flat list of nodes — not wrapped in
 * a component or fragment — so that under `asChild` the Radix `Slot` sees the
 * `Slottable` among its direct children and merges the recipe onto the
 * caller's link while keeping the glyphs inside it.
 */
function withGlyphs(variant: TextLinkVariant, children: ReactNode): ReactNode[] {
  const label = <Slottable key="label">{children}</Slottable>;
  if (variant === 'back') {
    return [<ArrowLeft key="glyph" className="size-3.5 shrink-0" aria-hidden />, label];
  }
  if (variant === 'external') {
    return [
      label,
      <ExternalLink key="glyph" className="size-3.5 shrink-0" aria-hidden />,
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
  text = 'control',
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
        className={text === 'inherit' ? className : textRole(text, className)}
        title={props.title}
      >
        {children}
      </span>
    );
  }
  const classes = cn(textLinkClasses({ variant, text }), className);
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
