import type { CitedDomain } from '@citeladder/contracts';

import { Absence } from '@/components/ui/absence';
import { BrandMark } from '@/components/ui/brand-mark';
import { Inline } from '@/components/ui/layout';
import { Pressable } from '@/components/ui/pressable';
import { Tooltip } from '@/components/ui/tooltip';
import { textRole } from '@/components/ui/typography';
import { leadingSources } from '@/lib/prompts/filter';

import { NO_ANSWERS } from './prompt-figures';

export function CitedDomainMarks({
  sources,
}: Readonly<{ sources: readonly CitedDomain[] | null }>) {
  if (sources === null) return NO_ANSWERS;
  if (!sources.length) return <Absence state="none" />;
  const { shown, more } = leadingSources(sources);
  return (
    <Inline as="span" gap="tight">
      {shown.map(({ domain, citations, owned }) => (
        <Tooltip
          key={domain}
          content={`${domain}${owned ? ' (yours)' : ''}: ${citations} ${citations === 1 ? 'citation' : 'citations'}`}
        >
          <Pressable className="inline-flex w-auto">
            <span className="sr-only">{domain}</span>
            <BrandMark
              name={domain}
              websiteUrl={`https://${domain}`}
              placement="inline"
              entity="site"
            />
          </Pressable>
        </Tooltip>
      ))}
      {more > 0 ? (
        <span className={textRole('caption', 'text-ink-2 tabular-nums')}>
          +{more}
          <span className="sr-only"> more</span>
        </span>
      ) : null}
    </Inline>
  );
}
