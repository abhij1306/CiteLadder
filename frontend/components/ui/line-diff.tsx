import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

type DiffLine = { kind: 'same' | 'added' | 'removed'; text: string };

const DIFF_LINE = {
  same: { mark: ' ', label: null, tone: 'text-muted' },
  removed: { mark: '−', label: 'Removed', tone: 'bg-well text-secondary' },
  added: { mark: '+', label: 'Added', tone: 'bg-panel-tonal text-secondary' },
} as const;

/** A computed line diff, with removed/added marks announced to screen readers. */
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
      className={textRole(
        'caption',
        'border-border-subtle grid overflow-x-auto rounded-[var(--radius-control)] border font-mono',
      )}
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
