import { FigureStrip, type FigureSegment } from '@/components/ui/figure-strip';
import { Stack } from '@/components/ui/layout';
import { Section, SectionContent } from '@/components/ui/section';
import { textRole } from '@/components/ui/typography';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { formatDisplayDate } from '@/lib/format';

export function ProbeLede({
  createdAt,
  headline,
  label,
  segments,
}: Readonly<{
  createdAt: string;
  headline: string;
  label: string;
  segments: readonly FigureSegment[];
}>) {
  const timeZone = useDisplayTimeZone();
  return (
    <Section>
      <SectionContent>
        <Stack gap="item">
          <p className={textRole('caption', 'text-ink-2')}>
            From the market probe · {formatDisplayDate(createdAt, timeZone)}
          </p>
          <h2 className={textRole('heading')}>{headline}</h2>
          <FigureStrip label={label} segments={segments} subLine />
        </Stack>
      </SectionContent>
    </Section>
  );
}
