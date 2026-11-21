import type { NetSentiment } from '@citeladder/contracts';

import { Absence } from '@/components/ui/absence';
import { textRole } from '@/components/ui/typography';
import { availabilityLabel } from '@/lib/format';
import { NOT_NAMED, sentimentReading } from '@/lib/visibility/perception';

export function SentimentValue({
  sentiment,
  tooFew = `${availabilityLabel('too_few')} classified`,
  showCount = true,
}: Readonly<{ sentiment: NetSentiment | null | undefined; tooFew?: string; showCount?: boolean }>) {
  const reading = sentimentReading(sentiment);
  switch (reading.kind) {
    case 'not_measured':
      return <Absence />;
    case 'no_mentions':
      return <Absence state="none" label={NOT_NAMED} reason="No answer named this brand." />;
    case 'too_few':
      return (
        <Absence
          state="too_few"
          label={tooFew}
          reason={`Shows from ${reading.minimum} classified mentions; ${reading.classified} so far.`}
        />
      );
    case 'value':
      return (
        <span className="whitespace-nowrap">
          {reading.net}
          {showCount ? (
            <span className={textRole('caption')}> · {reading.classified} classified</span>
          ) : null}
        </span>
      );
    default: {
      const _exhaustive: never = reading;
      return _exhaustive;
    }
  }
}
