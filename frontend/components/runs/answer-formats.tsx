import type { AnswerFormat, AnswerFormats } from '@citeladder/contracts';
import { Absence } from '@/components/ui/absence';
import { Inline } from '@/components/ui/layout';
import { Tag } from '@/components/ui/tag';

export const ANSWER_FORMAT_LABELS = {
  shopping: 'Shopping',
  map: 'Map',
  comparison: 'Comparison',
  image: 'Images',
} as const satisfies Record<AnswerFormat, string>;

export function AnswerFormatTags({ formats }: Readonly<{ formats: AnswerFormats }>) {
  switch (formats.kind) {
    case 'observed':
      if (!formats.formats.length) return <Absence state="none" label="None" />;
      return (
        <Inline as="span" gap="tight">
          {formats.formats.map((format) => (
            <Tag key={format}>{ANSWER_FORMAT_LABELS[format]}</Tag>
          ))}
        </Inline>
      );
    case 'not_applicable':
      return <Absence state="not_applicable" reason="This engine doesn't report answer formats." />;
    case 'unavailable':
      return <Absence state="unavailable" reason="This answer's stored page could not be read." />;
    default: {
      const unreachable: never = formats;
      return unreachable;
    }
  }
}
