import type { LucideIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';

import { CARD_FACE } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { LogoMark } from '@/components/ui/logo-mark';
import { ThemeSwitch } from '@/components/ui/theme-switch';
import { cn } from '@/lib/utils';

/** The CiteLadder logo linking to the product root. */
export function AuthLogo() {
  return (
    <a
      href="/"
      aria-label="CiteLadder home"
      className="focus-ring text-ink inline-flex rounded-sm p-1"
    >
      <LogoMark size={22} />
    </a>
  );
}

/**
 * AuthShell — the frame for project setup: the logo top-left, the ThemeSwitch top-right, and one
 * `container-narrow` column on the `paper` ground. The column is top-aligned
 * with `space-12` above it, so cards of different heights never move their
 * top edge between steps. No navigation, footer links or illustrations.
 */
export function AuthShell({
  mainLabel,
  barEnd,
  children,
}: Readonly<{
  /** The landmark name of the column ("Project setup"). */
  mainLabel: string;
  /** Before the ThemeSwitch: a way out, the account menu. */
  barEnd?: ReactNode;
  children: ReactNode;
}>) {
  return (
    <div className="bg-paper text-ink flex min-h-dvh flex-col antialiased">
      <header className="desktop:px-[var(--card-padding)] flex h-[var(--nav-height)] shrink-0 items-center justify-between gap-4 px-4">
        {/* Optically flush with the gutter: the link's 4px focus inset hangs out. */}
        <span className="-ms-1 inline-flex">
          <AuthLogo />
        </span>
        <div className="flex items-center gap-3">
          {barEnd}
          <ThemeSwitch />
        </div>
      </header>
      <main
        id="main"
        aria-label={mainLabel}
        className="desktop:px-[var(--card-padding)] desktop:pt-12 desktop:pb-24 flex flex-1 items-start justify-center px-4 pt-[var(--card-padding)] pb-16"
      >
        <div className="max-w-narrow w-full">{children}</div>
      </main>
    </div>
  );
}

/**
 * The card's head: an optional 40px icon tile, the title 32/38 in the sans
 * face at 500 (the app sets no display face, decision D54) and a 16/26 line
 * under it. The title is the page's one `h1`; it takes focus by
 * script (`tabIndex -1`) when a flow moves to a new step.
 */
function AuthHead({
  id,
  title,
  sub,
  icon,
}: Readonly<{
  id: string;
  title: ReactNode;
  sub?: ReactNode;
  icon?: LucideIcon;
}>) {
  return (
    <header className="flex flex-col items-start gap-2">
      {icon ? (
        <span
          aria-hidden
          className="bg-surface text-ink-secondary mb-2 grid size-10 place-items-center rounded-md shadow-xs"
        >
          <Icon icon={icon} />
        </span>
      ) : null}
      <h1
        id={id}
        tabIndex={-1}
        className="text-display-lg text-ink font-sans font-medium text-balance"
      >
        {title}
      </h1>
      {sub ? <p className="text-body text-ink-secondary">{sub}</p> : null}
    </header>
  );
}

type AuthCardProps = Readonly<{
  title: ReactNode;
  /** The heading's id, when a flow moves focus to it; generated otherwise. */
  titleId?: string;
  sub?: ReactNode;
  icon?: LucideIcon;
  /** One line under the card. */
  after?: ReactNode;
  children?: ReactNode;
}>;

/**
 * AuthCard — one card on the Card's face (`surface`, 1px `line`), `radius-lg` and
 * `space-10` padding (`space-6` on phones): the head, then the body
 * (`space-6` apart), and an optional line under the card (`after`). Used by
 * the setup screens' loading, failure and blocked states.
 */
export function AuthCard({ title, titleId, sub, icon, after, children }: AuthCardProps) {
  const generatedId = useId();
  const headingId = titleId ?? generatedId;
  return (
    <div className="flex flex-col gap-[var(--card-padding)]">
      <section
        aria-labelledby={headingId}
        className={cn(
          CARD_FACE,
          'surface-card desktop:p-10 flex flex-col gap-[var(--card-padding)] p-[var(--card-padding)]',
        )}
      >
        <AuthHead id={headingId} title={title} sub={sub} icon={icon} />
        {children}
      </section>
      {after ? <p className="text-body-sm text-ink-secondary text-center">{after}</p> : null}
    </div>
  );
}

/** A row of the card's buttons, `space-2` apart, wrapping on a phone. */
export function AuthActions({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}
