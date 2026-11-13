/**
 * Angle identity across reclustering (content optimization section 2): a new
 * angle inherits the lineage of the previous run's angle in the same topic
 * whose member URLs it overlaps most, when that Jaccard overlap reaches the
 * minimum. Pure.
 */
import { jaccard } from '../lists.ts';
import { compareText } from '../text-order.ts';

export type PreviousAngle = {
  lineageId: string;
  topicId: string | null;
  memberUrls: readonly string[];
};
export type NewAngle = { key: string; topicId: string | null; memberUrls: readonly string[] };

/**
 * Each new angle's inherited lineage ID, or null for a new lineage. Per topic,
 * the highest-overlap pairs are taken first, one-to-one; ties go to the lower
 * lineage ID, then the lower new-angle key.
 */
export function assignLineages(
  previousAngles: readonly PreviousAngle[],
  newAngles: readonly NewAngle[],
  minOverlap: number,
): Map<string, string | null> {
  const pairs = newAngles.flatMap((angle) =>
    previousAngles
      .filter((previous) => previous.topicId === angle.topicId)
      .map((previous) => ({
        key: angle.key,
        lineageId: previous.lineageId,
        overlap: jaccard(new Set(angle.memberUrls), new Set(previous.memberUrls)),
      }))
      .filter((pair) => pair.overlap > 0 && pair.overlap >= minOverlap),
  );
  pairs.sort(
    (a, b) =>
      b.overlap - a.overlap || compareText(a.lineageId, b.lineageId) || compareText(a.key, b.key),
  );
  const assigned = new Map<string, string | null>(newAngles.map((angle) => [angle.key, null]));
  const taken = new Set<string>();
  for (const pair of pairs) {
    if (taken.has(pair.lineageId) || assigned.get(pair.key) !== null) continue;
    assigned.set(pair.key, pair.lineageId);
    taken.add(pair.lineageId);
  }
  return assigned;
}
