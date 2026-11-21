import type { ClusterResponse, MatchResponse } from './model.ts';

export type Validated<T> = { ok: true; value: T } | { ok: false; reason: string };

export type ValidAngle = { label: string; memberIds: string[] };

const reject = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

export function validateAngles(
  response: ClusterResponse,
  input: { memberIds: readonly string[]; maxLabelChars: number },
): Validated<ValidAngle[]> {
  const known = new Set(input.memberIds);
  const seen = new Set<string>();
  for (const angle of response.angles) {
    const label = angle.label.trim();
    if (!label || [...label].length > input.maxLabelChars) return reject('label_length');
    if (!angle.member_ids.length) return reject('empty_angle');
    for (const id of angle.member_ids) {
      if (!known.has(id)) return reject('unknown_member');
      if (seen.has(id)) return reject('duplicate_member');
      seen.add(id);
    }
  }
  return {
    ok: true,
    value: response.angles.map((angle) => ({
      label: angle.label.trim(),
      memberIds: angle.member_ids,
    })),
  };
}

export function validateMatches(
  response: MatchResponse,
  input: { angles: readonly { id: string; candidateIds: readonly string[] }[] },
): Validated<Map<string, string | null>> {
  const candidates = new Map(input.angles.map((angle) => [angle.id, new Set(angle.candidateIds)]));
  const picks = new Map<string, string | null>();
  for (const match of response.matches) {
    const allowed = candidates.get(match.angle_id);
    if (!allowed) return reject('unknown_angle');
    if (picks.has(match.angle_id)) return reject('duplicate_angle');
    if (match.owned_page_id !== null && !allowed.has(match.owned_page_id))
      return reject('unknown_owned_page');
    picks.set(match.angle_id, match.owned_page_id);
  }
  if (picks.size !== candidates.size) return reject('missing_angle');
  return { ok: true, value: picks };
}
