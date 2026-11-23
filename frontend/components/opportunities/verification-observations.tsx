import { Stack } from '@/components/ui/layout';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { movementLegLabel, movementStateLabel } from '@/lib/agent/vocabulary';

type VerificationResult = Record<string, unknown>;

export function VerificationObservations({
  implementation,
  showAuditLink,
}: Readonly<{
  implementation: { verification_events?: Array<{ result: Record<string, unknown> }> } | undefined;
  showAuditLink: boolean;
}>) {
  const result = implementation?.verification_events?.at(-1)?.result;
  if (!result) return null;
  return (
    <Stack className="type-caption">
      <ComparableMovement result={result} />
      <GapChanges result={result} />
      {showAuditLink ? (
        <TextLink text="caption" className="w-fit" href="/runs">
          Run a comparable audit
        </TextLink>
      ) : null}
    </Stack>
  );
}

function ComparableMovement({ result }: Readonly<{ result: VerificationResult | undefined }>) {
  const legs = result?.legs;
  if (!legs || typeof legs !== 'object') return null;
  const entries = Object.entries(legs).flatMap(([name, leg]) => {
    const label = movementLegLabel(name);
    return label ? [[label, leg] as const] : [];
  });
  if (!entries.length) return null;
  return (
    <Stack gap="tight">
      <p className={textRole('body', 'text-ink-2')}>Comparable movement</p>
      {entries.map(([label, leg]) => (
        <p key={label}>
          {label}: {movementStateLabel(legState(leg))}
        </p>
      ))}
    </Stack>
  );
}

function GapChanges({ result }: Readonly<{ result: VerificationResult | undefined }>) {
  const changes = result?.gap_changes;
  if (!changes || typeof changes !== 'object' || !('state' in changes)) return null;
  if (changes.state === 'not_run') return <p>Gap comparison: no reading yet</p>;
  if (changes.state !== 'available') return <p>Gap comparison: not available</p>;
  const lists = new Map(Object.entries(changes));
  const count = (key: string) => {
    const value = lists.get(key);
    return Array.isArray(value) ? value.length : 0;
  };
  return (
    <p>
      Gaps: {count('no_longer_observed')} no longer observed · {count('persistent')} persistent ·{' '}
      {count('new')} new
    </p>
  );
}

function legState(value: unknown): string {
  if (!value || typeof value !== 'object' || !('state' in value)) return 'unrecognized';
  return String(value.state);
}
