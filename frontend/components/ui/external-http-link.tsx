import type { ComponentPropsWithRef } from 'react';

import { parseAbsoluteHttpUrl } from '@/lib/safe-http-url';
import { cn } from '@/lib/utils';

type ExternalHttpLinkProps = Omit<ComponentPropsWithRef<'a'>, 'href' | 'target' | 'rel'> & {
  href: string | null | undefined;
};

export function ExternalHttpLink({
  href,
  children,
  ...anchorProps
}: Readonly<ExternalHttpLinkProps>) {
  const url = parseAbsoluteHttpUrl(href);
  if (!url) {
    const { className, title } = anchorProps;
    return (
      <span
        className={cn(className, 'no-underline')}
        title={title}
        aria-label={anchorProps['aria-label']}
        aria-describedby={anchorProps['aria-describedby']}
      >
        {children}
      </span>
    );
  }
  return (
    <a
      {...anchorProps}
      className={cn(
        'underline underline-offset-2 [:root:not([data-public-surface])_&]:hover:decoration-current [:root:not([data-public-surface])_&]:focus-visible:decoration-current',
        anchorProps.className,
      )}
      href={url.toString()}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  );
}
