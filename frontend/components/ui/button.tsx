import type { ComponentPropsWithRef, ComponentPropsWithoutRef, ReactNode, Ref } from 'react';
import type { LucideIcon } from 'lucide-react';

import { Slot } from '@radix-ui/react-slot';
import { Icon } from '@/components/ui/icon';
import { ProjectLink } from '@/components/ui/project-link';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip } from '@/components/ui/tooltip';

import { cn } from '@/lib/utils';

/**
 * The system's four buttons (Button README): `primary` is the one ink action a
 * view is for, `secondary` (surface with a control's soft edge: a 1px `line`
 * border and the `shadow-edge` smudge, like a field) everything else, `ghost`
 * toolbars, nav and rows, `danger` destructive confirmations. Buttons are
 * black, white or clear; never coloured. Hover, pressed and open are the
 * state overlays (D51), so a toggled or open button never looks hovered.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/** Hover, unless the button is toggled on or its menu is open. */
const HOVER_OVERLAY =
  'not-aria-pressed:not-data-[state=open]:not-disabled:hover:overlay-hover aria-pressed:overlay-pressed data-[state=open]:overlay-pressed';

const BUTTON_BASE =
  'focus-ring relative inline-flex h-[var(--control-md)] shrink-0 items-center justify-center gap-2 rounded-md px-3 text-body-sm font-medium whitespace-nowrap no-underline transition-[background-color,color,box-shadow,transform] duration-[var(--motion-fast)] ease-[var(--ease-standard)] disabled:cursor-not-allowed disabled:opacity-45 aria-disabled:cursor-not-allowed aria-disabled:opacity-45';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:
    'button-key bg-ink text-on-ink shadow-press not-disabled:hover:bg-ink-hover not-disabled:active:translate-y-px not-disabled:active:shadow-edge aria-disabled:hover:bg-ink',
  secondary: cn(
    'bg-surface text-ink border-line shadow-edge border not-disabled:active:translate-y-px',
    HOVER_OVERLAY,
  ),
  ghost: cn(
    'bg-transparent text-ink-secondary not-disabled:hover:text-ink aria-pressed:text-ink data-[state=open]:text-ink',
    HOVER_OVERLAY,
  ),
  danger:
    'bg-surface text-negative border-line shadow-edge border not-disabled:hover:bg-negative-soft not-disabled:active:translate-y-px',
};

/** The button face for an element that is not a `Button` (a link styled as one). */
export function buttonClasses(variant: ButtonVariant = 'secondary', className?: string) {
  return cn(BUTTON_BASE, BUTTON_VARIANT[variant], className);
}

export type ButtonProps = ComponentPropsWithoutRef<'button'> & {
  variant?: ButtonVariant;
  /** Render the child element as the button (Radix Slot) instead of a <button>. */
  asChild?: boolean;
  pending?: boolean;
  pendingLabel?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
};

function SlottedButton({
  className,
  variant = 'secondary',
  pending = false,
  ref,
  children,
  disabled: _disabled,
  pendingLabel: _pendingLabel,
  type: _type,
  asChild: _asChild,
  ...props
}: Readonly<ButtonProps>) {
  return (
    <Slot
      ref={ref}
      {...props}
      data-button-variant={variant}
      aria-busy={pending || undefined}
      className={buttonClasses(variant, className)}
    >
      {children}
    </Slot>
  );
}

function NativeButton({
  className,
  variant = 'secondary',
  pending = false,
  pendingLabel,
  type,
  ref,
  children,
  asChild: _asChild,
  ...props
}: Readonly<ButtonProps>) {
  return (
    <button
      ref={ref}
      {...props}
      type={type ?? 'button'}
      data-button-variant={variant}
      aria-busy={pending || undefined}
      disabled={props.disabled || pending}
      className={buttonClasses(variant, className)}
    >
      {/* Pending never resizes the button: the label keeps its box (hidden)
          and the spinner takes its place inside it, so nothing beside the
          button moves when it is pressed. The pending label is what
          assistive technology hears. */}
      <span
        aria-hidden={pending || undefined}
        className={cn('inline-flex items-center gap-2', pending && 'invisible')}
      >
        {children}
      </span>
      {pending ? (
        <span className="absolute inset-0 inline-flex items-center justify-center">
          <Spinner />
          <span className="sr-only">{pendingLabel ?? children}</span>
        </span>
      ) : null}
    </button>
  );
}

/** One form: 36px (`control-md`), 12px padding, the 16px icon before the label. */
export function Button(props: Readonly<ButtonProps>) {
  return props.asChild ? <SlottedButton {...props} /> : <NativeButton {...props} />;
}

type IconButtonProps = Omit<ButtonProps, 'variant' | 'children' | 'asChild' | 'aria-label'> & {
  icon: LucideIcon;
  /** The accessible name and the tooltip: what pressing it does. */
  label: string;
  /** `ghost` (default) in toolbars and rows; `secondary` alone on paper. */
  variant?: Extract<ButtonVariant, 'ghost' | 'secondary'>;
  /** A shortcut shown in the tooltip. */
  shortcut?: string;
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
  /** `false` only where the same words are visible beside it (a dialog's close). */
  tooltip?: boolean;
  /**
   * A link that looks like the icon control: an app path (`/runs`) goes
   * through `ProjectLink`, scoped to the active project like any app link;
   * an http(s) URL stays an external link with no referrer.
   */
  href?: string;
};

/** The anchor an icon link renders: the project's router link for an app path. */
function IconLinkTarget({
  href,
  label,
  children,
  ...props
}: Readonly<
  Omit<ComponentPropsWithRef<'a'>, 'href' | 'aria-label'> & { href: string; label: string }
>) {
  // `//host/path` is protocol-relative: another site, not an app path.
  if (href.startsWith('/') && !href.startsWith('//')) {
    return (
      <ProjectLink {...props} href={href} aria-label={label}>
        {children}
      </ProjectLink>
    );
  }
  const external = /^(https?:)?\/\//i.test(href);
  return (
    <a {...props} href={href} aria-label={label} rel={external ? 'noreferrer' : undefined}>
      {children}
    </a>
  );
}

/**
 * IconButton — the square icon-only control: 36px, no padding, the 16px
 * glyph, and a required `label` that is both its accessible name and its
 * tooltip (shown after 300ms on hover, at once on keyboard focus).
 */
export function IconButton({
  icon,
  label,
  href,
  variant = 'ghost',
  shortcut,
  tooltipSide = 'top',
  tooltip = true,
  className,
  ...props
}: Readonly<IconButtonProps>) {
  const classes = cn('w-[var(--control-md)] gap-0 px-0', className);
  const control = href ? (
    <Button {...props} variant={variant} className={classes} asChild>
      <IconLinkTarget href={href} label={label}>
        <Icon icon={icon} />
      </IconLinkTarget>
    </Button>
  ) : (
    <Button {...props} variant={variant} className={classes} aria-label={label}>
      <Icon icon={icon} />
    </Button>
  );
  if (!tooltip) return control;
  return (
    <Tooltip content={label} shortcut={shortcut} side={tooltipSide} describe={false}>
      {control}
    </Tooltip>
  );
}
