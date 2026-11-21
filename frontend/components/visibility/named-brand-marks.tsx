import type { NamedBrand } from '@citeladder/contracts';

import { Absence } from '@/components/ui/absence';
import { BrandMark } from '@/components/ui/brand-mark';
import { Inline } from '@/components/ui/layout';
import { Tooltip } from '@/components/ui/tooltip';
import { textRole } from '@/components/ui/typography';

export function NamedBrandMarks({
  brands,
  total,
  answers,
}: Readonly<{ brands: readonly NamedBrand[]; total: number; answers: string }>) {
  if (!brands.length) return <Absence state="none" />;
  const overflow = total - brands.length;
  return (
    <Inline as="span" gap="tight">
      {brands.map((brand) => (
        <Tooltip
          key={`${brand.kind}:${brand.name}`}
          content={`${brand.name}: named in ${brand.responses} of ${answers}`}
        >
          <span className="inline-flex">
            <span className="sr-only">{brand.name}</span>
            <BrandMark
              name={brand.name}
              logoUrl={brand.logo_url}
              websiteUrl={brand.website}
              placement="inline"
            />
          </span>
        </Tooltip>
      ))}
      {overflow > 0 ? (
        <span className={textRole('caption', 'text-ink-2 tabular-nums')}>
          +{overflow}
          <span className="sr-only"> more</span>
        </span>
      ) : null}
    </Inline>
  );
}
