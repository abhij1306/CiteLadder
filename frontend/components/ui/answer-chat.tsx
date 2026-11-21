import type { ReactNode } from 'react';

import { ExternalHttpLink } from '@/components/ui/external-http-link';
import { textRole } from '@/components/ui/typography';
import { ArrowUpRight } from '@/lib/icons';
import { cn } from '@/lib/utils';

export function AnswerLayout({
  main,
  rail,
  railLabel,
}: Readonly<{ main: ReactNode; rail: ReactNode; railLabel: string }>) {
  return (
    <div className="desktop:grid-cols-[minmax(0,1fr)_20rem] grid min-w-0 gap-[var(--workspace-gap)]">
      <div className="grid min-w-0 content-start gap-[var(--workspace-gap)]">{main}</div>
      <aside
        aria-label={railLabel}
        className="desktop:border-s desktop:pl-4 border-rule flex min-w-0 flex-col gap-[var(--workspace-gap)]"
      >
        {rail}
      </aside>
    </div>
  );
}

export function ChatThread({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <ol aria-label={label} className="flex min-w-0 flex-col gap-[var(--workspace-gap)]">
      {children}
    </ol>
  );
}

export function ChatAvatar({
  tone,
  children,
}: Readonly<{ tone: 'you' | 'engine'; children: ReactNode }>) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-full',
        tone === 'you' ? 'bg-ink text-on-ink' : 'bg-well text-ink',
      )}
    >
      {children}
    </span>
  );
}

export function UserMessage({
  avatar,
  children,
}: Readonly<{ avatar: ReactNode; children: ReactNode }>) {
  return (
    <li className="flex items-start justify-end gap-3">
      <div className="bg-well text-ink type-body rounded-card max-w-[min(80%,var(--container-prose))] px-4 py-3">
        {children}
      </div>
      {avatar}
    </li>
  );
}

export function AssistantMessage({
  avatar,
  name,
  children,
}: Readonly<{ avatar: ReactNode; name: ReactNode; children: ReactNode }>) {
  return (
    <li className="flex min-w-0 items-start gap-3">
      {avatar}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className={textRole('label', 'text-ink-2')}>{name}</span>
        {children}
      </div>
    </li>
  );
}

export function YouMark() {
  return (
    <span className="bg-accent-wash text-accent-text rounded-mark text-eyebrow px-1 font-medium">
      You
    </span>
  );
}

const CHIP =
  'type-caption inline-flex max-w-full min-w-0 items-center gap-1 rounded-mark border px-1 align-baseline no-underline';

export function MentionChip({
  position,
  mark,
  you,
  children,
  ...data
}: Readonly<{
  position: number;
  mark: ReactNode;
  you: boolean;
  children: ReactNode;
  'data-brand-chip'?: string;
}>) {
  return (
    <span {...data} className={cn(CHIP, 'border-accent text-ink bg-surface border-dashed')}>
      <span className="text-accent-text font-medium tabular-nums">
        <span className="sr-only">Position </span>
        {position}
      </span>
      {mark}
      <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{children}</span>
      {you ? <YouMark /> : null}
    </span>
  );
}

export function CitationChip({
  href,
  mark,
  you,
  children,
  ...data
}: Readonly<{
  href: string | null;
  mark: ReactNode;
  you: boolean;
  children: ReactNode;
  'data-source-chip'?: string;
}>) {
  return (
    <ExternalHttpLink
      {...data}
      href={href}
      className={cn(CHIP, 'border-rule text-ink hover:overlay-hover no-underline')}
    >
      {mark}
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
      {you ? <YouMark /> : null}
      <ArrowUpRight aria-hidden className="text-ink-2 size-3 shrink-0" />
      {href ? <span className="sr-only">(opens in a new tab)</span> : null}
    </ExternalHttpLink>
  );
}

export function RailSection({
  title,
  trailing,
  children,
}: Readonly<{ title: string; trailing?: ReactNode; children: ReactNode }>) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <header className="flex items-baseline justify-between gap-2">
        <h3 className={textRole('emphasis')}>{title}</h3>
        {trailing ? <span className="type-caption text-ink-2">{trailing}</span> : null}
      </header>
      {children}
    </section>
  );
}

export function RailList({
  label,
  dense = false,
  children,
}: Readonly<{ label: string; dense?: boolean; children: ReactNode }>) {
  return (
    <ol aria-label={label} className={cn('flex flex-col', dense ? 'gap-1' : 'gap-3')}>
      {children}
    </ol>
  );
}

export function RailLine({ children }: Readonly<{ children: ReactNode }>) {
  return <span className="flex min-w-0 items-center gap-2">{children}</span>;
}

export function RailItem({ children }: Readonly<{ children: ReactNode }>) {
  return <li className="flex min-w-0 flex-col gap-1">{children}</li>;
}

export function RailRank({ children }: Readonly<{ children: ReactNode }>) {
  return <span className="type-caption text-ink-2 w-6 shrink-0 tabular-nums">{children}</span>;
}

export function RailNote({ children }: Readonly<{ children: ReactNode }>) {
  return <span className="type-caption text-ink-2 ms-auto shrink-0 tabular-nums">{children}</span>;
}

export function QueryItem({ children }: Readonly<{ children: ReactNode }>) {
  return <li className="type-body bg-well rounded-mark px-2 py-1">{children}</li>;
}
