import type { ExecutionAds } from '@citeladder/contracts/visibility-ads';

import { ClampText } from '@/components/ui/clamp-text';
import { Inline, Stack } from '@/components/ui/layout';
import { Label, textRole } from '@/components/ui/typography';
import { landingLabel } from '@/lib/visibility/ads';
import { AdOwnershipChip } from '@/components/visibility/ad-ownership-chip';
import { wellClasses } from '@/components/ui/slip';

function adsMessage(ads: ExecutionAds): string | null {
  if (ads.applicability === 'unavailable') return 'Ads were not read for this answer.';
  if (!ads.items.length) return 'No ads were shown with this answer.';
  return null;
}

export function EvidenceAds({ ads }: Readonly<{ ads: ExecutionAds }>) {
  if (ads.applicability === 'not_applicable') return null;
  const message = adsMessage(ads);
  return (
    <Stack as="section" gap="item">
      <Label>Ads in this answer</Label>
      {message ? (
        <p className="type-caption">{message}</p>
      ) : (
        <Stack as="ul" gap="item">
          {ads.items.map((ad) => (
            <Stack as="li" gap="tight" key={ad.rank_absolute} className={wellClasses('min-w-0')}>
              <Inline as="span" className="flex-wrap">
                <span className={textRole('emphasis')}>{ad.title || 'Untitled ad'}</span>
                <AdOwnershipChip ownership={ad.ownership} />
              </Inline>
              {ad.snippet ? <span className="type-caption text-ink-2">{ad.snippet}</span> : null}
              <ClampText className="type-caption">
                Sponsored by {ad.advertiser_name} · {landingLabel(ad.landing_url)}
              </ClampText>
            </Stack>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
