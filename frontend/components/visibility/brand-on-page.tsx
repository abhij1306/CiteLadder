import { Passage } from '@/components/ui/passage';
import { textRole } from '@/components/ui/typography';
import { absenceBasis, presenceLabel, type PageEntity } from '@/lib/visibility/source-pages';

/**
 * Where the business stands on a page we do not own. A presence carries its
 * passage; an absence carries how much was searched and how, because no
 * passage can show that something is missing.
 */
export function BrandOnPage({
  heading,
  brand,
  extractedChars,
}: Readonly<{ heading: string; brand: PageEntity; extractedChars: number }>) {
  const verdict = presenceLabel(brand.presence);
  const basis = absenceBasis(brand.presence, brand.match_method, extractedChars);
  return (
    <div className="grid gap-2">
      <p className={textRole('label')}>{heading}</p>
      <p className={textRole('itemTitle')}>
        {brand.entity_name}
        {verdict ? ` — ${verdict.toLowerCase()}` : ''}
      </p>
      {brand.passages.map((passage) => (
        <Passage key={passage}>{passage}</Passage>
      ))}
      {basis ? <p className="type-caption">{basis}</p> : null}
    </div>
  );
}
