'use client';

import type { ExecutionAds } from '@citeladder/contracts/visibility-ads';

import { Inline, Stack } from '@/components/ui/layout';
import { panelClasses } from '@/components/ui/panel';
import { Label, textRole } from '@/components/ui/typography';
import { landingLabel } from '@/lib/visibility/ads';
import { AdOwnershipChip } from '@/components/visibility/ad-ownership-chip';

function adsMessage(ads: ExecutionAds): string | null {
  if (ads.applicability === 'unavailable') return 'Ads were not read for this answer.';
  if (!ads.items.length) return 'No ads were shown with this answer.';
  return null;
}

/**
 * The paid ads shown with this answer, apart from its sources. An engine
 * without ads renders nothing; an answer not read for ads says so.
 */
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
            <Stack
              as="li"
              gap="tight"
              key={ad.rank_absolute}
              className={panelClasses({ tone: 'well' }, 'min-w-0')}
            >
              <Inline as="span" className="flex-wrap">
                <span className={textRole('emphasis')}>{ad.title || 'Untitled ad'}</span>
                <AdOwnershipChip ownership={ad.ownership} />
              </Inline>
              {ad.snippet ? (
                <span className="type-caption text-secondary">{ad.snippet}</span>
              ) : null}
              <span className="type-caption">
                Sponsored by {ad.advertiser_name} · {landingLabel(ad.landing_url)}
              </span>
            </Stack>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
