import type { ReactNode } from 'react';

import { Absence } from '@/components/ui/absence';
import { FactList } from '@/components/ui/facts';
import { Inline } from '@/components/ui/layout';
import { SectionContent, TitledSection } from '@/components/ui/section';
import { StateBlock } from '@/components/ui/state-block';
import { UrlText } from '@/components/ui/table';
import { Tag } from '@/components/ui/tag';
import type { PageDetail } from '@citeladder/contracts';
import { formatCount } from '@/lib/format';

type Facts = NonNullable<PageDetail['facts']>;

function text(value: string | null): ReactNode {
  return value?.trim() ? value : <Absence state="not_measured" />;
}

function count(value: number | null): ReactNode {
  return value === null ? <Absence state="not_measured" /> : formatCount(value);
}

function tags(values: readonly string[]): ReactNode {
  if (!values.length) return 'None';
  return (
    <Inline className="flex-wrap">
      {values.map((value) => (
        <Tag key={value}>{value}</Tag>
      ))}
    </Inline>
  );
}

function factRows(facts: Facts) {
  return [
    { label: 'Title', value: text(facts.title) },
    { label: 'Meta description', value: text(facts.meta_description) },
    { label: 'H1 count', value: count(facts.h1_count) },
    { label: 'Word count', value: count(facts.word_count) },
    {
      label: 'Canonical',
      value: facts.canonical_url ? (
        <UrlText url={facts.canonical_url} />
      ) : (
        <Absence state="not_measured" />
      ),
    },
    { label: 'Robots directives', value: tags(facts.robots_directives) },
    { label: 'Schema types', value: tags(facts.structured_data_types) },
    {
      label: 'Images missing alt',
      value:
        facts.image_missing_alt_count === null || facts.image_count === null ? (
          <Absence state="not_measured" />
        ) : (
          `${formatCount(facts.image_missing_alt_count)} of ${formatCount(facts.image_count)}`
        ),
    },
  ];
}

export function PageFacts({ facts }: Readonly<{ facts: PageDetail['facts'] }>) {
  return (
    <TitledSection title="Page facts">
      <SectionContent>
        {facts ? (
          <FactList layout="ruled" label="Page facts" facts={factRows(facts)} />
        ) : (
          <StateBlock kind="empty" inline message="Audit not finished." />
        )}
      </SectionContent>
    </TitledSection>
  );
}
