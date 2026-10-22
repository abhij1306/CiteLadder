import { useId, type ReactNode } from 'react';

import { Stack } from '@/components/ui/layout';
import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

/**
 * A settings page as a ruled list of sections: each section names itself in a
 * narrow column (title and one line of help) and holds its controls in the
 * wide one, so every field on the page starts at the same edge. In a narrow
 * container (a dialog, a phone) the two columns stack.
 *
 * Put the sections inside `SettingsSections`, which owns the rules between
 * them and the container the columns respond to.
 */
export function SettingsSection({
  title,
  description,
  children,
  className,
}: Readonly<{
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}>) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'grid gap-4 py-[var(--page-section-gap)] first:pt-0 last:pb-0 @2xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] @2xl:gap-[var(--page-section-gap)]',
        className,
      )}
    >
      <Stack gap="tight" className="content-start">
        <h2 id={headingId} className={textRole('sectionTitle')}>
          {title}
        </h2>
        {description ? <p className={textRole('caption')}>{description}</p> : null}
      </Stack>
      <Stack gap="workspace" className="min-w-0 content-start">
        {children}
      </Stack>
    </section>
  );
}

export function SettingsSections({
  children,
  className,
}: Readonly<{ children: ReactNode; className?: string }>) {
  return (
    <div className={cn('@container', className)}>
      <div className="divide-border-subtle grid divide-y">{children}</div>
    </div>
  );
}
