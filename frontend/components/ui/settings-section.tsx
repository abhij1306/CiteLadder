import { useId, type ReactNode } from 'react';

import { cardClasses } from '@/components/ui/card';
import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

/**
 * SettingsSection — one card of settings: its title and one line of help,
 * then its rows (fields, or the controls that act at once), 16 apart.
 *
 * The danger zone is its own section, last, with a `danger` Button and the
 * consequence in its description. Stack sections in `SettingsSections`.
 */
export function SettingsSection({
  title,
  description,
  action,
  children,
}: Readonly<{
  title: string;
  description?: ReactNode;
  /** A header button such as Add connection. */
  action?: ReactNode;
  children: ReactNode;
}>) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={cn(cardClasses(), 'flex min-w-0 flex-col gap-[var(--card-padding)]')}
    >
      <header className="flex items-start justify-between gap-4">
        <div className="grid min-w-0 gap-1">
          <h2 id={headingId} className={textRole('itemTitle')}>
            {title}
          </h2>
          {description ? <p className={textRole('body')}>{description}</p> : null}
        </div>
        {action}
      </header>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  );
}

/** A page's settings sections, stacked at the card gap. */
export function SettingsSections({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="flex min-w-0 flex-col gap-[var(--workspace-gap)]">{children}</div>;
}
