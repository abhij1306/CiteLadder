import { StatusMark } from '@/components/ui/status-mark';
import { Passage } from '@/components/ui/passage';
import { textRole } from '@/components/ui/typography';

export type QuotedEntity = { entity_name: string; passages: readonly string[] };

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
      <p className={textRole('body', 'text-ink-2')}>{heading}</p>
      <div className="flex flex-wrap gap-2">
        {quoted.map((entity) => (
          <StatusMark key={entity.entity_name} variant="classification" value="competitor">
            {entity.entity_name}
          </StatusMark>
        ))}
      </div>
      {quoted.map((entity) =>
        entity.passages.map((passage) => (
          <Passage key={`${entity.entity_name}:${passage}`} highlight={entity.entity_name}>
            {passage}
          </Passage>
        )),
      )}
    </div>
  );
}
