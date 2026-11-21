import {
  Children,
  isValidElement,
  type ComponentPropsWithRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type Ref,
} from 'react';

import { Slot } from '@radix-ui/react-slot';
import { Icon } from '@/components/ui/icon';
import { ProjectLink } from '@/components/ui/project-link';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip } from '@/components/ui/tooltip';

import type { IconGlyph } from '@/lib/icons';
import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger' | 'danger-confirm';

export type ButtonSize = 'md' | 'lg';

const HOVER_OVERLAY =
  'not-aria-pressed:not-data-[state=open]:not-disabled:hover:overlay-hover aria-pressed:overlay-pressed data-[state=open]:overlay-pressed not-disabled:active:overlay-pressed';

const RAISED_FACE =
  'face bg-raised border border-rule not-disabled:hover:bg-raised-2 not-disabled:active:bg-raised-2 aria-pressed:bg-raised-2 data-[state=open]:bg-raised-2';

// The app's one disabled look (raised fill, rule edge) is in globals.css,
// after every variant. The website keeps its 45% disabled face.
const BUTTON_BASE =
  'focus-ring press type-label relative inline-flex shrink-0 items-center justify-center gap-2 rounded-control whitespace-nowrap no-underline pointer-coarse:min-h-[var(--control-coarse)] disabled:cursor-not-allowed aria-disabled:cursor-not-allowed [[data-public-surface]_&]:disabled:opacity-45 [[data-public-surface]_&]:aria-disabled:opacity-45';

const BUTTON_SIZE: Record<ButtonSize, string> = {
  md: 'min-h-[var(--control-md)] px-[var(--control-md-padding,12px)]',
  lg: 'min-h-[var(--control-lg)] px-4',
};

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:
    'face face-primary bg-primary border border-primary text-on-primary not-disabled:hover:bg-primary-hover not-disabled:hover:border-primary-hover',
  secondary: cn(RAISED_FACE, 'text-ink'),
  quiet: cn(
    'bg-transparent text-ink-2 border border-transparent not-disabled:hover:text-ink aria-pressed:text-ink data-[state=open]:text-ink',
    HOVER_OVERLAY,
  ),
  danger: cn(RAISED_FACE, 'face-danger text-negative [[data-public-surface]_&]:border-negative'),
  'danger-confirm':
    'face face-filled bg-negative text-on-ink border border-negative not-disabled:hover:opacity-90',
};

export function buttonClasses(
  variant: ButtonVariant = 'secondary',
  className?: string,
  size: ButtonSize = 'md',
) {
  return cn(BUTTON_BASE, BUTTON_SIZE[size], BUTTON_VARIANT[variant], className);
}

export type ButtonProps = ComponentPropsWithoutRef<'button'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: boolean;
  pending?: boolean;
  pendingLabel?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
};

function SlottedButton({
  className,
  variant = 'secondary',
  size = 'md',
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
      className={buttonClasses(variant, className, size)}
    >
      {children}
    </Slot>
  );
}

function NativeButton({
  className,
  variant = 'secondary',
  size = 'md',
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
      className={buttonClasses(variant, cn(pending && 'pointer-events-none', className), size)}
    >
      <span
        aria-hidden={pending || undefined}
        className={cn('inline-flex items-center gap-2', pending && 'invisible')}
      >
        {children}
      </span>
      {pending ? (
        <span className="absolute inset-0 inline-flex items-center justify-center gap-1 overflow-hidden">
          <Spinner />
          <span className="inline-flex min-w-0 items-center gap-2 truncate">
            {pendingLabel ?? children}
          </span>
        </span>
      ) : null}
    </button>
  );
}

const warnedQuiet = new Set<string>();

function carriesIcon(children: ReactNode): boolean {
  return Children.toArray(children).some((child) => {
    if (!isValidElement<{ 'aria-hidden'?: unknown; children?: ReactNode }>(child)) return false;
    if (child.type === Icon || child.type === 'svg' || child.props['aria-hidden']) return true;
    // A library glyph is a forwardRef object with no children.
    if (typeof child.type === 'object' && child.props.children === undefined) return true;
    return typeof child.type !== 'string' || child.type === 'a'
      ? carriesIcon(child.props.children)
      : false;
  });
}

function checkQuietIcon({ variant, children }: Readonly<ButtonProps>) {
  if (!import.meta.env?.DEV || variant !== 'quiet' || carriesIcon(children)) return;
  const name = Children.toArray(children)
    .filter((child) => typeof child === 'string')
    .join(' ');
  if (warnedQuiet.has(name)) return;
  warnedQuiet.add(name);
  console.warn(`Quiet button "${name}" has no icon: give it one, or make it secondary.`);
}

export function Button(props: Readonly<ButtonProps>) {
  checkQuietIcon(props);
  return props.asChild ? <SlottedButton {...props} /> : <NativeButton {...props} />;
}

type IconButtonProps = Omit<ButtonProps, 'variant' | 'children' | 'asChild' | 'aria-label'> & {
  icon: IconGlyph;
  label: string;
  variant?: Extract<ButtonVariant, 'quiet' | 'secondary' | 'primary'>;
  shortcut?: string;
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
  tooltip?: boolean;
  href?: string;
};

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

export function IconButton({
  icon,
  label,
  href,
  variant = 'quiet',
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
