'use client';

import { ProjectLink } from '@/components/layout/scoped-link';

import { textRole } from '@/components/ui/typography';
import { movementLegLabel, movementStateLabel } from '@/lib/agent/vocabulary';

type VerificationResult = Record<string, unknown>;

/**
 * What else has been observed since a declaration — the before/after movement
 * and the gap changes — reported as observations, never as one verdict. The
 * per-check states sit above this, in the declaration.
 */
export function VerificationObservations({
  implementation,
  showAuditLink,
}: Readonly<{
  implementation: { verification_events?: Array<{ result: Record<string, unknown> }> } | undefined;
  /** Only a declaration with a prompt check is measured by a later run. */
  showAuditLink: boolean;
}>) {
  const result = implementation?.verification_events?.at(-1)?.result;
  if (!result) return null;
  return (
    <div className="type-caption grid gap-2">
      <ComparableMovement result={result} />
      <GapChanges result={result} />
      {showAuditLink ? (
        <ProjectLink className="focus-ring w-fit underline underline-offset-2" href="/runs">
          Run a comparable audit
        </ProjectLink>
      ) : null}
    </div>
  );
}

/** The before/after legs: visibility, AI referral traffic, branded demand. */
function ComparableMovement({ result }: Readonly<{ result: VerificationResult | undefined }>) {
  const legs = result?.legs;
  if (!legs || typeof legs !== 'object') return null;
  const entries = Object.entries(legs).flatMap(([name, leg]) => {
    const label = movementLegLabel(name);
    return label ? [[label, leg] as const] : [];
  });
  if (!entries.length) return null;
  return (
    <div className="grid gap-0.5">
      <p className={textRole('label')}>Comparable movement</p>
      {entries.map(([label, leg]) => (
        <p key={label}>
          {label}: {movementStateLabel(legState(leg))}
        </p>
      ))}
    </div>
  );
}

function GapChanges({ result }: Readonly<{ result: VerificationResult | undefined }>) {
  const changes = result?.gap_changes;
  if (!changes || typeof changes !== 'object' || !('state' in changes)) return null;
  if (changes.state === 'not_run') return <p>Gap comparison: not measured yet</p>;
  if (changes.state !== 'available') return <p>Gap comparison: not available</p>;
  const count = (key: string) => {
    const value = key in changes ? changes[key as keyof typeof changes] : null;
    return Array.isArray(value) ? value.length : 0;
  };
  return (
    <p>
      Gaps: {count('no_longer_observed')} no longer observed · {count('persistent')} persistent ·{' '}
      {count('new')} new
    </p>
  );
}

/** The leg's persisted state; a leg with none is unrecognized, not unavailable. */
function legState(value: unknown): string {
  if (!value || typeof value !== 'object' || !('state' in value)) return 'unrecognized';
  return String(value.state);
}
