import { useId, type ReactNode } from 'react';

import { textRole, type TextRole } from '@/components/ui/typography';

export function ReadingColumn({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="flex min-h-dvh w-full min-w-0 flex-col pb-[var(--page-end-space)]">
      {children}
    </div>
  );
}

export function ReadingTools({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="mt-3 flex flex-wrap gap-2">{children}</div>;
}

export const READING_SECTION_TITLE = 'label' satisfies TextRole;

export function Labelled({
  title,
  caption,
  children,
}: Readonly<{
  title: string;
  caption?: string | null;
  children: ReactNode;
}>) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="mt-6 flex min-w-0 flex-col gap-2">
      <h2 id={id} className={textRole(READING_SECTION_TITLE)}>
        {title}
      </h2>
      {children}
      {caption ? <p className={textRole('caption', 'text-ink-2')}>{caption}</p> : null}
    </section>
  );
}

export function Prose({ children }: Readonly<{ children: ReactNode }>) {
  return <p className={textRole('body', 'break-words')}>{children}</p>;
}

export type DetailFact = Readonly<{ label: string; value: ReactNode }>;

export function DetailsFacts({ facts }: Readonly<{ facts: readonly DetailFact[] }>) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="mt-8 flex flex-col gap-3">
      <h2 id={id} className={textRole(READING_SECTION_TITLE)}>
        Details
      </h2>
      <dl className="flex flex-col gap-3">
        {facts.map((fact) => (
          <div key={fact.label} className="flex">
            <dt className={textRole('body', 'text-ink-2 w-30 shrink-0')}>{fact.label}</dt>
            <dd className={textRole('body', 'flex min-w-0 flex-1 items-center gap-2')}>
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function StepList({ items }: Readonly<{ items: readonly string[] }>) {
  return (
    <ul className="flex list-disc flex-col gap-1 ps-5">
      {items.map((item) => (
        <li key={item} className={textRole('body', 'min-w-0 break-words')}>
          {item}
        </li>
      ))}
    </ul>
  );
}
