import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { SLIP_FACE } from '@/components/ui/slip';
import { StateHeadingLevelContext } from '@/components/ui/state-heading-level';
import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

export type SectionVariant = 'surface' | 'framed';

const SECTION_FACE: Record<SectionVariant, string> = {
  surface: '',
  framed: cn(SLIP_FACE, 'p-[var(--card-padding)]'),
};

export function Section({
  children,
  className,
  variant = 'surface',
  ...props
}: Readonly<ComponentPropsWithoutRef<'section'> & { variant?: SectionVariant }>) {
  return (
    <section
      {...props}
      data-section={variant}
      className={cn('surface-section min-w-0', SECTION_FACE[variant], className)}
    >
      <StateHeadingLevelContext value={3}>{children}</StateHeadingLevelContext>
    </section>
  );
}

export function SectionHeader({
  children,
  className,
  actions,
  ...props
}: Readonly<
  ComponentPropsWithoutRef<'header'> & {
    actions?: ReactNode;
  }
>) {
  if (!actions) {
    return (
      <header {...props} className={cn('flex flex-col gap-1 not-last:mb-3', className)}>
        {children}
      </header>
    );
  }
  return (
    <header
      {...props}
      className={cn('flex flex-wrap items-start justify-between gap-2 not-last:mb-3', className)}
    >
      <div className="grid min-w-0 flex-1 basis-60 grid-cols-[minmax(0,1fr)] gap-1">{children}</div>
      <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">{actions}</div>
    </header>
  );
}

export function SectionTitle({
  children,
  className,
  level = 2,
  ...props
}: Readonly<ComponentPropsWithoutRef<'h2'> & { level?: 2 | 3 }>) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <Heading {...props} className={textRole('heading', className)}>
      {children}
    </Heading>
  );
}

export function SectionDescription({
  children,
  className,
  ...props
}: Readonly<ComponentPropsWithoutRef<'p'>>) {
  return (
    <p {...props} className={textRole('body', cn('text-ink-2 max-w-[72ch]', className))}>
      {children}
    </p>
  );
}

export function SectionContent({
  children,
  className,
  ...props
}: Readonly<ComponentPropsWithoutRef<'div'> & { children: ReactNode }>) {
  return (
    <div {...props} className={className}>
      {children}
    </div>
  );
}

export function TitledSection({
  title,
  description,
  actions,
  variant,
  children,
  className,
}: Readonly<{
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  variant?: SectionVariant;
  children: ReactNode;
  className?: string;
}>) {
  return (
    <Section variant={variant} className={className}>
      <SectionHeader actions={actions}>
        <SectionTitle>{title}</SectionTitle>
        {description ? <SectionDescription>{description}</SectionDescription> : null}
      </SectionHeader>
      {children}
    </Section>
  );
}

export function SectionStack({
  children,
  ...props
}: Readonly<{ children: ReactNode; 'aria-busy'?: boolean }>) {
  return (
    <div
      {...props}
      data-rhythm-gap="section"
      className="flex min-w-0 flex-col gap-[var(--page-section-gap)]"
    >
      {children}
    </div>
  );
}
