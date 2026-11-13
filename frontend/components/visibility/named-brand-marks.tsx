import type { NamedBrand } from '@citeladder/contracts';

import { BrandMark } from '@/components/ui/brand-mark';
import { Inline } from '@/components/ui/layout';
import { Tooltip } from '@/components/ui/tooltip';
import { textRole } from '@/components/ui/typography';

/**
 * The brands named in a set of answers, as the marks a reader recognises.
 *
 * Real logos only — `BrandMark` falls back to initials rather than inventing a
 * mark. The overflow count is the rest of the distinct brands, so the cell
 * never grows past the leading few no matter how crowded the answers were.
 * `answers` names the set for the tooltip, e.g. "the answers citing this URL".
 */
export function NamedBrandMarks({
  brands,
  total,
  answers,
}: Readonly<{ brands: readonly NamedBrand[]; total: number; answers: string }>) {
  // Measured, and no brand was named: a finding, never the "not measured" mark.
  if (!brands.length) return <span className="text-ink-muted">None</span>;
  const overflow = total - brands.length;
  return (
    <Inline as="span" gap="tight">
      {brands.map((brand) => (
        <Tooltip
          key={`${brand.kind}:${brand.name}`}
          content={`${brand.name} — named in ${brand.responses} of ${answers}`}
        >
          <span className="inline-flex">
            {/* The mark is decorative; the name is what a screen reader hears. */}
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
        <span className={textRole('caption', 'text-ink-secondary tabular-nums')}>
          +{overflow}
          <span className="sr-only"> more</span>
        </span>
      ) : null}
    </Inline>
  );
}
