'use client';

import { Badge } from '@/components/ui/badge';
import { Passage } from '@/components/ui/passage';
import { textRole } from '@/components/ui/typography';

/** The minimum an entity must carry to be shown as found on a page. */
export type QuotedEntity = { entity_name: string; passages: readonly string[] };

/**
 * The names found ON a page, each beside the line that proves it.
 *
 * One component because it enforces one rule: a name never appears here
 * without its quote. Two copies meant that rule was upheld in two places and
 * could stop being upheld in one of them.
 *
 * What is deliberately NOT here is the looser set of names that merely
 * appeared in an answer citing the page. Those are a different fact, are
 * labelled as such by their caller, and never scored anything.
 */
export function OnPageEntities({
  heading,
  entities,
}: Readonly<{ heading: string; entities: readonly QuotedEntity[] }>) {
  // Enforced here, not trusted from the caller. This component is where the
  // promise is made — a heading saying these were found on the page, beside
  // the line that proves each — so a name whose passages resolved to nothing
  // is dropped rather than rendered as a bare, unevidenced claim.
  const quoted = entities.filter((entity) =>
    entity.passages.some((passage) => passage.trim().length > 0),
  );
  if (!quoted.length) return null;
  return (
    <div className="grid gap-2">
      <p className={textRole('label')}>{heading}</p>
      <div className="flex flex-wrap gap-2">
        {quoted.map((entity) => (
          <Badge key={entity.entity_name} variant="classification" value="competitor">
            {entity.entity_name}
          </Badge>
        ))}
      </div>
      {quoted.map((entity) =>
        entity.passages.map((passage) => (
          <Passage key={`${entity.entity_name}:${passage}`}>{passage}</Passage>
        )),
      )}
    </div>
  );
}
