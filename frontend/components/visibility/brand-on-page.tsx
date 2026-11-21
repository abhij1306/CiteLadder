import { Stack } from '@/components/ui/layout';
import { Passage } from '@/components/ui/passage';
import { textRole } from '@/components/ui/typography';
import { absenceBasis, presenceLabel, type PageEntity } from '@/lib/visibility/source-pages';

export function BrandOnPage({
  heading,
  brand,
  extractedChars,
}: Readonly<{ heading: string; brand: PageEntity; extractedChars: number | null }>) {
  const verdict = presenceLabel(brand.presence);
  const basis = absenceBasis(brand.presence, brand.match_method, extractedChars);
  return (
    <Stack gap="item">
      <p className={textRole('body', 'text-ink-2')}>{heading}</p>
      <p className={textRole('body')}>
        {brand.entity_name}
        {verdict ? `: ${verdict.toLowerCase()}` : ''}
      </p>
      {brand.passages.map((passage) => (
        <Passage key={passage}>{passage}</Passage>
      ))}
      {basis ? <p className="type-caption">{basis}</p> : null}
    </Stack>
  );
}
