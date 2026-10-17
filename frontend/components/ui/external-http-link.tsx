import type { ComponentPropsWithRef } from 'react';

import { parseAbsoluteHttpUrl } from '@/lib/safe-http-url';

type ExternalHttpLinkProps = Omit<ComponentPropsWithRef<'a'>, 'href' | 'target' | 'rel'> & {
  href: string | null | undefined;
};

/** Render API supplied HTTP(S) destinations as links, or readable plain text. */
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
        className={className}
        title={title}
        aria-label={anchorProps['aria-label']}
        aria-describedby={anchorProps['aria-describedby']}
      >
        {children}
      </span>
    );
  }
  return (
    <a {...anchorProps} href={url.toString()} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}
