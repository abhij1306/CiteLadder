import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

type DiffLine = { kind: 'same' | 'added' | 'removed'; text: string };

const DIFF_LINE = {
  same: { mark: ' ', label: null, tone: 'text-ink-2' },
  removed: { mark: '−', label: 'Removed', tone: 'bg-well text-ink-2' },
  added: { mark: '+', label: 'Added', tone: 'bg-well text-ink-2' },
} as const;

export function LineDiff({
  lines,
  label,
}: Readonly<{ lines: readonly DiffLine[]; label: string }>) {
  const occurrences = new Map<string, number>();
  const keyedLines = lines.map((line) => {
    const content = JSON.stringify([line.kind, line.text]);
    const occurrence = occurrences.get(content) ?? 0;
    occurrences.set(content, occurrence + 1);
    return { ...line, key: `${content}:${occurrence}` };
  });
  return (
    <ol
      aria-label={label}
      className={textRole('caption', 'bg-well grid overflow-x-auto rounded-control font-mono')}
    >
      {keyedLines.map((line) => {
        const style = DIFF_LINE[line.kind];
        return (
          <li key={line.key} className={cn('flex gap-2 px-2 whitespace-pre-wrap', style.tone)}>
            <span aria-hidden>{style.mark}</span>
            {style.label ? <span className="sr-only">{style.label}:</span> : null}
            <span>{line.text || ' '}</span>
          </li>
        );
      })}
    </ol>
  );
}
