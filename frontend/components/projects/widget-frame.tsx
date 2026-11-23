import type { ReactNode } from 'react';

import { Inline, Stack } from '@/components/ui/layout';
import { InfoHint } from '@/components/ui/info-hint';
import { SectionDescription } from '@/components/ui/section';
import { slipClasses } from '@/components/ui/slip';
import { StateHeadingLevelContext } from '@/components/ui/state-heading-level';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

export type WidgetLink = Readonly<{ href: string; label: string; name?: string }>;

type WidgetFill = 'figure' | 'chart' | 'list';

type WidgetHeadProps = Readonly<{
  id: string;
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  link: ReactNode;
  figure: boolean;
}>;

export function WidgetFrame({
  id,
  title,
  description,
  status,
  link,
  fill = 'list',
  card = false,
  children,
}: Readonly<{
  id: string;
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  link?: WidgetLink | null;
  fill?: WidgetFill;
  card?: boolean;
  children: ReactNode;
}>) {
  const figure = fill === 'figure';
  const linkElement = link ? (
    <TextLink href={link.href} underline="hover">
      {link.name ? <span className="sr-only">{link.name}: </span> : null}
      {link.label}
    </TextLink>
  ) : null;
  return (
    <Stack
      as="section"
      gap="workspace"
      aria-labelledby={id}
      data-overview-widget=""
      className="flex h-full min-w-0 flex-col"
    >
      <WidgetHead
        id={id}
        title={title}
        description={description}
        status={status}
        link={figure ? null : linkElement}
        figure={figure}
      />
      <Stack
        gap="item"
        className={cn(
          fill === 'chart' ? 'min-w-0 flex-1' : 'flex min-w-0 flex-1 flex-col',
          card && slipClasses(),
        )}
      >
        <StateHeadingLevelContext value={3}>{children}</StateHeadingLevelContext>
      </Stack>
      {figure && linkElement ? <Inline>{linkElement}</Inline> : null}
    </Stack>
  );
}

function WidgetHead({ id, title, description, status, link, figure }: WidgetHeadProps) {
  const heading = (
    <h2 id={id} className={textRole('heading', 'truncate')}>
      {title}
    </h2>
  );
  return (
    <Inline as="header" className="items-start justify-between">
      {figure ? (
        <Inline gap="item" className="min-w-0">
          {heading}
          {description ? (
            <InfoHint label={typeof title === 'string' ? `About ${title}` : 'About this card'}>
              {description}
            </InfoHint>
          ) : null}
        </Inline>
      ) : (
        <Stack gap="tight" className="min-w-0">
          {heading}
          {description ? <SectionDescription>{description}</SectionDescription> : null}
        </Stack>
      )}
      {status || link ? (
        <Inline className="shrink-0">
          {status}
          {link}
        </Inline>
      ) : null}
    </Inline>
  );
}
